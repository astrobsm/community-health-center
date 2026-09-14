import { createHash } from 'node:crypto';

import type { DocumentSection, Provenance } from '@chc/contracts';
import { DRAFT_LEGAL_BANNER } from '@chc/contracts';

import { trustStatement } from './completeness';

/**
 * Rendering (doc 16 §§1-5).
 *
 * A document is a rendering of resolved data, not a place to type numbers.
 * This module turns sections into an artefact and does three things that the
 * specification requires and that no amount of care in a template would
 * guarantee:
 *
 *  1. A gap renders as a visible statement of what is missing and what would
 *     fix it. It cannot render as 0, blank, "—", or a substituted estimate.
 *  2. Every figure renders beside its classification.
 *  3. An unexecuted legal document carries the draft banner on every page,
 *     and there is no parameter that removes it.
 *
 * Output is HTML. That is the canonical artefact this release produces and the
 * input the PDF path will later take; print CSS carries the banner and the
 * page furniture, so the printed form is governed by the same rules.
 *
 * Pure: the same sections and provenance always produce identical bytes, which
 * is what makes the content hash meaningful.
 */

export interface RenderOptions {
  /**
   * Legal documents carry the draft banner unless the contract is executed.
   *
   * Deliberately expressed as "is this executed?" rather than "show the
   * banner?": there is no way to ask for the banner to be omitted, only to
   * state a fact about the contract that the caller must be able to defend.
   */
  isExecutedCopy?: boolean;
  /** Set on a version that has been replaced, so a stale copy says so. */
  supersededByVersion?: number | null;
}

export function renderDocument(
  provenance: Provenance,
  sections: readonly DocumentSection[],
  options: RenderOptions = {},
): string {
  const isLegal = provenance.documentType === 'MOU' || provenance.documentType === 'MANAGEMENT_AGREEMENT';
  const showBanner = isLegal && options.isExecutedCopy !== true;

  const ordered = [...sections].sort((a, b) => a.sequence - b.sequence);

  const parts: string[] = [
    '<!-- chc:document -->',
    `<article class="document" data-document-type="${esc(provenance.documentType)}" data-version="${provenance.versionNumber}"${showBanner ? ' data-draft-banner="required"' : ''}>`,
    renderHead(provenance, showBanner, options.supersededByVersion ?? null),
  ];

  for (const section of ordered) {
    parts.push(renderSection(section, showBanner));
  }

  parts.push(renderProvenance(provenance));
  parts.push('</article>');

  return `${style(showBanner)}\n${parts.join('\n')}\n`;
}

function renderHead(provenance: Provenance, showBanner: boolean, supersededBy: number | null): string {
  const lines: string[] = [];

  if (showBanner) {
    // In the header, so it appears at the top of the document, and repeated
    // per section below; print CSS fixes it to every page.
    lines.push(`<div class="draft-banner" role="note">${esc(DRAFT_LEGAL_BANNER)}</div>`);
  }

  if (supersededBy !== null) {
    // A stale PDF circulating by email must not be mistaken for current.
    lines.push(
      `<div class="superseded-banner" role="note">SUPERSEDED — see version ${supersededBy}. ` +
        'This copy is retained for the record and must not be acted on.</div>',
    );
  }

  lines.push(`<header class="document-head">`);
  lines.push(`<h1>${esc(provenance.title)}</h1>`);
  lines.push(
    `<p class="reference">${esc(provenance.reference)} — version ${provenance.versionNumber}` +
      (provenance.supersedesVersion !== null ? ` (supersedes version ${provenance.supersedesVersion})` : '') +
      ` — ${esc(provenance.status)}</p>`,
  );
  lines.push('</header>');

  return lines.join('\n');
}

