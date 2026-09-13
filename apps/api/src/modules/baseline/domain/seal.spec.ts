import type { BaselineMetric } from '@chc/contracts';
import { describe, expect, it } from 'vitest';

import {
  computeContentHash,
  deriveMetrics,
  evaluateSeal,
  verifyContentHash,
  type MetricSource,
  type SourceResponse,
} from './seal';

const metric = (overrides: Partial<BaselineMetric> = {}): BaselineMetric => ({
  metricCode: 'patients_per_day',
  metricName: 'Patients per day',
  domainCode: 'UTILISATION',
  numericValue: 8,
  textValue: null,
  unit: 'patients/day',
  classification: 'VERIFIED',
  sourceReference: 'assessment_response:r1',
  evidenceCount: 2,
  ...overrides,
});

describe('content hash — tamper evidence', () => {
  it('is stable for the same metrics', () => {
    const metrics = [metric()];
    expect(computeContentHash('f1', 1, '2026-02-05', metrics)).toBe(
      computeContentHash('f1', 1, '2026-02-05', metrics),
    );
  });

  it('is independent of metric order', () => {
    const a = [metric({ metricCode: 'a' }), metric({ metricCode: 'b' })];
    const b = [metric({ metricCode: 'b' }), metric({ metricCode: 'a' })];

    expect(computeContentHash('f1', 1, '2026-02-05', a)).toBe(computeContentHash('f1', 1, '2026-02-05', b));
  });

  it('changes when a measured VALUE changes', () => {
    const original = computeContentHash('f1', 1, '2026-02-05', [metric({ numericValue: 8 })]);
    const tampered = computeContentHash('f1', 1, '2026-02-05', [metric({ numericValue: 31 })]);

    expect(tampered).not.toBe(original);
  });

  it('changes when a classification is altered', () => {
    // Quietly promoting REPORTED to VERIFIED is precisely the tampering worth
    // detecting: the number is unchanged, its authority is not.
    const original = computeContentHash('f1', 1, '2026-02-05', [metric({ classification: 'REPORTED' })]);
    const tampered = computeContentHash('f1', 1, '2026-02-05', [metric({ classification: 'VERIFIED' })]);

    expect(tampered).not.toBe(original);
  });

  it('changes when the evidence count is altered', () => {
    const original = computeContentHash('f1', 1, '2026-02-05', [metric({ evidenceCount: 2 })]);
    const tampered = computeContentHash('f1', 1, '2026-02-05', [metric({ evidenceCount: 0 })]);

    expect(tampered).not.toBe(original);
  });

  it('is NOT affected by a cosmetic change to a display name', () => {
    // Renaming a metric label must not look like tampering.
    const a = computeContentHash('f1', 1, '2026-02-05', [metric({ metricName: 'Patients per day' })]);
    const b = computeContentHash('f1', 1, '2026-02-05', [metric({ metricName: 'Daily patient volume' })]);

    expect(a).toBe(b);
  });

  it('treats 8 and 8.0 as the same measurement', () => {
    expect(computeContentHash('f1', 1, '2026-02-05', [metric({ numericValue: 8 })])).toBe(
      computeContentHash('f1', 1, '2026-02-05', [metric({ numericValue: 8.0 })]),
    );
  });

  it('is bound to the facility, sequence and date', () => {
    const metrics = [metric()];
    const base = computeContentHash('f1', 1, '2026-02-05', metrics);

    expect(computeContentHash('f2', 1, '2026-02-05', metrics)).not.toBe(base);
    expect(computeContentHash('f1', 2, '2026-02-05', metrics)).not.toBe(base);
    expect(computeContentHash('f1', 1, '2026-03-05', metrics)).not.toBe(base);
  });

  it('cannot be forged by moving content between adjacent fields', () => {
    // Field values are separated in the digest, so "ab" + "c" and "a" + "bc"
    // must not collide.
    const a = [metric({ metricCode: 'ab', textValue: 'c', numericValue: null })];
    const b = [metric({ metricCode: 'a', textValue: 'bc', numericValue: null })];

    expect(computeContentHash('f1', 1, '2026-02-05', a)).not.toBe(computeContentHash('f1', 1, '2026-02-05', b));
  });

  it('verifies an untampered snapshot and rejects a tampered one', () => {
    const metrics = [metric()];
    const hash = computeContentHash('f1', 1, '2026-02-05', metrics);

    expect(verifyContentHash('f1', 1, '2026-02-05', metrics, hash)).toBe(true);
    expect(verifyContentHash('f1', 1, '2026-02-05', [metric({ numericValue: 99 })], hash)).toBe(false);
  });
});

