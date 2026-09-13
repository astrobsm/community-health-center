import { HttpException, HttpStatus } from '@nestjs/common';
import type { BusinessErrorCode } from '@chc/contracts';

/**
 * Domain errors that map to a specific HTTP status and a specific, useful
 * message.
 *
 * "Something went wrong" is useless to a pharmacist standing in front of a
 * patient holding a prescription. Every error here says what happened and, as
 * far as it can, what to do about it.
 */
export class BusinessRuleError extends HttpException {
  constructor(
    readonly code: BusinessErrorCode,
    readonly title: string,
    detail: string,
    status: number = HttpStatus.CONFLICT,
    readonly extra?: Record<string, unknown>,
  ) {
    super({ code, title, detail, extra }, status);
  }
}

export class InsufficientStockError extends BusinessRuleError {
  constructor(batchLabel: string, available: number, requested: number) {
    super(
      'insufficient-stock',
      'Insufficient stock',
      `Batch ${batchLabel} has ${available} unit(s); ${requested} were requested. ` +
        'Dispense the available quantity as a partial dispensing, or select another batch.',
      HttpStatus.CONFLICT,
      { batchLabel, available, requested },
    );
  }
}

export class PeriodClosedError extends BusinessRuleError {
  constructor(periodName: string) {
    super(
      'period-closed',
      'Financial period closed',
      `Period "${periodName}" is closed and cannot accept new postings. ` +
        'Post to the current period, or ask a finance officer to reopen it with a recorded reason.',
      HttpStatus.CONFLICT,
      { periodName },
    );
  }
}

export class UnbalancedEntryError extends BusinessRuleError {
  constructor(debitMinor: bigint, creditMinor: bigint) {
    super(
      'unbalanced-entry',
      'Unbalanced journal entry',
      `Debits (${debitMinor}) do not equal credits (${creditMinor}). An entry must balance to the kobo.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { debitMinor: debitMinor.toString(), creditMinor: creditMinor.toString() },
    );
  }
}

export class SealedEntityError extends BusinessRuleError {
  constructor(entity: string, guidance: string) {
    super('baseline-sealed', 'Record is sealed', `${entity} is sealed and cannot be changed. ${guidance}`, HttpStatus.CONFLICT);
  }
}

export class ModelLockedError extends BusinessRuleError {
  constructor(modelName: string) {
    super(
      'model-locked',
      'Approved model is locked',
      `"${modelName}" is approved, so its assumptions are locked. ` +
        'Review the impact preview and unlock it explicitly with a reason before changing an assumption.',
      423, // Locked. Not present in Nest's HttpStatus enum.
      { modelName },
    );
  }
}

export class VersionConflictError extends BusinessRuleError {
  constructor(entity: string, expected: number, actual: number) {
    super(
      'version-conflict',
      'Record changed since you loaded it',
      `${entity} was at version ${expected} when you started and is now at version ${actual}. ` +
        'Your change has not been lost — review both versions and choose how to proceed.',
      HttpStatus.CONFLICT,
      { expected, actual },
    );
  }
}

export class SegregationOfDutiesError extends BusinessRuleError {
  constructor(rule: string) {
    super('segregation-of-duties', 'Segregation of duties', rule, HttpStatus.FORBIDDEN);
  }
}

export class ReasonRequiredError extends BusinessRuleError {
  constructor(action: string) {
    super(
      'reason-required',
      'A reason is required',
      `"${action}" changes or overrides a record, so it requires a reason. The reason is recorded in the audit trail.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class ConsentRequiredError extends BusinessRuleError {
  constructor(purpose: string) {
    super(
      'consent-required',
      'Consent required',
      `No current consent is recorded for "${purpose}". Record consent before proceeding.`,
      HttpStatus.FORBIDDEN,
      { purpose },
    );
  }
}

export class ResultNotVerifiedError extends BusinessRuleError {
  constructor() {
    super(
      'result-not-verified',
      'Result not verified',
      'This laboratory result has not been verified, so it is not yet visible for clinical use.',
      HttpStatus.CONFLICT,
    );
  }
}

export class OfflineLimitReachedError extends BusinessRuleError {
  constructor(limit: string) {
    super(
      'offline-limit-reached',
      'Offline limit reached',
      `This device has reached its offline limit (${limit}). Connect and sync before capturing more.`,
      HttpStatus.CONFLICT,
    );
  }
}