function renderSection(section: DocumentSection, showBanner: boolean): string {
  const lines: string[] = [`<section class="document-section" id="${esc(section.key)}">`];

  // Repeated per section so that however the artefact is paginated — printed,
  // converted, or read in a viewer that breaks on sections — the banner
  // travels with the content rather than sitting only on page one.
  if (showBanner) {
    lines.push(`<div class="draft-banner page-banner" role="note">${esc(DRAFT_LEGAL_BANNER)}</div>`);
  }

  lines.push(`<h2>${esc(section.heading)}</h2>`);

  if (section.narrative) {
    lines.push(`<div class="narrative">${paragraphs(section.narrative)}</div>`);
  }

  for (const clause of section.clauses) {
    lines.push(
      `<div class="clause"><h3>${esc(clause.number)} ${esc(clause.heading)}</h3>${paragraphs(clause.text)}</div>`,
    );
  }

  if (section.fields.length > 0) {
    lines.push('<dl class="figures">');

    for (const field of section.fields) {
      lines.push(`<dt>${esc(field.label)}</dt>`);

      if (field.kind === 'GAP') {
        // The one thing this whole module exists to guarantee. Never 0, never
        // blank, never a dash, never an estimate quietly put in its place.
        lines.push(
          '<dd class="gap" data-gap="true">' +
            '<strong class="gap-label">DATA NOT CAPTURED</strong>' +
            `<span class="gap-reason">${esc(field.reason)}</span>` +
            `<span class="gap-remedy">${esc(field.remedy)}</span>` +
            `<span class="source">Source: ${esc(field.source)}</span>` +
            '</dd>',
        );
        continue;
      }

      lines.push(
        '<dd class="value">' +
          `<span class="figure">${esc(String(field.value))}${field.unit ? ` ${esc(field.unit)}` : ''}</span>` +
          `<span class="classification" data-classification="${esc(field.classification)}">${esc(field.classification)}</span>` +
          (field.method ? `<span class="method">Method: ${esc(field.method)}</span>` : '') +
          `<span class="source">Source: ${esc(field.source)}</span>` +
          '</dd>',
      );
    }

    lines.push('</dl>');
  }

  lines.push('</section>');
  return lines.join('\n');
}

function renderProvenance(provenance: Provenance): string {
  const { completeness } = provenance;

  const rows: Array<[string, string]> = [
    ['Document', `${provenance.title} (${provenance.documentType})`],
    [
      'Version',
      `v${provenance.versionNumber}` +
        (provenance.supersedesVersion !== null ? ` (supersedes v${provenance.supersedesVersion})` : ''),
    ],
    ['Status', provenance.status],
    ['Generated', provenance.generatedAt],
    ['Generated by', provenance.generatedBy ?? 'not recorded'],
    [
      'Approved by',
      provenance.approvedBy ? `${provenance.approvedBy}, ${provenance.approvedAt ?? 'date not recorded'}` : 'not approved',
    ],
    [
      'Reporting period',
      provenance.reportingPeriodStart && provenance.reportingPeriodEnd
        ? `${provenance.reportingPeriodStart} to ${provenance.reportingPeriodEnd}`
        : 'not applicable',
    ],
    ['Financial model', provenance.financialModel ?? 'none referenced'],
    ['Completeness', `${completeness.completenessPercent}% (${completeness.resolvedFields} of ${completeness.totalFields} figures)`],
  ];

  const lines: string[] = [
    '<section class="provenance" id="provenance">',
    '<h2>Document provenance</h2>',
    '<dl>',
  ];

  for (const [label, value] of rows) {
    lines.push(`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`);
  }

  lines.push('<dt>Source datasets</dt><dd><ul>');
  for (const dataset of provenance.sourceDatasets) {
    lines.push(`<li>${esc(dataset.name)}: ${esc(dataset.detail)}</li>`);
  }
  if (provenance.sourceDatasets.length === 0) {
    lines.push('<li>No datasets recorded for this document.</li>');
  }
  lines.push('</ul></dd>');

  // The hash covers the content, so it is stated here but computed over the
  // body rather than over itself.
  lines.push(`<dt>Content hash</dt><dd class="content-hash">${esc(provenance.contentHash)}</dd>`);
  lines.push('</dl>');

  lines.push('<h3>Data classification used in this document</h3>');
  lines.push(`<p class="trust">${esc(trustStatement(completeness))}</p>`);

  if (completeness.gaps.length > 0) {
    lines.push(`<h3>Outstanding data (${completeness.gaps.length})</h3>`);
    lines.push('<ul class="gap-list">');
    for (const gap of completeness.gaps) {
      lines.push(`<li><strong>${esc(gap.section)} — ${esc(gap.label)}:</strong> ${esc(gap.reason)} ${esc(gap.remedy)}</li>`);
    }
    lines.push('</ul>');
  }

  lines.push('</section>');
  return lines.join('\n');
}

/**
 * The hash that lets a reader verify a file is the one that was approved.
 *
 * Computed over the rendered body with the hash placeholder empty, so the
 * value can be embedded in the document it describes without chasing its own
 * tail.
 */
export function contentHash(html: string): string {
  const withoutHash = html.replace(
    /<dd class="content-hash">[^<]*<\/dd>/,
    '<dd class="content-hash"></dd>',
  );

  return `sha256:${createHash('sha256').update(withoutHash, 'utf8').digest('hex')}`;
}

