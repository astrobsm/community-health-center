import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { tryGetContext } from '../../common/request-context';

/**
 * Tables that are NOT tenant-scoped: shared reference data, or the access
 * tables that define scope itself and therefore cannot be filtered by it
 * (see the RLS migration for the same list and the reasoning).
 */
const UNSCOPED_MODELS = new Set<string>([
  'FacilityType',
  'Service',
  'Permission',
  'AssessmentTemplate',
  'AssessmentTemplateVersion',
  'AssessmentSection',
  'AssessmentItem',
  'InventoryCategory',
  'Medication',
  'LabTest',
  'LabReferenceRange',
  'Kpi',
  'ComplianceRequirement',
  'LetterTemplate',
  'IdempotencyRecord',
  // Identity and access: reading these is how scope is established.
  'AppUser',
  'UserRole',
  'Role',
  'RolePermission',
  'UserFacilityAccess',
  'UserSession',
  'RefreshToken',
  'UserMfaFactor',
]);

/** Models scoped by organisation only — they have no facility_id column. */
const ORG_ONLY_MODELS = new Set<string>(['Organisation', 'Supplier']);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * A client that applies the caller's tenant scope to every query.
   *
   * This is layer 2 of four (ADR 0005). A developer writing a new repository
   * method gets the filter whether or not they remember it, and PostgreSQL RLS
   * catches them if this layer is somehow bypassed.
   *
   * Two things it deliberately does NOT do:
   *   - it never reads the scope from a request parameter;
   *   - it never falls back to "no filter" when scope is missing. Absent scope
   *     throws, because a query that silently returns another facility's data
   *     is the failure mode this whole design exists to prevent.
   */
  forRequest() {
    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!model || UNSCOPED_MODELS.has(model)) return query(args);

            // Raw queries never reach $allModels; RLS covers them instead.

            const context = tryGetContext();
            if (!context?.organisationId) {
              throw new Error(
                `Refusing to query ${model} without tenant scope. ` +
                  'Every request-scoped query must run inside a resolved request context.',
              );
            }

            const scope: Record<string, unknown> = { organisationId: context.organisationId };

            if (!ORG_ONLY_MODELS.has(model) && context.facilityIds.length > 0) {
              scope['facilityId'] = { in: [...context.facilityIds] };
            }

            const typed = args as { where?: Record<string, unknown>; data?: unknown };

            if (operation === 'create' || operation === 'createMany') {
              // Writes are checked by RLS WITH CHECK; we do not rewrite the
              // payload, because silently changing what a caller asked to
              // write would hide a bug rather than surface it.
              return query(args);
            }

            typed.where = { ...(typed.where ?? {}), ...scope };
            return query(args);
          },
        },
      },
    });
  }

  /**
   * Run a transaction with the PostgreSQL tenant scope set.
   *
   * SET LOCAL, not SET: the setting dies with the transaction, so a pooled
   * connection cannot carry one user's scope into another user's request.
   */
  async withTenantScope<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const context = tryGetContext();
    if (!context?.organisationId) {
      throw new Error('withTenantScope called without a resolved tenant scope.');
    }

    const organisationId = context.organisationId;
    const facilityIds = context.facilityIds.join(',');
    const userId = context.userId ?? '';

    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org', ${organisationId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_facilities', ${facilityIds}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user', ${userId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Serialisable transaction with bounded retry.
   *
   * Used for stock deduction and journal posting, where two concurrent callers
   * must not both succeed against the same last unit of stock. A serialisation
   * failure is expected under contention and is retried, not surfaced.
   */
  async withSerializableRetry<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    maxAttempts = 3,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        lastError = error;
        const code = (error as { code?: string }).code;
        // 40001 serialisation failure, 40P01 deadlock detected.
        const retryable = code === '40001' || code === '40P01' || code === 'P2034';
        if (!retryable || attempt === maxAttempts) throw error;
        this.logger.warn(`Serialisation conflict, retrying (attempt ${attempt}/${maxAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
      }
    }

    throw lastError;
  }
}
