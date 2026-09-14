# 16 — Document Generation Architecture

Documents are how this system speaks to people who will never log in: an LGA chairman, a
commissioner, a lawyer, an auditor. Every figure in them must be real, sourced, dated and classified.

---

## 1. Principle

**A document is a rendering of a query, not a place to type numbers.**

The generator takes a template plus a data context assembled from named, versioned SQL, and produces
an artefact. There is no field in any template into which a user can type a financial figure or a
patient count. Where narrative is genuinely needed — a covering paragraph, a negotiating position —
it is a declared free-text block, stored on the record, versioned, and attributed to its author.

---

## 2. Pipeline

```
REQUEST                 user selects document type, facility, period, scenario
   ↓
RESOLVE DATA CONTEXT    named SQL queries; each returns values WITH classification
   ↓
VALIDATE                every required datum present? every figure classified?
                        → missing data becomes an explicit gap, never a blank or a zero
   ↓
RENDER                  Handlebars → HTML (PDF path) or docxtemplater (DOCX path)
   ↓
STAMP PROVENANCE        source datasets, period, model version, doc version, author, approval state
   ↓
PRODUCE                 Playwright Chromium → PDF   |   docxtemplater → DOCX
   ↓
STORE                   object storage; document_version row; content hash
   ↓
WORKFLOW                DRAFT → REVIEW → REVISION → APPROVAL → APPROVED → SUPERSEDED
```

Generation runs in a BullMQ worker. A 40-page proposal with charts takes seconds to tens of seconds;
that must never block a request thread.

**As built (Release 5).** RESOLVE, VALIDATE, RENDER, STAMP, STORE and WORKFLOW are implemented and
run synchronously: assembling HTML from resolved queries is fast enough to do so. PRODUCE is not —
the artefact is HTML rather than PDF or DOCX, and the queued worker is not yet built. The generation
response states the format it produced, so nothing implies a PDF exists. The print CSS carries the
banner and page furniture, so the printed form is governed by the same rules the PDF path will be.

Document types whose source data belongs to a later release are refused by name, saying which
release provides them. Generating an empty forty-page proposal would be worse than refusing:
somebody would send it.

---

## 3. Missing data is shown, never filled

This is the mechanism that makes §82 real.

```
┌────────────────────────────────────────────────────────────┐
│  4.3  Laboratory baseline                                  │
│                                                            │
│  Tests available at baseline .................  DATA NOT   │
│                                                 CAPTURED   │
│                                                            │
│  The laboratory section of the field assessment is 40%     │
│  complete. 6 of 15 items are unanswered. This section      │
│  cannot be reported until the assessment is completed.     │
│                                                            │
│  [ Open the outstanding assessment items ]                 │
└────────────────────────────────────────────────────────────┘
```

A missing value never renders as `0`, `—`, `N/A`, or an estimate silently substituted for an
observation. The document says what is missing, why, and how to fix it. A document whose
completeness falls below the threshold for its type cannot be submitted for approval at all.

---

## 4. Document types

| Type | Format | Primary sources |
|---|---|---|
| Pre-assessment report | PDF | `facility_assessment` (PRE_ASSESSMENT) |
| Due-diligence report | PDF | Due-diligence assessment, ownership, regulatory, financial |
| Baseline report | PDF | `baseline_snapshot`, `baseline_metric`, evidence |
| Needs assessment | PDF | `need`, `recommendation`, prioritisation |
| Capital plan | PDF + XLSX | `capex_plan`, `capex_line` |
| Five-year financial report | PDF + XLSX | `financial_model`, scenarios, sensitivity |
| Business case | PDF | Baseline + needs + capex + model + partnership |
| Full proposal | PDF | All of the above, assembled |
| Chairman brief | PDF (2 pages) | Executive extract of the proposal |
| Letters | DOCX + PDF | `letter_template` + recipient configuration |
| Implementation plan | PDF | Projects, phases, milestones, First 100 Days |
| MOU | **DOCX** | Partnership, waterfall, obligations, KPIs |
| Management agreement | **DOCX** | Contract terms |
| Commissioning report | PDF | Commissioning records, assets, evidence |
| Monthly report | PDF | Clinical, financial, pharmacy, laboratory, HR, KPI |
| Quarterly report | PDF | Government + partnership + quality |
| Annual report | PDF | Performance, public value, five-year trajectory |

**Why DOCX for legal documents.** An MOU exists to be negotiated. Counsel and government officials
need track changes and comments. Issuing a PDF would force the whole negotiation out of the system
into an emailed Word file, and the version we hold would immediately become fiction.

---

## 5. Provenance block (spec §49)

