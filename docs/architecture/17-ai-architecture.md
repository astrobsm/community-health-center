# 17 — AI Architecture

The AI layer sits **above** the authoritative database. It is an analytical assistant. It is never
the source of truth, and the architecture is built so that it cannot become one by accident.

---

## 1. Isolation by construction

Isolation is a database grant, not a coding convention:

```sql
CREATE ROLE ai_reader LOGIN PASSWORD :'ai_pw';
REVOKE ALL ON ALL TABLES IN SCHEMA
  core, assess, plan, exec, clinical, supply, fin, people, qual, audit FROM ai_reader;
GRANT USAGE ON SCHEMA analytics TO ai_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO ai_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO ai_reader;
```

The AI service connects with `ai_reader`. Even a total compromise of the AI module — prompt
injection, a bug, a malicious model response — cannot write a clinical note, post a journal entry,
approve a document, or change stock. The permission does not exist.

The analytics schema is additionally de-identified for AI consumption: read-models exposed to the AI
role contain no names, no phone numbers, no national identifiers, and no free-text clinical notes
unless a specific, permissioned, patient-scoped summarisation request is made by a clinician for
their own patient.

---

## 2. What the AI may do

| Capability | How it is grounded |
|---|---|
| Summarise a period's performance | Over a supplied result set, with figures quoted verbatim |
| Explain a trend | With the underlying series attached to the answer |
| Detect anomalies | Statistical detection in SQL; the AI *describes*, it does not decide |
| Identify missing data | Computed completeness gaps; AI phrases the prompt to the user |
| Draft narrative sections | Facts injected as structured data; the AI writes prose around them |
| Forecast commentary | Over model output that was computed deterministically |
| Suggest operational priorities | Ranked by explicit rules; the AI explains the ranking |
| Answer a natural-language question | Routed to a **named, pre-approved query**, never generated SQL |

---

## 3. What the AI may never do

- Produce a number that did not come from a query result. Not one.
- Write to any transactional table.
- Alter a clinical record, or generate a diagnosis, prescription or dosage.
- Approve, authorise, or sign anything.
- Override a clinician or a financial control.
- Appear anywhere without its label.

These are enforced by grants (no write path), by output validation (numeric tokens are cross-checked
against the supplied context), and by the UI contract (every AI surface renders the label).

---

## 4. Grounding: the only pattern used

```
1. INTENT       user question → classified to a named capability
2. AUTHORISE    the user's own permissions and tenant scope are applied
3. RETRIEVE     execute pre-approved, parameterised SQL — NEVER model-generated SQL
4. CONTEXT      build a compact JSON context of the actual result rows
5. PROMPT       system prompt + context + question, with explicit refusal instructions
6. GENERATE     call the model
7. VALIDATE     every numeric token in the output must appear in the context
                → any that does not = REJECT the response and log it
8. LABEL        persist to ai_insight with classification AI_GENERATED
9. PRESENT      rendered with the label, the source rows, and a "verify" link
```

Step 3 is the crucial one. **The model never writes SQL.** Text-to-SQL against a clinical and
financial database is an unacceptable risk: a subtly wrong join produces a confident, plausible,
wrong number, and nobody catches it. Instead, questions are routed to a catalogue of named queries
whose SQL is reviewed, tested and version-controlled like any other code. If no named query fits,
the answer is:

> I do not have an approved query that answers that. Here are three related questions I can answer,
> or you can request a new analysis from your administrator.

Step 7 is the backstop. A response containing a figure not present in the retrieved context is
discarded, not shown, and recorded as a grounding failure — a monitored metric.

---

## 5. Prompt-injection defence

The context may contain free text written by people (a complaint, a finding note, a supplier name).
That text is data, never instruction.

- Context is delivered as structured JSON inside clearly delimited boundaries, with the system
  prompt stating that content inside them is untrusted data.
- Free-text fields are length-capped and stripped of instruction-like control sequences.
- The model holds **no tools** in the analytics path — no function calling, no retrieval it can
  steer, no network. It receives text and returns text.
- Even a fully successful injection yields only text, which then fails numeric validation and can
  write nothing. Defence in depth: the blast radius is a discarded paragraph.

---

## 6. Storage and labelling

```sql
ai_insight (
  id, organisation_id, facility_id,
  insight_type,            -- SUMMARY|ANOMALY|FORECAST_COMMENTARY|DRAFT|RECOMMENDATION|ANSWER
  subject_type, subject_id,
  prompt_hash, model_id, model_version,
  context_query_ids text[],       -- exactly which named queries grounded it
  context_hash,                   -- the result set it saw
  content text,
  confidence numeric,             -- null unless statistically derived
  classification = 'AI_GENERATED',
  generated_at, generated_by,
  reviewed_by, reviewed_at, review_outcome,  -- ACCEPTED|REJECTED|EDITED
  token_usage jsonb
)
```

