import { AsyncLocalStorage } from 'node:async_hooks';

import type { Permission } from '@chc/contracts';

/**
 * Per-request context, carried through the whole call stack without threading
 * it through every signature.
 *
 * Tenant scope is resolved ONCE, by the auth guard, from the session — never
 * from a request parameter (ADR 0005). Everything downstream (the Prisma
 * tenancy extension, the audit interceptor, the permission guard) reads it
 * from here, so there is no path by which a handler can widen its own scope.
 *
 * The context is created empty by the middleware and filled by the guard, so
 * a traceId exists even for a request that fails authentication — which is
 * exactly when a correlation id is most useful.
 */
export type ScopeLevel = 'FULL' | 'DEPARTMENT' | 'AGGREGATE_ONLY' | 'SELF_ONLY';

export interface Identity {
  userId: string;
  sessionId: string;
  organisationId: string;
  facilityIds: readonly string[];
  scopeLevel: ScopeLevel;
  permissions: ReadonlySet<Permission>;
  roleCodes: readonly string[];
  departmentId?: string;
  impersonatedBy?: string;
}

export class RequestContext {
  readonly traceId: string;
  readonly requestId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly deviceId?: string;

  userId?: string;
  sessionId?: string;
  organisationId?: string;
  facilityIds: readonly string[] = [];
  scopeLevel?: ScopeLevel;
  departmentId?: string;
  permissions: ReadonlySet<Permission> = new Set();
  roleCodes: readonly string[] = [];
  impersonatedBy?: string;

  /** Set by a handler when an action requires an explicit justification. */
  reason?: string;

  /** Actor classification for the audit log. */
  actorType: 'USER' | 'SYSTEM' | 'INTEGRATION' | 'AI' = 'USER';

  constructor(init: {
    traceId: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    deviceId?: string;
  }) {
    this.traceId = init.traceId;
    this.requestId = init.requestId;
    this.ipAddress = init.ipAddress;
    this.userAgent = init.userAgent;
    this.deviceId = init.deviceId;
  }

  /** Called once, by the auth guard, after the token is verified. */
  assignIdentity(identity: Identity): void {
    if (this.userId) {
      throw new Error('Request identity has already been assigned; it must not be reassigned mid-request.');
    }
    this.userId = identity.userId;
    this.sessionId = identity.sessionId;
    this.organisationId = identity.organisationId;
    this.facilityIds = identity.facilityIds;
    this.scopeLevel = identity.scopeLevel;
    this.permissions = identity.permissions;
    this.roleCodes = identity.roleCodes;
    this.departmentId = identity.departmentId;
    this.impersonatedBy = identity.impersonatedBy;
  }

  has(permission: Permission): boolean {
    return this.permissions.has(permission);
  }
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The current context, or undefined outside a request (workers, seeds). */
export function tryGetContext(): RequestContext | undefined {
  return storage.getStore();
}

export class MissingRequestContextError extends Error {
  constructor(what: string) {
    super(
      `${what} was requested outside a request context. ` +
        'This usually means a worker or script is calling request-scoped code; use systemContext() instead.',
    );
    this.name = 'MissingRequestContextError';
  }
}

export function getContext(): RequestContext {
  const context = storage.getStore();
  if (!context) throw new MissingRequestContextError('Request context');
  return context;
}

/**
 * The caller's tenant scope.
 *
 * Throws rather than returning a permissive default. A missing scope must fail
 * closed and loudly — silently returning "all facilities" is exactly the bug
 * this architecture exists to prevent.
 */
export function getTenantScope(): { organisationId: string; facilityIds: readonly string[] } {
  const context = getContext();
  if (!context.organisationId) throw new MissingRequestContextError('Tenant scope');
  return { organisationId: context.organisationId, facilityIds: context.facilityIds };
}

export function hasPermission(permission: Permission): boolean {
  return tryGetContext()?.has(permission) ?? false;
}

/**
 * A context for work that legitimately has no user: scheduled jobs, sync
 * workers, seeds.
 *
 * Explicit, so such work appears in the audit log as SYSTEM rather than
 * masquerading as a person.
 */
export function systemContext(params: {
  traceId: string;
  organisationId?: string;
  facilityIds?: readonly string[];
}): RequestContext {
  const context = new RequestContext({ traceId: params.traceId });
  context.actorType = 'SYSTEM';
  context.organisationId = params.organisationId;
  context.facilityIds = params.facilityIds ?? [];
  context.roleCodes = ['SYSTEM'];
  return context;
}
