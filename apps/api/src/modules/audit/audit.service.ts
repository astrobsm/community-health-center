import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { AuditOutcome, AuditSeverity, Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { tryGetContext } from '../../common/request-context';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  outcome?: AuditOutcome;
  severity?: AuditSeverity;
  organisationId?: string;
  facilityId?: string;
}

/**
 * The institutional memory (doc 11).
 *
 * Two write paths, deliberately:
 *
 *  - CRITICAL entries are written SYNCHRONOUSLY, inside the caller's
 *    transaction where one exists. If the audit write fails, the business
 *    transaction fails: an action that cannot be recorded must not happen.
 *
 *  - Everything else is written asynchronously through a bounded buffer, so
 *    routine auditing never adds latency to a clinician's save.
 *
 * Rows are hash-chained. This does not make tampering impossible for a
 * database superuser — no application-level design can — but it makes it
 * DETECTABLE, which is the achievable goal.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly buffer: Prisma.AuditLogCreateInput[] = [];
  private flushing = false;
  private static readonly MAX_BUFFER = 500;

  constructor(private readonly prisma: PrismaService) {}

  private static readonly CRITICAL_ACTIONS = new Set([
    'auth.login.failed',
    'auth.token.reuse_detected',
    'auth.account.locked',
    'authz.denied',
    'finance.reverse',
    'finance.period.reopen',
    'billing.waive',
    'payment.refund',
    'inventory.adjust',
    'clinical.break_glass',
    'rbac.role.changed',
    'rbac.permission.changed',
    'contract.execute',
    'baseline.seal',
    'financial_model.unlock',
    'admin.impersonate',
  ]);

  /**
   * `changedFields` is computed rather than supplied, so it cannot disagree
   * with the old and new values beside it.
   */
  private diffFields(oldValue: unknown, newValue: unknown): string[] {
    if (!oldValue || !newValue || typeof oldValue !== 'object' || typeof newValue !== 'object') {
      return [];
    }
    const before = oldValue as Record<string, unknown>;
    const after = newValue as Record<string, unknown>;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  }

  /**
   * Secrets never reach the audit log. Redaction is by key name, at this one
   * place, rather than at every call site — which is the only way it stays
   * true as the system grows.
   */
  private redact(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'object') return value as Prisma.InputJsonValue;

    const SENSITIVE = /password|token|secret|authorization|pin|nin|hash|otp|recovery/i;
    const walk = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(walk);
      if (input && typeof input === 'object') {
        return Object.fromEntries(
          Object.entries(input as Record<string, unknown>).map(([key, val]) => [
            key,
            SENSITIVE.test(key) ? '[redacted]' : walk(val),
          ]),
        );
      }
      return input;
    };

    return walk(value) as Prisma.InputJsonValue;
  }

  private async buildRow(entry: AuditEntry): Promise<Prisma.AuditLogCreateInput | null> {
    const context = tryGetContext();

    const organisationId = entry.organisationId ?? context?.organisationId;
    if (!organisationId) {
      // A CRITICAL event that cannot be recorded must not pass silently: these
      // are exactly the events worth keeping (token reuse, lockout, reversal),
      // and several of them occur on UNAUTHENTICATED routes where there is no
      // context to infer the organisation from. The caller must supply it.
      if (this.isCritical(entry)) {
        throw new Error(
          `Audit entry "${entry.action}" is CRITICAL but has no organisation to attach to. ` +
            'Pass organisationId explicitly — this action occurs outside an authenticated request context.',
        );
      }
      this.logger.error(`Audit entry "${entry.action}" has no organisation and was not recorded.`);
      return null;
    }

    const facilityId = entry.facilityId ?? context?.facilityIds[0];
    const oldValue = this.redact(entry.oldValue);
    const newValue = this.redact(entry.newValue);

    const previous = await this.prisma.auditLog.findFirst({
      where: { organisationId, facilityId: facilityId ?? null },
      orderBy: { occurredAt: 'desc' },
      select: { rowHash: true },
    });

    const payload = {
      organisationId,
      facilityId,
      actorUserId: context?.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValue,
      newValue,
      reason: entry.reason ?? context?.reason,
      outcome: entry.outcome ?? 'SUCCESS',
    };

    const prevHash = previous?.rowHash ?? Buffer.alloc(0);
    const rowHash = createHash('sha256')
      .update(prevHash)
      .update(JSON.stringify(payload, Object.keys(payload).sort()))
      .digest();

    return {
      organisationId,
      facilityId,
      actorUserId: context?.userId,
      actorType: context?.actorType ?? 'SYSTEM',
      onBehalfOf: context?.impersonatedBy,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValue,
      newValue,
      changedFields: this.diffFields(entry.oldValue, entry.newValue),
      reason: entry.reason ?? context?.reason,
      outcome: entry.outcome ?? 'SUCCESS',
      severity: entry.severity ?? this.severityFor(entry.action, entry.outcome),
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      sessionId: context?.sessionId,
      traceId: context?.traceId ?? 'no-trace',
      requestId: context?.requestId,
      prevHash: previous?.rowHash,
      rowHash,
    };
  }

  private severityFor(action: string, outcome?: AuditOutcome): AuditSeverity {
    if (AuditService.CRITICAL_ACTIONS.has(action)) return 'CRITICAL';
    if (outcome === 'DENIED') return 'WARNING';
    if (outcome === 'FAILURE') return 'NOTICE';
    return 'INFO';
  }

  private isCritical(entry: AuditEntry): boolean {
    return (
      (entry.severity ?? this.severityFor(entry.action, entry.outcome)) === 'CRITICAL' ||
      entry.outcome === 'DENIED'
    );
  }

  /** Records an entry. Critical entries are written before this resolves. */
  async record(entry: AuditEntry): Promise<void> {
    const row = await this.buildRow(entry);
    if (!row) return;

    if (this.isCritical(entry)) {
      // Deliberately awaited and deliberately unguarded: if this throws, the
      // caller's transaction fails, and that is the correct outcome.
      await this.prisma.auditLog.create({ data: row });
      return;
    }

    if (this.buffer.length >= AuditService.MAX_BUFFER) {
      // Better to drop a routine entry loudly than to exhaust memory silently.
      this.logger.error(`Audit buffer full (${AuditService.MAX_BUFFER}); dropped "${entry.action}".`);
      return;
    }

    this.buffer.push(row);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

    try {
      const batch = this.buffer.splice(0, this.buffer.length);
      await this.prisma.auditLog.createMany({ data: batch });
    } catch (error) {
      this.logger.error(`Failed to flush audit entries: ${(error as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }

  /** Drains the buffer on shutdown so nothing in flight is lost. */
  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }

  /**
   * Recomputes the hash chain for a range and reports the first break.
   *
   * Run nightly; also exposed to auditors on demand.
   */
  async verifyChain(organisationId: string, facilityId: string | null, from: Date, to: Date) {
    const rows = await this.prisma.auditLog.findMany({
      where: { organisationId, facilityId, occurredAt: { gte: from, lte: to } },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, prevHash: true, rowHash: true, occurredAt: true },
    });

    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1];
      const current = rows[i];
      if (!previous || !current) continue;
      if (!current.prevHash || !Buffer.from(previous.rowHash).equals(Buffer.from(current.prevHash))) {
        return {
          intact: false,
          brokenAt: current.id,
          occurredAt: current.occurredAt,
          checked: rows.length,
        };
      }
    }

    return { intact: true, checked: rows.length };
  }
}
