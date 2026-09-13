import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@chc/contracts';

import { getContext, type RequestContext } from '../request-context';

export const PERMISSION_KEY = 'chc:permission';
export const PUBLIC_KEY = 'chc:public';
export const AUDIT_ACTION_KEY = 'chc:auditAction';
export const REASON_REQUIRED_KEY = 'chc:reasonRequired';

/**
 * Declares the permission a route requires.
 *
 * The application refuses to start if any mutating route lacks this
 * (see bootstrap/assert-route-permissions.ts), so a developer cannot ship an
 * unprotected endpoint by forgetting a decorator.
 */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSION_KEY, permissions);

/**
 * Marks a route as requiring no authentication.
 *
 * Deliberately verbose, and deliberately rare: login, token refresh, health,
 * and version. Every use should be obvious in review.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Overrides the audit action name, which defaults to `METHOD /path`. */
export const AuditAction = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);

/**
 * Requires a caller-supplied reason.
 *
 * Applied to corrections, overrides, break-glass, waivers, adjustments,
 * reversals, and changes to an approved financial model. The reason lands in
 * the audit record, which is what makes those actions reviewable rather than
 * merely possible.
 */
export const ReasonRequired = () => SetMetadata(REASON_REQUIRED_KEY, true);

/** The resolved request context: user, tenant scope, permissions, device. */
export const Ctx = createParamDecorator((_data: unknown, _context: ExecutionContext): RequestContext => getContext());

/** The authenticated user's id. */
export const CurrentUser = createParamDecorator((_data: unknown, _context: ExecutionContext): string => {
  const { userId } = getContext();
  if (!userId) throw new Error('CurrentUser used on a route with no authenticated user.');
  return userId;
});
