import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates a payload against a schema from @chc/contracts.
 *
 * The same schema object validates on the device at capture time, so a record
 * filled in offline in a village cannot fail validation on sync two weeks later
 * (ADR 0001). That property is the whole reason contracts is a shared package.
 *
 * Unknown keys are STRIPPED, not ignored: an attacker cannot smuggle a field
 * the handler forgot to exclude, and a stale client cannot set a column it
 * should not know about.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    // Throws ZodError, which ProblemDetailsFilter renders as field-level errors.
    return this.schema.parse(value);
  }
}

/** Convenience factory: `@Body(zodBody(loginSchema))`. */
export function zodBody(schema: ZodSchema): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}

/**
 * The same, for a query string: `@Query(zodQuery(dashboardQuerySchema))`.
 *
 * Distinct from `zodBody` only in name, and the name is the point: a reader
 * scanning a controller can see at a glance which schema governs which part of
 * the request. Query values arrive as strings, so the schemas used here coerce
 * their numbers rather than assuming them.
 */
export function zodQuery(schema: ZodSchema): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}
