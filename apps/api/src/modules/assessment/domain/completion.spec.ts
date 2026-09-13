import { describe, expect, it } from 'vitest';

import {
  computeProgress,
  evaluateSubmission,
  type ProgressItem,
  type ProgressResponse,
} from './completion';

const NOW = new Date('2026-09-14T00:00:00.000Z');

const item = (
  itemId: string,
  sectionId: string,
  overrides: Partial<ProgressItem> = {},
): ProgressItem => ({
  itemId,
  sectionId,
  sectionCode: sectionId,
  sectionName: sectionId,
  sectionSequence: 1,
  isRequired: true,
  evidenceRequired: false,
  ...overrides,
});

const answered = (itemId: string, overrides: Partial<ProgressResponse> = {}): ProgressResponse => ({
  itemId,
  answered: true,
  notApplicable: false,
  evidenceCount: 0,
  ...overrides,
});

describe('computeProgress', () => {
  it('reports completion against REQUIRED items only', () => {
    const items = [item('a', 's1'), item('b', 's1'), item('c', 's1', { isRequired: false })];
    const progress = computeProgress('asmt', items, [answered('a')], NOW);

    expect(progress.requiredItems).toBe(2);
    expect(progress.answeredRequired).toBe(1);
    expect(progress.completionPercent).toBe(50);
  });

  it('counts a not-applicable item as resolved', () => {
    // Otherwise every assessment of a facility without a laboratory would be
    // permanently stuck below 100% with no way to finish.
    const items = [item('a', 's1'), item('b', 's1')];
    const responses = [answered('a'), { itemId: 'b', answered: false, notApplicable: true, evidenceCount: 0 }];

    const progress = computeProgress('asmt', items, responses, NOW);

    expect(progress.completionPercent).toBe(100);
    expect(progress.sections[0]?.notApplicable).toBe(1);
  });

  it('treats a template with no required items as complete, not as zero', () => {
    const progress = computeProgress('asmt', [item('a', 's1', { isRequired: false })], [], NOW);
    expect(progress.completionPercent).toBe(100);
  });

  it('reports progress per section, in template order', () => {
    const items = [
      item('a', 's2', { sectionSequence: 2, sectionName: 'Utilities' }),
      item('b', 's1', { sectionSequence: 1, sectionName: 'Infrastructure' }),
      item('c', 's1', { sectionSequence: 1, sectionName: 'Infrastructure' }),
    ];
    const progress = computeProgress('asmt', items, [answered('b')], NOW);

    expect(progress.sections.map((s) => s.name)).toEqual(['Infrastructure', 'Utilities']);
    expect(progress.sections[0]?.completionPercent).toBe(50);
    expect(progress.sections[1]?.completionPercent).toBe(0);
  });

  it('flags an answered item that owes evidence and has none', () => {
    const items = [item('a', 's1', { evidenceRequired: true })];
    const progress = computeProgress('asmt', items, [answered('a', { evidenceCount: 0 })], NOW);

    expect(progress.missingEvidence).toBe(1);
  });

  it('does not demand evidence for an unanswered or not-applicable item', () => {
    // Asking for a photograph of a question nobody answered is nonsense.
    const items = [item('a', 's1', { evidenceRequired: true }), item('b', 's1', { evidenceRequired: true })];
    const responses = [{ itemId: 'b', answered: false, notApplicable: true, evidenceCount: 0 }];

    expect(computeProgress('asmt', items, responses, NOW).missingEvidence).toBe(0);
  });

  it('rounds to two decimal places rather than misreporting 100%', () => {
    // 2 of 3 must not round up to something that looks finished.
    const items = [item('a', 's1'), item('b', 's1'), item('c', 's1')];
    const progress = computeProgress('asmt', items, [answered('a'), answered('b')], NOW);

    expect(progress.completionPercent).toBe(66.67);
  });

  it('takes its timestamp from the injected clock', () => {
    expect(computeProgress('asmt', [], [], NOW).computedAt).toBe('2026-09-14T00:00:00.000Z');
  });
});

describe('evaluateSubmission', () => {
  const progressWith = (completionPercent: number, missingEvidence = 0) =>
    computeProgress(
      'asmt',
      Array.from({ length: 100 }, (_, i) => item(`i${i}`, 's1', { evidenceRequired: i < missingEvidence })),
      Array.from({ length: Math.round(completionPercent) }, (_, i) => answered(`i${i}`)),
      NOW,
    );

  it('allows submission of a sufficiently complete assessment', () => {
    const gate = evaluateSubmission(progressWith(95), {
      minimumCompletionPercent: 80,
      acknowledgedIncomplete: false,
    });

    expect(gate.canSubmit).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  it('BLOCKS submission when an answered item owes evidence', () => {
    // Not a warning. An unevidenced claim about a facility is exactly what this
    // system exists to prevent, and it cannot be fixed after the fact.
    const gate = evaluateSubmission(progressWith(100, 3), {
      minimumCompletionPercent: 80,
      acknowledgedIncomplete: true,
    });

    expect(gate.canSubmit).toBe(false);
    expect(gate.blockers[0]).toMatch(/require evidence/i);
  });

  it('blocks an incomplete assessment until the assessor acknowledges it', () => {
    const gate = evaluateSubmission(progressWith(55), {
      minimumCompletionPercent: 80,
      acknowledgedIncomplete: false,
    });

    expect(gate.canSubmit).toBe(false);
    expect(gate.blockers[0]).toMatch(/55% complete/);
  });

  it('allows an acknowledged incomplete submission, and records it as a warning', () => {
    // Fieldwork is genuinely interrupted sometimes. Forcing a false 100% would
    // be worse than recording an honest 55%.
    const gate = evaluateSubmission(progressWith(55), {
      minimumCompletionPercent: 80,
      acknowledgedIncomplete: true,
    });

    expect(gate.canSubmit).toBe(true);
    expect(gate.warnings[0]).toMatch(/55% complete/);
    expect(gate.blockers).toEqual([]);
  });

  it('names how many items remain, not just a percentage', () => {
    const gate = evaluateSubmission(progressWith(70), {
      minimumCompletionPercent: 80,
      acknowledgedIncomplete: false,
    });

    expect(gate.blockers[0]).toMatch(/30 required item\(s\) remain/);
  });
});
