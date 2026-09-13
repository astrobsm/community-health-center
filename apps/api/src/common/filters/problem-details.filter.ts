import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { BusinessRuleError } from '../errors';
import { tryGetContext } from '../request-context';

/**
 * RFC 9457 Problem Details for every failure (doc 06 §5).
 *
 * Two rules:
 *   1. Errors are never swallowed. Every 5xx is logged with its stack and a
 *      traceId, and the traceId is returned so a facility manager can quote it.
 *   2. Internal detail never leaks. A database constraint name is useful in the
 *      log and meaningless (or revealing) to a user.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  constructor(private readonly baseUrl: string) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const traceId = tryGetContext()?.traceId ?? 'no-trace';

    const problem = this.toProblem(exception, request.url, traceId);

    if (problem.status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${problem.status} [${traceId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (problem.status === 403 || problem.status === 401) {
      // Authorisation failures are security-relevant even when routine.
      this.logger.warn(`${request.method} ${request.url} -> ${problem.status} [${traceId}]`);
    }

    void reply.status(problem.status).type('application/problem+json').send(problem);
  }

  private toProblem(exception: unknown, instance: string, traceId: string) {
    const base = { instance, traceId };

    if (exception instanceof BusinessRuleError) {
      const response = exception.getResponse() as {
        code: string;
        title: string;
        detail: string;
        extra?: Record<string, unknown>;
      };
      return {
        type: `${this.baseUrl}/errors/${response.code}`,
        title: response.title,
        status: exception.getStatus(),
        detail: response.detail,
        ...base,
        ...(response.extra ?? {}),
      };
    }

    if (exception instanceof ZodError) {
      return {
        type: `${this.baseUrl}/errors/validation`,
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        detail: 'One or more fields are invalid.',
        ...base,
        errors: exception.issues.map((issue) => ({
          field: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception, base);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);

      return {
        type: `${this.baseUrl}/errors/http-${status}`,
        title: exception.name.replace(/Exception$/, ''),
        status,
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
        ...base,
      };
    }

    // Unknown: say nothing about internals.
    return {
      type: `${this.baseUrl}/errors/internal`,
      title: 'Internal server error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: `An unexpected error occurred. Quote reference ${traceId} when reporting this.`,
      ...base,
    };
  }

  private fromPrisma(error: Prisma.PrismaClientKnownRequestError, base: { instance: string; traceId: string }) {
    switch (error.code) {
      case 'P2002':
        return {
          type: `${this.baseUrl}/errors/duplicate`,
          title: 'Already exists',
          status: HttpStatus.CONFLICT,
          detail: 'A record with these details already exists.',
          ...base,
        };
      case 'P2003':
        return {
          type: `${this.baseUrl}/errors/invalid-reference`,
          title: 'Invalid reference',
          status: HttpStatus.BAD_REQUEST,
          detail: 'This record refers to something that does not exist or is not visible to you.',
          ...base,
        };
      case 'P2025':
        // Out of scope and not found are answered identically, so the existence
        // of another facility's record is never disclosed (doc 06 §5).
        return {
          type: `${this.baseUrl}/errors/not-found`,
          title: 'Not found',
          status: HttpStatus.NOT_FOUND,
          detail: 'No such record, or it is not visible to you.',
          ...base,
        };
      default:
        return {
          type: `${this.baseUrl}/errors/internal`,
          title: 'Internal server error',
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          detail: `An unexpected database error occurred. Quote reference ${base.traceId}.`,
          ...base,
        };
    }
  }
}
