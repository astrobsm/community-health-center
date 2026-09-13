import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@chc/contracts';

import { PERMISSION_KEY, PUBLIC_KEY, REASON_REQUIRED_KEY } from '../decorators';
import { ReasonRequiredError } from '../errors';
import { getContext } from '../request-context';

/**
 * Enforces the permission a route declares.
 *
 * Layer 1 of four (doc 08 §4). A route with no declaration is REFUSED here,
 * and the application also refuses to start with such a route — belt and
 * braces, because an unprotected endpoint is the kind of mistake that is
 * invisible until it matters.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      // Fail closed. A missing declaration is a bug, not a grant.
      throw new ForbiddenException(
        'This endpoint declares no permission and cannot be called. Add @RequirePermission() or @Public().',
      );
    }

    const ctx = getContext();

    // Any one of the declared permissions is sufficient: several routes are
    // legitimately reachable by more than one role.
    const granted = required.some((permission) => ctx.has(permission));

    if (!granted) {
      throw new ForbiddenException(
        `This action requires ${required.join(' or ')}, which your role does not include.`,
      );
    }

    const reasonRequired = this.reflector.getAllAndOverride<boolean>(REASON_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (reasonRequired) {
      const body = context.switchToHttp().getRequest<{ body?: { reason?: unknown } }>().body;
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
      if (reason.length < 5) {
        throw new ReasonRequiredError(context.getHandler().name);
      }
      ctx.reason = reason;
    }

    return true;
  }
}
