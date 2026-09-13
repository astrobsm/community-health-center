import type { ScoringRule } from '@chc/contracts';
import { describe, expect, it } from 'vitest';

import { computeReadiness, scoreItem, type ScoreableItem, type ScoreableResponse } from './scoring';

const NOW = new Date('2026-09-14T00:00:00.000Z');

const response = (answer: unknown, notApplicable = false): ScoreableResponse => ({
  itemId: 'i1',
  answer: answer as ScoreableResponse['answer'],
  notApplicable,
});

describe('scoreItem — the distinction between "scored zero" and "not scored"', () => {
  const rule: ScoringRule = { kind: 'BOOLEAN', trueScore: 1 };

  it('scores a true boolean at the configured score', () => {
    expect(scoreItem(rule, response(true))).toEqual({ scored: true, score: 1 });
  });

  it('scores false as the complement, not as unscored', () => {
    expect(scoreItem(rule, response(false))).toEqual({ scored: true, score: 0 });
  });

  it('honours a partial credit configuration', () => {
    expect(scoreItem({ kind: 'BOOLEAN', trueScore: 0.6 }, response(true))).toEqual({ scored: true, score: 0.6 });
    expect(scoreItem({ kind: 'BOOLEAN', trueScore: 0.6 }, response(false))).toEqual({
      scored: true,
      score: 0.4,
    });
  });

  it('EXCLUDES a not-applicable item rather than scoring it zero', () => {
    // The heart of the scoring model: a facility with no laboratory must not be
    // marked down for a missing centrifuge.
    expect(scoreItem(rule, response(true, true))).toEqual({ scored: false, reason: 'NOT_APPLICABLE' });
  });

  it('reports an unanswered item as unanswered, not as a failure', () => {
    expect(scoreItem(rule, undefined)).toEqual({ scored: false, reason: 'UNANSWERED' });
    expect(scoreItem(rule, response(null))).toEqual({ scored: false, reason: 'UNANSWERED' });
  });

  it('treats an item with no rule, or NOT_SCORED, as unscoreable', () => {
    expect(scoreItem(null, response(true))).toEqual({ scored: false, reason: 'NOT_SCOREABLE' });
    expect(scoreItem({ kind: 'NOT_SCORED' }, response('a long observation'))).toEqual({
      scored: false,
      reason: 'NOT_SCOREABLE',
    });
  });

  it('rejects an answer of the wrong shape instead of coercing it', () => {
    // A string where a boolean belongs is a client bug. Coercing "false" to
    // true would silently corrupt the index.
    expect(scoreItem(rule, response('yes'))).toEqual({ scored: false, reason: 'NOT_SCOREABLE' });
  });
});

describe('SCALE', () => {
  const rule: ScoringRule = { kind: 'SCALE', min: 1, max: 5, inverted: false };

  it('normalises across the range', () => {
    expect(scoreItem(rule, response(1))).toEqual({ scored: true, score: 0 });
    expect(scoreItem(rule, response(3))).toEqual({ scored: true, score: 0.5 });
    expect(scoreItem(rule, response(5))).toEqual({ scored: true, score: 1 });
  });

  it('inverts when a lower value is better', () => {
    const inverted: ScoringRule = { kind: 'SCALE', min: 1, max: 5, inverted: true };
    expect(scoreItem(inverted, response(1))).toEqual({ scored: true, score: 1 });
    expect(scoreItem(inverted, response(5))).toEqual({ scored: true, score: 0 });
  });

  it('clamps values outside the declared range', () => {
    expect(scoreItem(rule, response(9))).toEqual({ scored: true, score: 1 });
    expect(scoreItem(rule, response(-4))).toEqual({ scored: true, score: 0 });
  });

  it('treats a degenerate range as a template defect, not a zero score', () => {
    expect(scoreItem({ kind: 'SCALE', min: 3, max: 3, inverted: false }, response(3))).toEqual({
      scored: false,
      reason: 'NOT_SCOREABLE',
    });
  });
});

