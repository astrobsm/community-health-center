import type { AssessmentProgress, SectionProgress } from '@chc/contracts';

/**
 * Assessment completion (spec §61).
 *
 * Derived from responses — never typed. The number an assessor sees at the top
 * of the screen is the same number the submission gate uses, because there is
 * only one of them.
 */

export interface ProgressItem {
  itemId: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string;
  sectionSequence: number;
  isRequired: boolean;
  evidenceRequired: boolean;
}

export interface ProgressResponse {
  itemId: string;
  answered: boolean;
  notApplicable: boolean;
  evidenceCount: number;
}

/**
 * An item marked NOT APPLICABLE counts as complete.
 *
 * That is a deliberate choice: the assessor has made a decision about it, and
 * the alternative would leave every assessment of a facility without a
 * laboratory permanently stuck below 100% with no way to finish.
 */
export function computeProgress(
  assessmentId: string,
  items: readonly ProgressItem[],
  responses: readonly ProgressResponse[],
  now: Date,
): AssessmentProgress {
  const byItem = new Map(responses.map((r) => [r.itemId, r]));

  interface Accumulator {
    sectionId: string;
    code: string;
    name: string;
    sequence: number;
    requiredItems: number;
    answeredRequired: number;
    totalItems: number;
    answeredTotal: number;
    notApplicable: number;
    missingEvidence: number;
  }

  const sections = new Map<string, Accumulator>();
  let requiredItems = 0;
  let answeredRequired = 0;
  let missingEvidence = 0;

  for (const item of items) {
    const accumulator = sections.get(item.sectionId) ?? {
      sectionId: item.sectionId,
      code: item.sectionCode,
      name: item.sectionName,
      sequence: item.sectionSequence,
      requiredItems: 0,
      answeredRequired: 0,
      totalItems: 0,
      answeredTotal: 0,
      notApplicable: 0,
      missingEvidence: 0,
    };

    const response = byItem.get(item.itemId);
    const resolved = Boolean(response && (response.answered || response.notApplicable));

    accumulator.totalItems += 1;
    if (resolved) accumulator.answeredTotal += 1;
    if (response?.notApplicable) accumulator.notApplicable += 1;

    if (item.isRequired) {
      accumulator.requiredItems += 1;
      requiredItems += 1;
      if (resolved) {
        accumulator.answeredRequired += 1;
        answeredRequired += 1;
      }
    }

    // Evidence is only owed for an item that was actually answered. Demanding a
    // photograph for a question marked not-applicable would be nonsense.
    if (item.evidenceRequired && response?.answered && !response.notApplicable && response.evidenceCount === 0) {
      accumulator.missingEvidence += 1;
      missingEvidence += 1;
    }

    sections.set(item.sectionId, accumulator);
  }

  const sectionProgress: SectionProgress[] = [...sections.values()]
    .map((s) => ({
      sectionId: s.sectionId,
      code: s.code,
      name: s.name,
      sequence: s.sequence,
      requiredItems: s.requiredItems,
      answeredRequired: s.answeredRequired,
      totalItems: s.totalItems,
      answeredTotal: s.answeredTotal,
      notApplicable: s.notApplicable,
      completionPercent: percent(s.answeredRequired, s.requiredItems),
      missingEvidence: s.missingEvidence,
    }))
    .sort((a, b) => a.sequence - b.sequence);

  return {
    assessmentId,
    completionPercent: percent(answeredRequired, requiredItems),
    requiredItems,
    answeredRequired,
    missingEvidence,
    sections: sectionProgress,
    computedAt: now.toISOString(),
  };
}

/**
 * A template with no required items is 100% complete, not 0%.
 *
 * Dividing by zero here would make an empty section look permanently
 * unfinished and block submission for a reason nobody could act on.
 */
function percent(answered: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((answered / total) * 10000) / 100;
}

export interface SubmissionGate {
  canSubmit: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Whether an assessment may be submitted.
 *
 * Missing evidence on items that require it is a BLOCKER: an unevidenced claim
 * about a facility is exactly what this system exists to stop. Falling below
 * the completeness threshold is a WARNING that the assessor may acknowledge —
 * fieldwork is sometimes genuinely interrupted, and forcing a false 100% would
 * be worse than recording an honest 82%.
 */
export function evaluateSubmission(
  progress: AssessmentProgress,
  options: { minimumCompletionPercent: number; acknowledgedIncomplete: boolean },
): SubmissionGate {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (progress.missingEvidence > 0) {
    const sections = progress.sections
      .filter((s) => s.missingEvidence > 0)
      .map((s) => `${s.name} (${s.missingEvidence})`)
      .join(', ');
    blockers.push(
      `${progress.missingEvidence} answered item(s) require evidence and have none: ${sections}. ` +
        'Attach the evidence, or mark the item not applicable if it does not apply here.',
    );
  }

  if (progress.completionPercent < options.minimumCompletionPercent) {
    const message =
      `The assessment is ${progress.completionPercent}% complete, below the ${options.minimumCompletionPercent}% threshold. ` +
      `${progress.requiredItems - progress.answeredRequired} required item(s) remain unanswered.`;

    if (options.acknowledgedIncomplete) warnings.push(message);
    else blockers.push(`${message} Submit anyway only by acknowledging that it is incomplete.`);
  }

  return { canSubmit: blockers.length === 0, blockers, warnings };
}