describe('deriveMetrics — missing data becomes a gap, never a zero', () => {
  const source: MetricSource = {
    metricCode: 'patients_per_day',
    metricName: 'Patients per day',
    domainCode: 'UTILISATION',
    unit: 'patients/day',
    itemCode: 'UTL_OPD_PER_DAY',
  };

  const answered = (overrides: Partial<SourceResponse> = {}): SourceResponse => ({
    itemCode: 'UTL_OPD_PER_DAY',
    responseId: 'r1',
    answer: 8,
    notApplicable: false,
    classification: 'VERIFIED',
    evidenceCount: 1,
    ...overrides,
  });

  it('derives a metric from an answered item, carrying its provenance', () => {
    const { metrics, gaps } = deriveMetrics([source], [answered()]);

    expect(gaps).toEqual([]);
    expect(metrics[0]).toMatchObject({
      metricCode: 'patients_per_day',
      numericValue: 8,
      classification: 'VERIFIED',
      sourceReference: 'assessment_response:r1',
      evidenceCount: 1,
    });
  });

  it('records an UNANSWERED item as a gap rather than zero', () => {
    // A baseline that quietly records "0 patients/day" because nobody counted
    // is a false fact every later comparison inherits.
    const { metrics, gaps } = deriveMetrics([source], []);

    expect(metrics).toEqual([]);
    expect(gaps[0]?.reason).toMatch(/not answered/i);
  });

  it('records a BLANK answer as a gap', () => {
    const { metrics, gaps } = deriveMetrics([source], [answered({ answer: null })]);
    expect(metrics).toEqual([]);
    expect(gaps[0]?.reason).toMatch(/blank/i);
  });

  it('records a NOT-APPLICABLE item as a gap, with that reason', () => {
    const { gaps } = deriveMetrics([source], [answered({ notApplicable: true })]);
    expect(gaps[0]?.reason).toMatch(/not applicable/i);
  });

  it('preserves a REPORTED classification rather than upgrading it', () => {
    const { metrics } = deriveMetrics([source], [answered({ classification: 'REPORTED' })]);
    expect(metrics[0]?.classification).toBe('REPORTED');
  });

  it('coerces a numeric string to a number but keeps the original text', () => {
    const { metrics } = deriveMetrics([source], [answered({ answer: '31' })]);
    expect(metrics[0]?.numericValue).toBe(31);
    expect(metrics[0]?.textValue).toBe('31');
  });

  it('keeps non-numeric text as text rather than producing NaN', () => {
    const { metrics } = deriveMetrics([source], [answered({ answer: 'about thirty' })]);
    expect(metrics[0]?.numericValue).toBeNull();
    expect(metrics[0]?.textValue).toBe('about thirty');
  });

  it('records a multiselect as both a count and its contents', () => {
    const { metrics } = deriveMetrics([source], [answered({ answer: ['Malaria RDT', 'Urinalysis'] })]);
    expect(metrics[0]?.numericValue).toBe(2);
    expect(metrics[0]?.textValue).toBe('Malaria RDT, Urinalysis');
  });
});

describe('evaluateSeal — sealing is irreversible, so the gate is strict', () => {
  const base = {
    assessmentStatus: 'SUBMITTED',
    completionPercent: 95,
    minimumCompletionPercent: 80,
    unverifiedEvidenceCount: 0,
    pendingMediaCount: 0,
    derivationGapCount: 0,
    existingSequence: null,
  };

  it('permits sealing from a submitted, sufficiently complete assessment', () => {
    const gate = evaluateSeal(base);
    expect(gate.canSeal).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  it('refuses to seal from an assessment still in progress', () => {
    const gate = evaluateSeal({ ...base, assessmentStatus: 'IN_PROGRESS' });
    expect(gate.canSeal).toBe(false);
    expect(gate.blockers[0]).toMatch(/Submit it before sealing/);
  });

  it('refuses to seal a thin assessment, with no acknowledgement escape', () => {
    // Submission can be acknowledged as incomplete; sealing cannot. A baseline
    // is the reference point for everything that follows.
    const gate = evaluateSeal({ ...base, completionPercent: 42 });
    expect(gate.canSeal).toBe(false);
    expect(gate.blockers[0]).toMatch(/42% complete/);
  });

  it('refuses to seal while evidence is still uploading', () => {
    // Otherwise the baseline references photographs that can never be fetched.
    const gate = evaluateSeal({ ...base, pendingMediaCount: 4 });
    expect(gate.canSeal).toBe(false);
    expect(gate.blockers[0]).toMatch(/have not finished uploading/);
  });

  it('warns about derivation gaps but does not block on them', () => {
    const gate = evaluateSeal({ ...base, derivationGapCount: 3 });
    expect(gate.canSeal).toBe(true);
    expect(gate.warnings[0]).toMatch(/not as zero/);
  });

  it('warns that unverified evidence stays REPORTED', () => {
    const gate = evaluateSeal({ ...base, unverifiedEvidenceCount: 7 });
    expect(gate.canSeal).toBe(true);
    expect(gate.warnings[0]).toMatch(/REPORTED rather than VERIFIED/);
  });

  it('makes clear that a re-seal never replaces the original Day 0', () => {
    const gate = evaluateSeal({ ...base, existingSequence: 1 });
    expect(gate.canSeal).toBe(true);
    expect(gate.warnings[0]).toMatch(/sequence 2.*never replaced/s);
  });

  it('reports every blocker at once rather than one at a time', () => {
    const gate = evaluateSeal({
      ...base,
      assessmentStatus: 'DRAFT',
      completionPercent: 10,
      pendingMediaCount: 2,
    });

    expect(gate.blockers).toHaveLength(3);
  });
});
