import type { Completeness, DataClassification, DocumentSection, DocumentType } from '@chc/contracts';
import { DEFAULT_COMPLETENESS_THRESHOLDS, weakest } from '@chc/contracts';

/**
 * Completeness and classification (spec §82, doc 16 §3).
 *
 * This is the mechanism that makes non-fabrication mechanical rather than a
 * matter of care. A figure is either resolved — with a classification and a
 * source — or it is a gap that says what is missing and what would fix it.
 * There is no third state, and nothing in the pipeline can turn a gap into a
 * zero.
 *
 * Pure: no I/O, no clock.
 */

export function assessCompleteness(sections: readonly DocumentSection[]): Completeness {
  const gaps: Completeness['gaps'] = [];
  const classificationSummary: Record<string, number> = {};

  let total = 0;
  let resolved = 0;
  const classifications: DataClassification[] = [];

  for (const section of sections) {
    for (const field of section.fields) {
      total += 1;

      if (field.kind === 'GAP') {
        gaps.push({
          section: section.heading,
          label: field.label,
          reason: field.reason,
          remedy: field.remedy,
        });
        continue;
      }

      resolved += 1;
      classificationSummary[field.classification] = (classificationSummary[field.classification] ?? 0) + 1;
      classifications.push(field.classification);
    }
  }

  return {
    totalFields: total,
    resolvedFields: resolved,
    // A document with nothing to resolve is vacuously complete. Reporting 0%
    // would block a letter, which has no figures at all, from ever being sent.
    completenessPercent: total === 0 ? 100 : round2((resolved / total) * 100),
    gaps,
    classificationSummary,
    // Null rather than ESTIMATED when there is nothing to classify: a document
    // with no figures rests on nothing, and saying "ESTIMATED" would invent a
    // basis for figures that do not exist.
    weakestClassification: classifications.length === 0 ? null : weakest(classifications),
  };
}

export interface SubmissionCheck {
  canSubmit: boolean;
  threshold: number;
  completenessPercent: number;
  blockingGaps: Completeness['gaps'];
  reason?: string;
}

/**
 * Whether a document may be sent for approval.
 *
 * A proposal that reaches a government partner half-populated damages the
 * credibility of every figure in it, including the ones that were right — so
 * the threshold is a gate, not a warning.
 */
export function checkSubmission(
  documentType: DocumentType,
  completeness: Completeness,
  thresholds: Partial<Record<DocumentType, number>> = {},
): SubmissionCheck {
  const threshold = thresholds[documentType] ?? DEFAULT_COMPLETENESS_THRESHOLDS[documentType];
  const canSubmit = completeness.completenessPercent >= threshold;

  return {
    canSubmit,
    threshold,
    completenessPercent: completeness.completenessPercent,
    blockingGaps: completeness.gaps,
    ...(canSubmit
      ? {}
      : {
          reason:
            `This document is ${completeness.completenessPercent}% complete; a ${humanise(documentType)} ` +
            `requires ${threshold}%. ${completeness.gaps.length} item(s) are missing. ` +
            'Fill them in, or record explicitly why they cannot be obtained.',
        }),
  };
}

/**
 * The one line that describes how far a reader may trust the whole document.
 *
 * Aggregating figures of different classifications into a single number would
 * silently promote the weakest of them, so the document states the weakest
 * class it contains and labels every figure individually (§10, §82).
 */
export function trustStatement(completeness: Completeness): string {
  if (completeness.resolvedFields === 0) {
    return 'This document contains no quantitative figures.';
  }

  const parts = Object.entries(completeness.classificationSummary)
    .sort((a, b) => b[1] - a[1])
    .map(([classification, count]) => `${count} ${classification}`);

  return (
    `${completeness.resolvedFields} figure(s): ${parts.join(', ')}. ` +
    `The weakest basis any figure in this document rests on is ${completeness.weakestClassification}. ` +
    'Figures are labelled individually and are not aggregated across classes.'
  );
}

function humanise(documentType: DocumentType): string {
  return documentType.toLowerCase().replace(/_/g, ' ');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
