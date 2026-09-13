import { createHash } from 'node:crypto';

import type { BaselineMetric, DataClassification } from '@chc/contracts';

/**
 * Baseline sealing (spec §12).
 *
 * Day 0. Sealed once, never edited. Every later comparison in the product is
 * measured against this, so if it can drift, nothing downstream means anything.
 *
 * `createHash` is the one impurity, and it is deterministic — same input, same
 * output, no I/O, no clock. The rest of the module is pure.
 */

/**
 * Canonical serialisation for hashing.
 *
 * Deliberately explicit rather than `JSON.stringify(metrics)`:
 *   - metrics are sorted by code, so insertion order cannot change the hash
 *   - only the fields that constitute the MEASUREMENT are included; a later
 *     cosmetic change to a metric's display name must not look like tampering
 *   - numbers are rendered at fixed precision, so 8 and 8.0 hash identically
 *
 * The hash is tamper EVIDENCE, not tamper prevention. A database superuser can
 * still alter rows; what they cannot do is alter them and have the recomputed
 * hash still match (doc 11 §2).
 */
export function canonicalise(metrics: readonly BaselineMetric[]): string {
  const sorted = [...metrics].sort((a, b) => a.metricCode.localeCompare(b.metricCode));

  return sorted
    .map((metric) =>
      [
        metric.metricCode,
        metric.numericValue === null ? '' : metric.numericValue.toFixed(6),
        metric.textValue ?? '',
        metric.unit ?? '',
        metric.classification,
        metric.sourceReference ?? '',
        String(metric.evidenceCount),
      ].join(''),
    )
    .join('');
}

export function computeContentHash(
  facilityId: string,
  sequence: number,
  asOfDate: string,
  metrics: readonly BaselineMetric[],
): string {
  const digest = createHash('sha256')
    .update(facilityId)
    .update('')
    .update(String(sequence))
    .update('')
    .update(asOfDate)
    .update('')
    .update(canonicalise(metrics))
    .digest('hex');

  return `sha256:${digest}`;
}

export function verifyContentHash(
  facilityId: string,
  sequence: number,
  asOfDate: string,
  metrics: readonly BaselineMetric[],
  expectedHash: string,
): boolean {
  return computeContentHash(facilityId, sequence, asOfDate, metrics) === expectedHash;
}

// -----------------------------------------------------------------------------
// Deriving metrics from an assessment
// -----------------------------------------------------------------------------

export interface MetricSource {
  metricCode: string;
  metricName: string;
  domainCode: string | null;
  unit: string | null;
  /** The assessment item this metric is read from. */
  itemCode: string;
}

export interface SourceResponse {
  itemCode: string;
  responseId: string;
  answer: unknown;
  notApplicable: boolean;
  classification: DataClassification;
  evidenceCount: number;
}

export interface DerivationResult {
  metrics: BaselineMetric[];
  /** Metrics that could not be derived, and why. Surfaced, never filled in. */
  gaps: Array<{ metricCode: string; metricName: string; reason: string }>;
}

/**
 * Turn assessment responses into baseline metrics.
 *
 * The rule that matters: a metric with no usable response becomes a GAP, not a
 * zero and not an estimate. A baseline that quietly records "0 patients/day"
 * because nobody counted is worse than one that says the figure was never
 * captured — the first is a false fact that every later comparison inherits.
 */
