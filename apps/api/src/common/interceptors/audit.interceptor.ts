import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { catchError, tap, throwError, type Observable } from 'rxjs';

import { AuditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTION_KEY, PUBLIC_KEY } from '../decorators';
import { tryGetContext } from '../request-context';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Audits every mutating request (doc 11 §3, path 1).
 *
 * This is one of three independent capture paths, because each has a blind
 * spot: this one misses a `psql` session, the database triggers miss request
 * context (IP, device, reason), and explicit domain calls miss whatever a
 * developer forgets. A daily reconciliation job compares trigger-sourced rows
 * against interceptor-sourced rows and flags writes that appear in one but not
 * the other.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!MUTATING.has(request.method)) return next.handle();

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const explicitAction = this.reflector.getAllAndOverride<string>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Route path rather than the concrete URL, so audit actions group sensibly
    // and no identifier leaks into the action name.
    const action = explicitAction ?? `${request.method} ${request.routeOptions?.url ?? request.url}`;
    const entityType = context.getClass().name.replace(/Controller$/, '').toLowerCase();

    // Public routes (login, refresh) audit themselves with far better detail
    // than a generic interceptor could — they know whether the password was
    // wrong, the account locked, or the token reused.
    if (isPublic) return next.handle();

    return next.handle().pipe(
      tap((result) => {
        void this.audit.record({
          action,
          entityType,
          entityId: this.entityIdOf(result) ?? this.entityIdOf(request.params),
          newValue: request.body,
          outcome: 'SUCCESS',
        });
      }),
      catchError((error: unknown) => {
        const status = (error as { status?: number }).status ?? 500;
        void this.audit.record({
          action,
          entityType,
          entityId: this.entityIdOf(request.params),
          newValue: request.body,
          outcome: status === 403 || status === 401 ? 'DENIED' : 'FAILURE',
          reason: (error as Error).message,
        });
        return throwError(() => error);
      }),
    );
  }

  private entityIdOf(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
}

/** Re-exported so modules can reach the context without a deep import. */
export { tryGetContext };
