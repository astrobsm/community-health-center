import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { RequestContext, runWithContext } from '../request-context';

/**
 * Establishes the request context before anything else runs.
 *
 * The context exists from the first middleware to the last interceptor, so a
 * traceId is available even for a request that fails authentication — which is
 * precisely when a correlation id is most useful.
 *
 * `runWithContext` wraps `next()`, so every downstream guard, pipe, handler and
 * interceptor shares the same AsyncLocalStorage store without any of them
 * having to pass it along.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: FastifyRequest['raw'], reply: FastifyReply['raw'], next: () => void): void {
    const headers = request.headers;

    const traceId = this.headerValue(headers['x-trace-id']) ?? randomUUID();
    const requestId = this.headerValue(headers['x-request-id']);
    const deviceId = this.headerValue(headers['x-device-id']);
    const userAgent = this.headerValue(headers['user-agent']);

    const context = new RequestContext({
      traceId,
      requestId,
      deviceId,
      userAgent,
      ipAddress: this.clientIp(request),
    });

    // Returned on every response so a user can quote it in a support call.
    reply.setHeader('x-trace-id', traceId);

    runWithContext(context, next);
  }

  private headerValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
  }

  private clientIp(request: FastifyRequest['raw']): string | undefined {
    // Trusting X-Forwarded-For is only safe behind our own proxy; the proxy is
    // configured to overwrite it rather than append.
    const forwarded = this.headerValue(request.headers['x-forwarded-for']);
    if (forwarded) return forwarded.split(',')[0]?.trim();
    return request.socket.remoteAddress ?? undefined;
  }
}