export function deriveMetrics(
  sources: readonly MetricSource[],
  responses: readonly SourceResponse[],
): DerivationResult {
  const byItemCode = new Map(responses.map((r) => [r.itemCode, r]));
  const metrics: BaselineMetric[] = [];
  const gaps: DerivationResult['gaps'] = [];

  for (const source of sources) {
    const response = byItemCode.get(source.itemCode);

    if (!response) {
      gaps.push({
        metricCode: source.metricCode,
        metricName: source.metricName,
        reason: `Item ${source.itemCode} was not answered in this assessment.`,
      });
      continue;
    }

    if (response.notApplicable) {
      gaps.push({
        metricCode: source.metricCode,
        metricName: source.metricName,
        reason: `Item ${source.itemCode} was marked not applicable at this facility.`,
      });
      continue;
    }

    if (response.answer === null || response.answer === undefined || response.answer === '') {
      gaps.push({
        metricCode: source.metricCode,
        metricName: source.metricName,
        reason: `Item ${source.itemCode} was left blank.`,
      });
      continue;
    }

    const { numericValue, textValue } = coerce(response.answer);

    metrics.push({
      metricCode: source.metricCode,
      metricName: source.metricName,
      domainCode: source.domainCode,
      numericValue,
      textValue,
      unit: source.unit,
      // Provenance travels with the value. A figure read from a register and a
      // figure quoted by a staff member both become baseline metrics, but they
      // never stop being distinguishable.
      classification: response.classification,
      sourceReference: `assessment_response:${response.responseId}`,
      evidenceCount: response.evidenceCount,
    });
  }

  return { metrics, gaps };
}

function coerce(answer: unknown): { numericValue: number | null; textValue: string | null } {
  if (typeof answer === 'number') return { numericValue: answer, textValue: null };
  if (typeof answer === 'boolean') return { numericValue: answer ? 1 : 0, textValue: String(answer) };
  if (Array.isArray(answer)) return { numericValue: answer.length, textValue: answer.join(', ') };
  if (typeof answer === 'string') {
    // A numeric string is still a number. A non-numeric one stays text rather
    // than becoming NaN.
    const parsed = Number(answer);
    return Number.isFinite(parsed) && answer.trim() !== ''
      ? { numericValue: parsed, textValue: answer }
      : { numericValue: null, textValue: answer };
  }
  return { numericValue: null, textValue: JSON.stringify(answer) };
}

// -----------------------------------------------------------------------------
// Sealing preconditions
// -----------------------------------------------------------------------------

export interface SealGate {
  canSeal: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Whether a baseline may be sealed.
 *
 * Sealing is irreversible, so the gate is deliberately strict about the things
 * that cannot be fixed afterwards, and merely loud about the things that can.
 */
export function evaluateSeal(input: {
  assessmentStatus: string;
  completionPercent: number;
  minimumCompletionPercent: number;
  unverifiedEvidenceCount: number;
  pendingMediaCount: number;
  derivationGapCount: number;
  existingSequence: number | null;
}): SealGate {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.assessmentStatus !== 'SUBMITTED' && input.assessmentStatus !== 'VERIFIED') {
    blockers.push(
      `The assessment is ${input.assessmentStatus}. Submit it before sealing a baseline from it.`,
    );
  }

  if (input.completionPercent < input.minimumCompletionPercent) {
    blockers.push(
      `The assessment is ${input.completionPercent}% complete, below the ${input.minimumCompletionPercent}% required to seal a baseline. ` +
        'A baseline is the reference point for every later comparison, so it cannot be sealed from a thin assessment.',
    );
  }

  if (input.pendingMediaCount > 0) {
    blockers.push(
      `${input.pendingMediaCount} evidence file(s) have not finished uploading. ` +
        'Sealing now would produce a baseline whose evidence cannot be retrieved.',
    );
  }

  if (input.derivationGapCount > 0) {
    warnings.push(
      `${input.derivationGapCount} baseline metric(s) could not be derived and will be recorded as gaps. ` +
        'They will show as "not captured" in every report, not as zero.',
    );
  }

  if (input.unverifiedEvidenceCount > 0) {
    warnings.push(
      `${input.unverifiedEvidenceCount} evidence item(s) have not been independently verified. ` +
        'They remain usable, but will be classified REPORTED rather than VERIFIED.',
    );
  }

  if (input.existingSequence !== null) {
    warnings.push(
      `This facility already has a sealed baseline (sequence ${input.existingSequence}). ` +
        `This will be sealed as sequence ${input.existingSequence + 1}; the original Day 0 baseline is never replaced.`,
    );
  }

  return { canSeal: blockers.length === 0, blockers, warnings };
}
