import type { DocumentSection, Provenance } from '@chc/contracts';
import { DRAFT_LEGAL_BANNER } from '@chc/contracts';
import { describe, expect, it } from 'vitest';

import { assessCompleteness, checkSubmission, trustStatement } from './completeness';
import { contentHash, merge, renderDocument, renderWithHash, tokensIn, UnresolvedTokenError } from './render';

const section = (overrides: Partial<DocumentSection> = {}): DocumentSection => ({
  key: 'baseline',
  heading: 'Baseline position',
  sequence: 1,
  fields: [],
  clauses: [],
  ...overrides,
});

const value = (label: string, v: string | number, classification: DocumentSection['fields'][number] extends never ? never : string) =>
  ({ kind: 'VALUE' as const, label, value: v, classification: classification as never, source: 'baseline_metric#b7e2' });

const gap = (label: string) =>
  ({
    kind: 'GAP' as const,
    label,
    reason: 'The laboratory section of the field assessment is 40% complete.',
    remedy: 'Complete the six outstanding laboratory items and re-generate.',
    source: 'facility_assessment#a41c',
  });

const provenance = (overrides: Partial<Provenance> = {}): Provenance => ({
  documentType: 'BASELINE_REPORT',
  title: 'Baseline Report — Community Health Centre, Ikem',
  reference: 'DOC-0001',
  versionNumber: 1,
  supersedesVersion: null,
  status: 'DRAFT',
  generatedAt: '2026-09-14T10:00:00.000Z',
  generatedBy: 'A. Okeke (Project Manager)',
  approvedBy: null,
  approvedAt: null,
  reportingPeriodStart: '2026-01-01',
  reportingPeriodEnd: '2026-08-31',
  sourceDatasets: [{ name: 'baseline_snapshot#b7e2', detail: 'sealed 2026-02-05' }],
  financialModel: null,
  contentHash: 'sha256:placeholder',
  completeness: assessCompleteness([]),
  ...overrides,
});

// -----------------------------------------------------------------------------
// document-no-fabrication.spec — the rule the whole module exists for
// -----------------------------------------------------------------------------

describe('missing data is shown, never filled', () => {
  const sections = [section({ fields: [gap('Tests available at baseline')] })];

  const html = renderDocument(
    provenance({ completeness: assessCompleteness(sections) }),
    sections,
  );

  it('says the data was not captured', () => {
    expect(html).toContain('DATA NOT CAPTURED');
  });

  it('never renders a gap as zero, a dash or a blank', () => {
    // The three substitutions that would each read as a real answer.
    const gapBlock = html.slice(html.indexOf('data-gap="true"'), html.indexOf('</dd>', html.indexOf('data-gap="true"')));

    expect(gapBlock).not.toMatch(/>\s*0\s*</);
    expect(gapBlock).not.toContain('—');
    expect(gapBlock).not.toContain('N/A');
  });

  it('says why it is missing and what would fix it', () => {
    expect(html).toContain('40% complete');
    expect(html).toContain('Complete the six outstanding laboratory items');
  });

  it('lists every gap again in the appendix, so none is buried mid-document', () => {
    expect(html).toContain('Outstanding data (1)');
  });

  it('counts a gap against completeness rather than ignoring it', () => {
    const mixed = [
      section({
        fields: [gap('Tests available'), value('Staff in post', 12, 'VERIFIED'), value('Beds', 8, 'VERIFIED')],
      }),
    ];

    const completeness = assessCompleteness(mixed);

    expect(completeness.totalFields).toBe(3);
    expect(completeness.resolvedFields).toBe(2);
    expect(completeness.completenessPercent).toBeCloseTo(66.67, 1);
  });
});

// -----------------------------------------------------------------------------
// document-classification.spec
// -----------------------------------------------------------------------------

