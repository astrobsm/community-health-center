/**
 * @chc/contracts — the only module both tiers import.
 *
 * Framework-free by design (ADR 0001): no NestJS, no Prisma, no React. That is
 * what lets the same validation run in a village with no signal and on the
 * server at sync time.
 */

export * from './classification.js';
export * from './money.js';
export * from './permissions.js';
export * from './common.js';
export * from './auth.js';
export * from './assessment.js';
export * from './planning.js';
export * from './partnership.js';
export * from './document.js';
export * from './execution.js';
export * from './clinical.js';
