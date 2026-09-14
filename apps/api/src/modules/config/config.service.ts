import { Injectable, Logger } from '@nestjs/common';

import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Business configuration (spec §89).
 *
 * Everything the specification says must be configurable rather than
 * hard-coded lives here: scoring weights, completeness thresholds, tolerances,
 * approval limits, alert horizons, retention periods.
 *
 * Resolution order, most specific first:
 *   1. facility-level setting
 *   2. organisation-level setting
 *   3. the default the calling code supplies
 *
 * The default is passed in at the call site rather than kept in a central
 * table, so a value can never be *missing* — the worst case is that it falls
 * back to a documented default that sits next to the logic using it.
 */
@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);

  /** Short-lived, because a changed threshold should take effect promptly. */
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  private static readonly TTL_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private cacheKey(organisationId: string, facilityId: string | undefined, key: string): string {
    return `${organisationId}:${facilityId ?? '-'}:${key}`;
  }

  async get<T>(key: string, fallback: T, facilityId?: string): Promise<T> {
    const { organisationId } = getTenantScope();
    const cacheKey = this.cacheKey(organisationId, facilityId, key);

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;

    const rows = await this.prisma.systemConfiguration.findMany({
      where: {
        organisationId,
        key,
        OR: [{ facilityId: facilityId ?? null }, { facilityId: null }],
      },
      select: { facilityId: true, value: true },
    });

    // Facility-specific beats organisation-wide.
    const specific = rows.find((row) => row.facilityId === facilityId && facilityId !== undefined);
    const general = rows.find((row) => row.facilityId === null);
    const resolved = (specific ?? general)?.value;

    const value = (resolved === undefined || resolved === null ? fallback : resolved) as T;
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + ConfigService.TTL_MS });
    return value;
  }

  async number(key: string, fallback: number, facilityId?: string): Promise<number> {
    const value = await this.get<unknown>(key, fallback, facilityId);
    const parsed = typeof value === 'number' ? value : Number(value);

    if (!Number.isFinite(parsed)) {
      // A malformed setting must not silently become NaN and corrupt a
      // threshold comparison. Fall back loudly.
      this.logger.error(`Configuration "${key}" is not a number (${String(value)}); using ${fallback}.`);
      return fallback;
    }

    return parsed;
  }

  async boolean(key: string, fallback: boolean, facilityId?: string): Promise<boolean> {
    const value = await this.get<unknown>(key, fallback, facilityId);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
    return fallback;
  }

  async json<T extends object>(key: string, fallback: T, facilityId?: string): Promise<T> {
    const value = await this.get<unknown>(key, fallback, facilityId);

    // An ARRAY fallback must come back an array. Spreading one into an object
    // literal yields {0: ..., 1: ...}, which reaches the caller as something
    // that is no longer a list and fails on its first .map().
    if (Array.isArray(fallback)) {
      return (Array.isArray(value) ? value : fallback) as T;
    }

    // An object setting merges over its default, so a facility overriding one
    // threshold does not have to restate the rest.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...fallback, ...(value as object) } as T;
    }

    return fallback;
  }

  /**
   * Change a setting.
   *
   * `rationale` is not decoration: a threshold without a recorded reason
   * becomes folklore within a year, and nobody dares change it because nobody
   * remembers why it is what it is.
   */
  async set(key: string, value: unknown, options: { facilityId?: string; rationale?: string; description?: string }) {
    const { organisationId } = getTenantScope();
    const context = tryGetContext();

    const existing = await this.prisma.systemConfiguration.findFirst({
      where: { organisationId, facilityId: options.facilityId ?? null, key },
      select: { id: true, value: true },
    });

    const record = existing
      ? await this.prisma.systemConfiguration.update({
          where: { id: existing.id },
          data: { value: value as never, rationale: options.rationale, updatedBy: context?.userId },
          select: { id: true, key: true, value: true },
        })
      : await this.prisma.systemConfiguration.create({
          data: {
            organisationId,
            facilityId: options.facilityId,
            key,
            value: value as never,
            description: options.description,
            rationale: options.rationale,
            createdBy: context?.userId,
          },
          select: { id: true, key: true, value: true },
        });

    this.cache.delete(this.cacheKey(organisationId, options.facilityId, key));

    await this.audit.record({
      action: 'config.change',
      entityType: 'system_configuration',
      entityId: record.id,
      facilityId: options.facilityId,
      oldValue: existing ? { value: existing.value } : undefined,
      newValue: { value },
      reason: options.rationale,
      severity: 'NOTICE',
    });

    return record;
  }

  async list(facilityId?: string) {
    const { organisationId } = getTenantScope();

    return this.prisma.systemConfiguration.findMany({
      where: { organisationId, OR: [{ facilityId: facilityId ?? null }, { facilityId: null }] },
      orderBy: { key: 'asc' },
      select: {
        id: true,
        key: true,
        value: true,
        facilityId: true,
        description: true,
        rationale: true,
        updatedAt: true,
      },
    });
  }
}
