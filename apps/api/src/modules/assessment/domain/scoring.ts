import type { Answer, DomainScore, ReadinessScore, ScoringRule } from '@chc/contracts';

/**
 * Facility condition index (spec §17).
 *
 * Pure: no I/O, no ambient clock. Every input is passed in, so the whole
 * scoring model can be exercised without a database.
 *
 * The single most important property here is that a NOT-APPLICABLE item is
 * EXCLUDED rather than scored zero. A health centre with no laboratory should
 * not be marked down for a missing centrifuge; it should be scored on the
 * domains that apply to it, with the exclusion visible in the output so nobody
 * mistakes a narrow assessment for a good one.
 */

export interface ScoreableItem {
  itemId: string;
  sectionCode: string;
  sectionName: string;
  sectionWeight: number;
  itemWeight: number;
  scoringRule: ScoringRule | null;
}

export interface ScoreableResponse {
  itemId: string;
  answer: Answer;
  notApplicable: boolean;
}

export type ItemScoreOutcome =
  | { scored: true; score: number }
  | { scored: false; reason: 'NOT_APPLICABLE' | 'UNANSWERED' | 'NOT_SCOREABLE' };

/**
 * Score a single answer against its rule, yielding 0..1.
 *
 * Returns an outcome rather than a number so the caller can distinguish
 * "scored zero" from "not scored at all" — a distinction that disappears if
 * you return 0 for both, and takes the meaning of the index with it.
 */
export function scoreItem(rule: ScoringRule | null, response: ScoreableResponse | undefined): ItemScoreOutcome {
  if (response?.notApplicable) return { scored: false, reason: 'NOT_APPLICABLE' };
  if (!rule || rule.kind === 'NOT_SCORED') return { scored: false, reason: 'NOT_SCOREABLE' };
  if (!response || response.answer === null || response.answer === undefined) {
    return { scored: false, reason: 'UNANSWERED' };
  }

  const { answer } = response;

  switch (rule.kind) {
    case 'BOOLEAN': {
      if (typeof answer !== 'boolean') return { scored: false, reason: 'NOT_SCOREABLE' };
      return { scored: true, score: clamp01(answer ? rule.trueScore : 1 - rule.trueScore) };
    }

    case 'SCALE': {
      if (typeof answer !== 'number') return { scored: false, reason: 'NOT_SCOREABLE' };
      // A degenerate range is a template defect, not a score of zero.
      if (rule.max === rule.min) return { scored: false, reason: 'NOT_SCOREABLE' };
      const normalised = (answer - rule.min) / (rule.max - rule.min);
      return { scored: true, score: clamp01(rule.inverted ? 1 - normalised : normalised) };
    }

    case 'NUMBER': {
      if (typeof answer !== 'number') return { scored: false, reason: 'NOT_SCOREABLE' };
      if (rule.inverted) {
        // Lower is better: at or below target scores 1, then decays.
        if (answer <= 0) return { scored: true, score: 1 };
        return { scored: true, score: clamp01(rule.target / Math.max(answer, rule.target)) };
      }
      // Higher is better, capped: exceeding the target is not rewarded further,
      // because six working BP machines is not twice as ready as three.
      return { scored: true, score: clamp01(answer / rule.target) };
    }

    case 'SELECT': {
      if (typeof answer !== 'string') return { scored: false, reason: 'NOT_SCOREABLE' };
      const score = rule.scores[answer];
      // An unmapped choice scores 0 deliberately: the template author listed
      // the choices, so an unscored one is a real answer they chose not to
      // credit, not a gap in the data.
      return { scored: true, score: clamp01(score ?? 0) };
    }

    case 'MULTISELECT': {
      if (!Array.isArray(answer)) return { scored: false, reason: 'NOT_SCOREABLE' };
      const selected = new Set(answer);
      const matched = rule.expected.filter((choice) => selected.has(choice)).length;
      return { scored: true, score: clamp01(matched / rule.expected.length) };
    }
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Roll item scores up into per-domain scores and one overall readiness score.
 *
 * Weighting is applied at both levels: within a domain by item weight, and
 * across domains by section weight. A domain in which everything was excluded
 * contributes nothing rather than dragging the total toward zero.
 */
export function computeReadiness(
  items: readonly ScoreableItem[],
  responses: readonly ScoreableResponse[],
  now: Date,
): ReadinessScore {
  const byItem = new Map(responses.map((r) => [r.itemId, r]));

  interface Accumulator {
    name: string;
    weight: number;
    weightedScore: number;
    weightTotal: number;
    scoredItems: number;
    excludedItems: number;
  }

  const domains = new Map<string, Accumulator>();
  let scoreableItems = 0;
  let answeredScoreable = 0;

  for (const item of items) {
    const accumulator = domains.get(item.sectionCode) ?? {
      name: item.sectionName,
      weight: item.sectionWeight,
      weightedScore: 0,
      weightTotal: 0,
      scoredItems: 0,
      excludedItems: 0,
    };

    const isScoreable = Boolean(item.scoringRule) && item.scoringRule?.kind !== 'NOT_SCORED';
    if (isScoreable) scoreableItems += 1;

    const outcome = scoreItem(item.scoringRule, byItem.get(item.itemId));

    if (outcome.scored) {
      accumulator.weightedScore += outcome.score * item.itemWeight;
      accumulator.weightTotal += item.itemWeight;
      accumulator.scoredItems += 1;
      answeredScoreable += 1;
    } else {
      accumulator.excludedItems += 1;
    }

    domains.set(item.sectionCode, accumulator);
  }

  const domainScores: DomainScore[] = [...domains.entries()].map(([domainCode, accumulator]) => ({
    domainCode,
    name: accumulator.name,
    rawScore: round(accumulator.weightedScore, 4),
    maxScore: round(accumulator.weightTotal, 4),
    weight: accumulator.weight,
    normalisedScore:
      accumulator.weightTotal > 0 ? round(accumulator.weightedScore / accumulator.weightTotal, 4) : null,
    scoredItems: accumulator.scoredItems,
    excludedItems: accumulator.excludedItems,
  }));

  const contributing = domainScores.filter((d) => d.normalisedScore !== null);
  const weightTotal = contributing.reduce((sum, d) => sum + d.weight, 0);

  const overall =
    weightTotal > 0
      ? round(
          contributing.reduce((sum, d) => sum + (d.normalisedScore ?? 0) * d.weight, 0) / weightTotal,
          4,
        )
      : null;

  return {
    overall,
    domains: domainScores.sort((a, b) => a.domainCode.localeCompare(b.domainCode)),
    coverage: scoreableItems > 0 ? round(answeredScoreable / scoreableItems, 4) : 0,
    computedAt: now.toISOString(),
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