describe('NUMBER', () => {
  const rule: ScoringRule = { kind: 'NUMBER', target: 4, inverted: false };

  it('scores proportionally up to the target', () => {
    expect(scoreItem(rule, response(0))).toEqual({ scored: true, score: 0 });
    expect(scoreItem(rule, response(2))).toEqual({ scored: true, score: 0.5 });
    expect(scoreItem(rule, response(4))).toEqual({ scored: true, score: 1 });
  });

  it('caps above the target rather than rewarding surplus', () => {
    // Six working BP machines is not twice as ready as three.
    expect(scoreItem(rule, response(12))).toEqual({ scored: true, score: 1 });
  });

  it('decays from the target when lower is better', () => {
    const inverted: ScoringRule = { kind: 'NUMBER', target: 2, inverted: true };
    expect(scoreItem(inverted, response(0))).toEqual({ scored: true, score: 1 });
    expect(scoreItem(inverted, response(2))).toEqual({ scored: true, score: 1 });
    expect(scoreItem(inverted, response(4))).toEqual({ scored: true, score: 0.5 });
  });
});

describe('SELECT and MULTISELECT', () => {
  const select: ScoringRule = {
    kind: 'SELECT',
    scores: { 'Incinerator on site': 1, 'Burial pit on site': 0.6, 'Open burning': 0.1 },
  };

  it('maps a choice to its configured score', () => {
    expect(scoreItem(select, response('Incinerator on site'))).toEqual({ scored: true, score: 1 });
    expect(scoreItem(select, response('Burial pit on site'))).toEqual({ scored: true, score: 0.6 });
  });

  it('scores an unmapped choice zero, deliberately', () => {
    // The template author listed the choices; an unscored one is an answer
    // they chose not to credit, not missing data.
    expect(scoreItem(select, response('No defined method'))).toEqual({ scored: true, score: 0 });
  });

  it('scores a multiselect as the proportion of expected choices present', () => {
    const rule: ScoringRule = { kind: 'MULTISELECT', expected: ['Malaria RDT', 'Urinalysis', 'PCV'] };
    expect(scoreItem(rule, response(['Malaria RDT', 'Urinalysis', 'PCV']))).toEqual({ scored: true, score: 1 });
    expect(scoreItem(rule, response(['Malaria RDT']))?.scored).toBe(true);
    expect((scoreItem(rule, response(['Malaria RDT'])) as { score: number }).score).toBeCloseTo(0.3333, 3);
    expect(scoreItem(rule, response([]))).toEqual({ scored: true, score: 0 });
  });

  it('ignores selections outside the expected set rather than rewarding them', () => {
    const rule: ScoringRule = { kind: 'MULTISELECT', expected: ['A', 'B'] };
    expect(scoreItem(rule, response(['A', 'X', 'Y', 'Z']))).toEqual({ scored: true, score: 0.5 });
  });
});