Every insight is reproducible: the model, the prompt hash, the named queries and the context hash
are all recorded, so a disputed AI statement can be re-examined months later.

---

## 7. Presentation

```
┌──────────────────────────────────────────────────────────┐
│ ✦ AI-GENERATED ANALYSIS — not a system record            │
│                                                          │
│ Outpatient attendance rose 18% in August against July,   │
│ concentrated in the under-5 age band (+31%). This        │
│ coincides with the immunisation outreach that began on   │
│ 3 August.                                                │
│                                                          │
│ Grounded in: mv_daily_clinical (Jul–Aug 2026),           │
│              outreach_activity (3 rows)                  │
│ Model: claude-opus-5 · Generated 13 Sep 2026 14:22       │
│                                                          │
│ [ View the source figures ]   [ Mark reviewed ]          │
└──────────────────────────────────────────────────────────┘
```

Visually distinct, always labelled, always with the underlying figures one click away. An AI insight
cannot be copied into a generated document as fact — if included, it appears in a clearly marked
"Analysis and commentary" section carrying its `AI_GENERATED` classification.

---

## 8. Predictive analytics (spec §54)

Forecasting is **statistics, not the language model.** These run as deterministic computations; the
model is used only to explain results in prose.

| Forecast | Method | Minimum history | Output |
|---|---|---|---|
| Patient demand | Seasonal-naive → Holt-Winters when ≥2 seasons | 8 weeks | Point + 80/95% interval |
| Revenue | Demand × service mix × tariff | 8 weeks | Point + interval |
| Stock depletion | Consumption rate vs on hand, with lead time | 4 weeks/item | Days to stock-out |
| Workforce need | Demand ÷ productivity standard | 8 weeks | FTE by cadre |
| Cash flow | Collections model + payables schedule | 3 months | Weekly projection |
| Equipment maintenance | Usage + age + failure history | 6 months | Risk ranking |
| Partnership sustainability | Surplus trajectory vs obligations | 6 months | Scenario range |

**Uncertainty is mandatory.** No forecast is ever displayed as a bare point estimate. Where history
is insufficient, the system says so and declines to forecast rather than extrapolating from noise:

> Insufficient history for a reliable forecast. 3 weeks of data available; 8 weeks required.
> Showing the observed trend only.

All forecast outputs are classified `PROJECTED`.

---

## 9. Anomaly detection

Detection is deterministic SQL; the AI only narrates.

| Domain | Signal |
|---|---|
| Clinical | Attendance outside ±3σ; unusual diagnosis clustering |
| Financial | Revenue/encounter outside historical band; duplicate payment patterns; cash variance |
| Pharmacy | Consumption spikes; dispensing without a prescription; recurring FEFO overrides |
| Inventory | Repeated variance on one item or one person's shifts |
| Laboratory | Turnaround degradation; QC drift; abnormal result-rate change |
| Attendance | Clock patterns inconsistent with rosters |
| Procurement | Supplier concentration; price drift against history |

Every anomaly is a **flag for a human**, never an automatic action. It links to the records that
triggered it and can be dismissed with a reason — and dismissal patterns are themselves reviewable.

---

## 10. Governance

- **Provider abstraction.** `LlmProvider` interface; the model is configuration. Default:
  `claude-opus-5` for analysis, `claude-sonnet-5` for high-volume summarisation.
- **No training on facility data.** Contractual and configuration requirement; documented in the
  data-protection register.
- **PHI minimisation.** Aggregate read-models by default. Patient-scoped summarisation requires the
  requesting clinician to hold access to that patient, is audited, and sends the minimum text needed.
- **Cost control.** Per-organisation token budgets, caching of identical (prompt, context) pairs,
  and rate limits.
- **Kill switch.** `AI_ENABLED=false` disables the entire layer. Nothing else in the platform
  depends on it — the system is fully functional with AI turned off. That is the clearest possible
  statement of where the truth lives.

---

## 11. Tests

| Test | Asserts |
|---|---|
| `ai-no-write-access.spec.ts` | Every write attempt as `ai_reader` fails at the database |
| `ai-grounding.spec.ts` | A figure absent from context causes rejection of the response |
| `ai-injection.spec.ts` | Injected instructions in free-text fields change nothing |
| `ai-labelling.spec.ts` | Every insight is persisted and rendered as `AI_GENERATED` |
| `forecast-uncertainty.spec.ts` | No point estimate without an interval; refusal below minimum history |
| `ai-disabled.spec.ts` | With AI off, every non-AI feature still works |