Every generated document carries this, machine-readable in metadata and human-readable in an
appendix:

```
─────────────────────────────────────────────────────────────
DOCUMENT PROVENANCE
Document            Baseline Report — Community Health Centre, Ikem
Version             v3 (supersedes v2 of 2026-02-11)
Status              APPROVED
Generated           2026-09-13 14:22 WAT
Generated by        A. Okeke (Project Manager)
Approved by         N. Eze (Organisation Administrator), 2026-09-13 16:40
Reporting period    2026-01-01 → 2026-08-31
Source datasets     facility_assessment#a41c (sealed 2026-02-03)
                    baseline_snapshot#b7e2 (sealed 2026-02-05)
                    evidence: 148 items, 132 verified
Financial model     none referenced
Content hash        sha256:9f2c…  (verifies this file is unaltered)

DATA CLASSIFICATION USED IN THIS DOCUMENT
  ACTUAL      41 figures    from system transactions
  VERIFIED    96 figures    observed and confirmed with evidence
  REPORTED    12 figures    stated by facility staff, not independently verified
  ESTIMATED    8 figures    calculated — method stated at each point of use
  ASSUMPTION   0 figures
  PROJECTED    0 figures

Figures of different classifications are labelled individually and are not aggregated
across classes except where the weakest class is shown.
─────────────────────────────────────────────────────────────
```

---

## 6. Version control (spec §50)

```
DRAFT → REVIEW → REVISION → APPROVAL → APPROVED → SUPERSEDED
```

- An `APPROVED` version is immutable — enforced by the Class-4 trigger, not by convention.
- Revising an approved document creates a new version; the old one becomes `SUPERSEDED` and remains
  retrievable forever.
- Every version keeps its own content hash, data context snapshot, and approval chain.
- A superseded document downloaded later is watermarked **SUPERSEDED — see version N**, so a stale
  PDF circulating by email cannot be mistaken for current.

---

## 7. Letters (spec §51)

Templates seeded and editable: request for meeting, expression of interest, request for due
diligence, proposal submission, request for preliminary approval, follow-up, MOU submission.

Recipients come from a configurable registry (name, title, office, address, salutation), never
hard-coded. Merge fields cover sender, recipient, facility, date, reference number, and enclosures.
Each generated letter records its reference number, recipient, sender, dispatch method and date —
so the correspondence trail is part of the system rather than someone's inbox.

---

## 8. MOU generator (spec §52)

Assembles a draft covering every clause the specification enumerates: parties, purpose, scope,
ownership, management, staffing, investment, equipment, drugs, laboratory, ICT, finance, revenue,
government benefit, KPIs, audit, data protection, regulatory compliance, term, termination, exit,
handover, and dispute resolution.

Financial and operational clauses are populated from the partnership configuration — the waterfall
steps, obligations and KPI targets that the system actually holds — so the agreement and the
software cannot diverge.

**Mandatory banner**, on every page, in the header, and in the document properties:

```
DRAFT — SUBJECT TO LEGAL, GOVERNMENT AND PROFESSIONAL REVIEW
```

It cannot be removed from a generated document. Only a contract record explicitly marked
`EXECUTED`, with the executed file uploaded and the signatories recorded, renders without it.

No clause text asserts a legal conclusion. Regulatory references point to the configurable
compliance register (spec §83) rather than stating what the law requires.

---

## 9. Reporting cadence (spec §65)

| Cadence | Contents | Delivery |
|---|---|---|
| Daily | Clinical, finance, pharmacy, laboratory, attendance | In-app, 06:00 for the prior day |
| Weekly | Operations, inventory, staffing | In-app + email, Monday |
| Monthly | Financial, clinical, HR, KPI | PDF, 5th working day |
| Quarterly | Government, partnership, quality | PDF + DOCX, within 15 days of quarter end |
| Annual | Facility performance, public value, five-year trajectory | PDF, within 45 days of year end |

Scheduled runs are queued jobs; each writes a `report_run` row with parameters, duration, row counts
and the resulting document id — so a report can always be reproduced exactly as it was issued.

---

## 10. Tests

| Test | Asserts |
|---|---|
| `document-provenance.spec.ts` | Every generated document carries a complete provenance block |
| `document-no-fabrication.spec.ts` | Missing data renders as a gap; never 0, blank, or substituted |
| `document-classification.spec.ts` | Every figure is labelled; classes are never silently mixed |
| `document-immutability.spec.ts` | An approved version cannot be modified |
| `mou-banner.spec.ts` | The draft banner is present unless the contract is executed |
| `document-reproducibility.spec.ts` | Re-running a report for a past period reproduces it byte-identically |