describe('every figure is labelled', () => {
  const sections = [
    section({
      fields: [
        value('Patients seen', 1240, 'ACTUAL'),
        value('Staff in post', 12, 'VERIFIED'),
        value('Monthly running cost', 480_000, 'ESTIMATED'),
      ],
    }),
  ];

  const completeness = assessCompleteness(sections);
  const html = renderDocument(provenance({ completeness }), sections);

  it('renders a classification beside each figure', () => {
    expect(html).toContain('data-classification="ACTUAL"');
    expect(html).toContain('data-classification="VERIFIED"');
    expect(html).toContain('data-classification="ESTIMATED"');
  });

  it('counts them by class for the appendix', () => {
    expect(completeness.classificationSummary).toEqual({ ACTUAL: 1, VERIFIED: 1, ESTIMATED: 1 });
  });

  it('reports the weakest class the document rests on', () => {
    // A reader who trusts the document as far as its strongest figure would be
    // misled; the weakest is the honest headline.
    expect(completeness.weakestClassification).toBe('ESTIMATED');
  });

  it('says plainly that classes are not aggregated', () => {
    expect(trustStatement(completeness)).toContain('not aggregated across classes');
    expect(html).toContain('not aggregated across classes');
  });

  it('reports no figures rather than a misleading zero when there are none', () => {
    expect(trustStatement(assessCompleteness([]))).toBe('This document contains no quantitative figures.');
  });

  it('carries the method wherever a figure was calculated rather than observed', () => {
    const calculated = [
      section({
        fields: [
          {
            kind: 'VALUE' as const,
            label: 'Monthly running cost',
            value: 480_000,
            classification: 'ESTIMATED' as never,
            source: 'capex_line',
            method: 'Mean of the three months to August, inflated at 10% a year.',
          },
        ],
      }),
    ];

    expect(renderDocument(provenance(), calculated)).toContain('Method: Mean of the three months');
  });
});

// -----------------------------------------------------------------------------
// Submission gating
// -----------------------------------------------------------------------------