describe('computeReadiness', () => {
  const item = (
    itemId: string,
    sectionCode: string,
    rule: ScoringRule | null,
    itemWeight = 1,
    sectionWeight = 1,
  ): ScoreableItem => ({
    itemId,
    sectionCode,
    sectionName: sectionCode,
    sectionWeight,
    itemWeight,
    scoringRule: rule,
  });

  const bool: ScoringRule = { kind: 'BOOLEAN', trueScore: 1 };

  it('produces a weighted overall score across domains', () => {
    const items = [
      item('a', 'INFRA', bool, 1, 2),
      item('b', 'INFRA', bool, 1, 2),
      item('c', 'UTIL', bool, 1, 1),
    ];
    const responses: ScoreableResponse[] = [
      { itemId: 'a', answer: true, notApplicable: false },
      { itemId: 'b', answer: false, notApplicable: false },
      { itemId: 'c', answer: true, notApplicable: false },
    ];

    const result = computeReadiness(items, responses, NOW);

    // INFRA = 0.5 (weight 2), UTIL = 1.0 (weight 1) -> (0.5*2 + 1*1) / 3
    expect(result.domains.find((d) => d.domainCode === 'INFRA')?.normalisedScore).toBe(0.5);
    expect(result.domains.find((d) => d.domainCode === 'UTIL')?.normalisedScore).toBe(1);
    expect(result.overall).toBeCloseTo(0.6667, 3);
    expect(result.coverage).toBe(1);
  });

  it('honours item weight within a domain', () => {
    const items = [item('a', 'INFRA', bool, 3), item('b', 'INFRA', bool, 1)];
    const responses: ScoreableResponse[] = [
      { itemId: 'a', answer: true, notApplicable: false },
      { itemId: 'b', answer: false, notApplicable: false },
    ];

    // (1*3 + 0*1) / 4
    expect(computeReadiness(items, responses, NOW).overall).toBe(0.75);
  });

  it('excludes a fully not-applicable domain instead of scoring it zero', () => {
    // This is the difference between "this facility has no laboratory" and
    // "this facility has a terrible laboratory".
    const items = [item('a', 'INFRA', bool), item('b', 'LAB', bool)];
    const responses: ScoreableResponse[] = [
      { itemId: 'a', answer: true, notApplicable: false },
      { itemId: 'b', answer: null, notApplicable: true },
    ];

    const result = computeReadiness(items, responses, NOW);
    const lab = result.domains.find((d) => d.domainCode === 'LAB');

    expect(lab?.normalisedScore).toBeNull();
    expect(lab?.excludedItems).toBe(1);
    expect(result.overall).toBe(1); // INFRA alone, not dragged to 0.5
  });

  it('reports coverage so a high score over a thin sample is visible', () => {
    const items = [item('a', 'INFRA', bool), item('b', 'INFRA', bool), item('c', 'INFRA', bool)];
    const responses: ScoreableResponse[] = [{ itemId: 'a', answer: true, notApplicable: false }];

    const result = computeReadiness(items, responses, NOW);

    expect(result.overall).toBe(1); // perfect...
    expect(result.coverage).toBeCloseTo(0.3333, 3); // ...on a third of the items
  });

  it('does not count unscoreable items against coverage', () => {
    // Free-text observations are not failures to answer.
    const items = [item('a', 'INFRA', bool), item('b', 'INFRA', { kind: 'NOT_SCORED' })];
    const responses: ScoreableResponse[] = [{ itemId: 'a', answer: true, notApplicable: false }];

    expect(computeReadiness(items, responses, NOW).coverage).toBe(1);
  });

  it('returns null overall when nothing scoreable has been answered', () => {
    // Not zero. Zero would read as "assessed and found to be nothing".
    const items = [item('a', 'INFRA', bool)];
    const result = computeReadiness(items, [], NOW);

    expect(result.overall).toBeNull();
    expect(result.coverage).toBe(0);
  });

  it('is deterministic and order-independent', () => {
    const items = [item('a', 'B', bool), item('b', 'A', bool)];
    const responses: ScoreableResponse[] = [
      { itemId: 'a', answer: true, notApplicable: false },
      { itemId: 'b', answer: false, notApplicable: false },
    ];

    const first = computeReadiness(items, responses, NOW);
    const second = computeReadiness([...items].reverse(), [...responses].reverse(), NOW);

    expect(first.overall).toBe(second.overall);
    expect(first.domains.map((d) => d.domainCode)).toEqual(['A', 'B']);
    expect(second.domains.map((d) => d.domainCode)).toEqual(['A', 'B']);
  });

  it('takes its timestamp from the injected clock, never the ambient one', () => {
    expect(computeReadiness([], [], NOW).computedAt).toBe('2026-09-14T00:00:00.000Z');
  });
});