/** Render, hash, and embed the hash — in that order, so it is verifiable. */
export function renderWithHash(
  provenance: Provenance,
  sections: readonly DocumentSection[],
  options: RenderOptions = {},
): { html: string; contentHash: string } {
  const draft = renderDocument({ ...provenance, contentHash: '' }, sections, options);
  const hash = contentHash(draft);

  return { html: renderDocument({ ...provenance, contentHash: hash }, sections, options), contentHash: hash };
}

// -----------------------------------------------------------------------------
// Letter merge fields (spec §51)
// -----------------------------------------------------------------------------

export class UnresolvedTokenError extends Error {
  constructor(readonly tokens: string[]) {
    super(
      `This letter cannot be produced: ${tokens.length} merge field(s) have no value — ${tokens.join(', ')}. ` +
        'A letter sent with a blank where a name should be is worse than one not sent.',
    );
    this.name = 'UnresolvedTokenError';
  }
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Substitute merge fields, refusing to produce a letter with a hole in it.
 *
 * Deliberately not a template language. A letter template is a letter with
 * names in it; allowing conditionals and loops would let logic — and therefore
 * unreviewable behaviour — into a document that goes out over somebody's
 * signature.
 */
export function merge(template: string, values: Record<string, string>): string {
  const missing = new Set<string>();

  const result = template.replace(TOKEN, (_match, token: string) => {
    const value = values[token];

    if (value === undefined || value.trim() === '') {
      missing.add(token);
      return '';
    }

    return value;
  });

  if (missing.size > 0) throw new UnresolvedTokenError([...missing].sort());

  return result;
}

/** The tokens a template expects, so a caller can be told what to supply. */
export function tokensIn(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(TOKEN)) found.add(match[1]);
  return [...found].sort();
}

// -----------------------------------------------------------------------------

function style(showBanner: boolean): string {
  return [
    '<style>',
    ':root { --ink: #1a1a1a; --muted: #5b5b5b; --gap: #8a2b06; --rule: #d6d6d6; }',
    '.document { color: var(--ink); font-family: Georgia, "Times New Roman", serif; line-height: 1.5; max-width: 52rem; margin: 0 auto; padding: 2rem 1rem; }',
    '.document-head h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }',
    '.reference { color: var(--muted); margin: 0 0 1.5rem; font-size: 0.9rem; }',
    '.document-section { border-top: 1px solid var(--rule); padding-top: 1rem; margin-top: 1.5rem; }',
    '.figures { display: grid; grid-template-columns: minmax(12rem, 1fr) 2fr; gap: 0.4rem 1rem; }',
    '.figures dt { font-weight: 600; }',
    '.figures dd { margin: 0; display: flex; flex-direction: column; gap: 0.15rem; }',
    '.figure { font-variant-numeric: tabular-nums; }',
    '.classification { font-size: 0.7rem; letter-spacing: 0.05em; color: var(--muted); }',
    '.method, .source { font-size: 0.75rem; color: var(--muted); }',
    '.gap { border-left: 3px solid var(--gap); padding-left: 0.6rem; }',
    '.gap-label { color: var(--gap); font-size: 0.8rem; letter-spacing: 0.05em; }',
    '.gap-reason, .gap-remedy { font-size: 0.85rem; }',
    '.superseded-banner { background: #fff4e5; border: 1px solid #c77700; padding: 0.6rem 0.8rem; font-weight: 700; margin-bottom: 1rem; }',
    '.provenance { border-top: 2px solid var(--ink); margin-top: 2.5rem; font-size: 0.85rem; }',
    '.provenance dl { display: grid; grid-template-columns: minmax(10rem, 1fr) 2fr; gap: 0.3rem 1rem; }',
    '.provenance dt { font-weight: 600; }',
    '.provenance dd { margin: 0; }',
    '.content-hash { font-family: ui-monospace, monospace; word-break: break-all; }',
    ...(showBanner
      ? [
          '.draft-banner { background: #fdecec; border: 2px solid #a4262c; color: #a4262c; font-weight: 700; letter-spacing: 0.04em; text-align: center; padding: 0.5rem; margin-bottom: 1rem; }',
          // Fixed in print so it lands on every printed page, not only the
          // first. The per-section copies cover viewers that ignore this.
          '@media print { .draft-banner { position: fixed; top: 0; left: 0; right: 0; } .document { padding-top: 3rem; } .page-banner { position: static; } }',
        ]
      : []),
    '@media (prefers-color-scheme: dark) { :root { --ink: #ececec; --muted: #a9a9a9; --rule: #3a3a3a; } }',
    '</style>',
  ].join('\n');
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${esc(block.trim()).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