describe('completeness gates submission', () => {
  const twoOfThree = assessCompleteness([
    section({ fields: [gap('Tests available'), value('Staff', 12, 'VERIFIED'), value('Beds', 8, 'VERIFIED')] }),
  ]);

  it('blocks a proposal that is not complete enough', () => {
    const check = checkSubmission('FULL_PROPOSAL', twoOfThree);

    expect(check.canSubmit).toBe(false);
    expect(check.threshold).toBe(95);
    expect(check.reason).toContain('66.67% complete');
    expect(check.reason).toContain('1 item(s) are missing');
  });

  it('names the gaps that are blocking it', () => {
    expect(checkSubmission('FULL_PROPOSAL', twoOfThree).blockingGaps).toHaveLength(1);
  });

  it('allows a document that meets its threshold', () => {
    const complete = assessCompleteness([section({ fields: [value('Staff', 12, 'VERIFIED')] })]);

    expect(checkSubmission('FULL_PROPOSAL', complete).canSubmit).toBe(true);
  });

  it('holds a financial report and an MOU to nothing less than complete', () => {
    expect(checkSubmission('FIVE_YEAR_FINANCIAL_REPORT', twoOfThree).threshold).toBe(100);
    expect(checkSubmission('MOU', twoOfThree).threshold).toBe(100);
  });

  it('lets an organisation set its own threshold', () => {
    // Never hard-coded: a different organisation may reasonably draw the line
    // elsewhere, and the figure must be arguable (spec §89).
    const check = checkSubmission('FULL_PROPOSAL', twoOfThree, { FULL_PROPOSAL: 60 });

    expect(check.canSubmit).toBe(true);
    expect(check.threshold).toBe(60);
  });

  it('does not block a letter, which has no figures to be missing', () => {
    expect(checkSubmission('LETTER', assessCompleteness([])).canSubmit).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// mou-banner.spec
// -----------------------------------------------------------------------------

describe('the draft banner on a legal document', () => {
  const clauses = [
    section({ key: 'parties', heading: 'Parties', sequence: 1, clauses: [{ number: '1', heading: 'Parties', text: 'Between the parties named below.' }] }),
    section({ key: 'revenue', heading: 'Revenue', sequence: 2, clauses: [{ number: '2', heading: 'Revenue sharing', text: 'As set out in the schedule.' }] }),
    section({ key: 'term', heading: 'Term', sequence: 3, clauses: [{ number: '3', heading: 'Term', text: 'Ten years from the effective date.' }] }),
  ];

  const mou = renderDocument(provenance({ documentType: 'MOU', title: 'Memorandum of Understanding' }), clauses);

  it('carries the banner', () => {
    expect(mou).toContain(DRAFT_LEGAL_BANNER);
  });

  it('repeats it on every section, so it travels with the content', () => {
    // A banner only on page one is a banner that disappears the moment anyone
    // forwards an extract.
    const occurrences = mou.split(DRAFT_LEGAL_BANNER).length - 1;

    expect(occurrences).toBe(clauses.length + 1);
  });

  it('fixes it to every page when printed', () => {
    expect(mou).toContain('@media print');
    expect(mou).toContain('.draft-banner { position: fixed;');
  });

  it('marks the requirement in the document metadata', () => {
    expect(mou).toContain('data-draft-banner="required"');
  });

  it('carries it on a management agreement too', () => {
    expect(renderDocument(provenance({ documentType: 'MANAGEMENT_AGREEMENT' }), clauses)).toContain(DRAFT_LEGAL_BANNER);
  });

  it('drops it only for an executed copy', () => {
    const executed = renderDocument(provenance({ documentType: 'MOU' }), clauses, { isExecutedCopy: true });

    expect(executed).not.toContain(DRAFT_LEGAL_BANNER);
  });

  it('cannot be removed by asking for it to be removed', () => {
    // The only parameter is a claim about the contract, which a caller must be
    // able to defend. There is no "hideBanner".
    const options = { showBanner: false, hideBanner: true, draft: false } as never;

    expect(renderDocument(provenance({ documentType: 'MOU' }), clauses, options)).toContain(DRAFT_LEGAL_BANNER);
  });

  it('does not put a legal banner on a baseline report', () => {
    expect(renderDocument(provenance({ documentType: 'BASELINE_REPORT' }), clauses)).not.toContain(DRAFT_LEGAL_BANNER);
  });
});

describe('a superseded copy says so', () => {
  it('warns on a version that has been replaced', () => {
    const html = renderDocument(provenance({ versionNumber: 2, status: 'SUPERSEDED' }), [section()], {
      supersededByVersion: 3,
    });

    expect(html).toContain('SUPERSEDED — see version 3');
    expect(html).toContain('must not be acted on');
  });

  it('says nothing of the sort on a current one', () => {
    expect(renderDocument(provenance(), [section()])).not.toContain('SUPERSEDED — see version');
  });
});

// -----------------------------------------------------------------------------
// document-provenance.spec / document-reproducibility.spec
// -----------------------------------------------------------------------------

describe('provenance', () => {
  const sections = [section({ fields: [value('Staff in post', 12, 'VERIFIED')] })];
  const html = renderDocument(
    provenance({
      completeness: assessCompleteness(sections),
      approvedBy: 'N. Eze (Organisation Administrator)',
      approvedAt: '2026-09-13T16:40:00.000Z',
      status: 'APPROVED',
      versionNumber: 3,
      supersedesVersion: 2,
    }),
    sections,
  );

  it('states who generated it, who approved it and when', () => {
    expect(html).toContain('A. Okeke (Project Manager)');
    expect(html).toContain('N. Eze (Organisation Administrator)');
    expect(html).toContain('2026-09-13T16:40:00.000Z');
  });

  it('states which version it is and what it supersedes', () => {
    expect(html).toContain('v3 (supersedes v2)');
  });

  it('names the datasets the figures came from', () => {
    expect(html).toContain('baseline_snapshot#b7e2');
    expect(html).toContain('sealed 2026-02-05');
  });

  it('says so rather than leaving a blank when nothing was approved', () => {
    expect(renderDocument(provenance(), sections)).toContain('not approved');
  });

  it('records the reporting period', () => {
    expect(html).toContain('2026-01-01 to 2026-08-31');
  });
});

describe('the content hash', () => {
  const sections = [section({ fields: [value('Staff in post', 12, 'VERIFIED')] })];

  it('is stable for identical content', () => {
    const a = renderWithHash(provenance(), sections);
    const b = renderWithHash(provenance(), sections);

    expect(a.contentHash).toBe(b.contentHash);
    expect(a.html).toBe(b.html);
  });

  it('changes when a figure changes', () => {
    const changed = [section({ fields: [value('Staff in post', 13, 'VERIFIED')] })];

    expect(renderWithHash(provenance(), sections).contentHash).not.toBe(
      renderWithHash(provenance(), changed).contentHash,
    );
  });

  it('changes when a classification changes, not only when the number does', () => {
    // Re-labelling an estimate as a fact is exactly the alteration a hash must
    // catch (§82).
    const relabelled = [section({ fields: [value('Staff in post', 12, 'ACTUAL')] })];

    expect(renderWithHash(provenance(), sections).contentHash).not.toBe(
      renderWithHash(provenance(), relabelled).contentHash,
    );
  });

  it('is embedded in the document it describes', () => {
    const { html, contentHash: hash } = renderWithHash(provenance(), sections);

    expect(html).toContain(hash);
  });

  it('verifies against the file as issued', () => {
    // The check a reader performs: strip the embedded hash, re-hash, compare.
    const { html, contentHash: hash } = renderWithHash(provenance(), sections);

    expect(contentHash(html)).toBe(hash);
  });

  it('is sensitive to the order sections appear in', () => {
    const forward = [section({ key: 'a', heading: 'A', sequence: 1 }), section({ key: 'b', heading: 'B', sequence: 2 })];
    const swapped = [section({ key: 'a', heading: 'A', sequence: 2 }), section({ key: 'b', heading: 'B', sequence: 1 })];

    expect(renderWithHash(provenance(), forward).contentHash).not.toBe(
      renderWithHash(provenance(), swapped).contentHash,
    );
  });

  it('does not depend on the order sections were supplied in', () => {
    const ordered = [section({ key: 'a', heading: 'A', sequence: 1 }), section({ key: 'b', heading: 'B', sequence: 2 })];

    expect(renderWithHash(provenance(), ordered).contentHash).toBe(
      renderWithHash(provenance(), [...ordered].reverse()).contentHash,
    );
  });
});

// -----------------------------------------------------------------------------
// Letters
// -----------------------------------------------------------------------------

describe('letter merge fields', () => {
  const template =
    'Dear {{recipientTitle}} {{recipientName}},\n\nI write regarding {{facilityName}} in {{lgaName}}.\n\nYours faithfully,\n{{senderName}}';

  it('substitutes every field', () => {
    const letter = merge(template, {
      recipientTitle: 'Honourable',
      recipientName: 'Commissioner Eze',
      facilityName: 'Community Health Centre, Ikem',
      lgaName: 'Isi-Uzo',
      senderName: 'A. Okeke',
    });

    expect(letter).toContain('Dear Honourable Commissioner Eze,');
    expect(letter).toContain('Community Health Centre, Ikem');
    expect(letter).not.toContain('{{');
  });

  it('refuses to produce a letter with a hole in it', () => {
    // A letter that goes out saying "Dear ," over somebody's signature is
    // worse than one not sent.
    expect(() => merge(template, { recipientTitle: 'Honourable' })).toThrow(UnresolvedTokenError);
  });

  it('names every missing field at once, not just the first', () => {
    try {
      merge(template, { recipientTitle: 'Honourable' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnresolvedTokenError).tokens).toEqual([
        'facilityName',
        'lgaName',
        'recipientName',
        'senderName',
      ]);
    }
  });

  it('treats a blank value as missing, not as an answer', () => {
    expect(() =>
      merge('Dear {{name}}', { name: '   ' }),
    ).toThrow(/name/);
  });

  it('lists the fields a template expects', () => {
    expect(tokensIn(template)).toEqual([
      'facilityName',
      'lgaName',
      'recipientName',
      'recipientTitle',
      'senderName',
    ]);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(merge('Dear {{ name }}', { name: 'Ada' })).toBe('Dear Ada');
  });

  it('is not a template language', () => {
    // No conditionals, no loops, no expressions — a letter template is a
    // letter with names in it. Anything else lets unreviewable behaviour into
    // a document that goes out over someone's signature.
    expect(tokensIn('{{#if x}}y{{/if}}')).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Escaping
// -----------------------------------------------------------------------------

describe('rendering is safe', () => {
  it('escapes content rather than letting it become markup', () => {
    const sections = [
      section({
        heading: 'Findings <script>alert(1)</script>',
        fields: [value('Note', '<img src=x onerror=alert(1)>', 'REPORTED')],
      }),
    ];

    const html = renderDocument(provenance(), sections);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});
