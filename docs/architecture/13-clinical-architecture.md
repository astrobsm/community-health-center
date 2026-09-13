# 13 — Clinical Architecture

The EMR is the clinical truth. It must be complete, longitudinal, never silently altered, and
usable by a CHEW on a phone in a room with no power.

---

## 1. The clinical chain

```
PATIENT  (registered once, identified many ways)
   ↓
ENCOUNTER  (one visit; the organising unit of all clinical activity)
   ↓
TRIAGE → CLINICAL NOTE → DIAGNOSIS → { PROCEDURE | LAB ORDER | PRESCRIPTION | REFERRAL }
   ↓                                          ↓                ↓
CHARGE                                   LAB RESULT        DISPENSING
   ↓                                          ↓                ↓
INVOICE → PAYMENT → LEDGER            CLINICAL REVIEW    STOCK LEDGER + LEDGER
   ↓
FOLLOW-UP APPOINTMENT → next ENCOUNTER
```

**The encounter is the hinge.** Clinical activity attaches to it, and so does every charge. That
single fact is what makes "revenue traces to care delivered" true by construction rather than by
reconciliation.

---

## 2. Patient identity

A patient is one person, identified several ways:

| Identifier | Scope | Notes |
|---|---|---|
| `id` (UUID) | Global | Internal, never shown |
| Facility MRN | Facility | `IKM-0000001`, printed, human-readable, checksum digit |
| NIN | National | Optional; stored encrypted at field level |
| NHIS/HMO number | Scheme | Optional, drives payer routing |
| Phone | Practical | The identifier patients actually remember |

**Registration guards against duplicates without blocking care.** On registration, a fuzzy match
(trigram on name + exact DOB or phone) surfaces candidates. The clerk may proceed anyway — refusing
to register a patient because a similar name exists is unacceptable — but the pair is recorded as a
`duplicate_candidate` for review.

**Merging** is a deliberate, permissioned, reversible-by-record operation: the surviving record
absorbs the encounters, the merged record becomes a tombstone pointing to the survivor, and nothing
is deleted. `patient.merge` is held only by the Clinical Lead and Facility Manager.

---

## 3. Consent (spec §84)

`patient_consent` is purpose-scoped, versioned, withdrawable, and time-stamped:

| Purpose | Default | Withdrawable |
|---|---|---|
| `TREATMENT` | Required to open an encounter | No (it is the basis of care) |
| `DATA_STORAGE` | Required, explained in the privacy notice | No |
| `SMS_CONTACT` | Opt-in | Yes |
| `RESEARCH_AGGREGATE` | Opt-in | Yes |
| `PHOTOGRAPH` | Opt-in, per instance | Yes |
| `GOVERNMENT_AGGREGATE_REPORTING` | Notified; aggregate only, never identified | n/a |

The consent version records which privacy-notice text the patient actually agreed to. When the
notice changes, prior consents remain valid against the text that was shown, and re-consent is
requested at the next encounter.

---

## 4. Encounter model

```
encounter {
  id, patient_id, facility_id, department_id,
  encounter_type: OPD | ANC | DELIVERY | POSTNATAL | IMMUNISATION | FAMILY_PLANNING
                | CHRONIC_FOLLOWUP | EMERGENCY | ADMISSION | OUTREACH | TELECONSULT,
  status: OPEN | CLOSED | CANCELLED,
  started_at, ended_at,
  attending_staff_id, triage_category,
  chief_complaint, disposition
}
```

Closing an encounter is a domain operation, not a field update. It asserts that a diagnosis exists
(or an explicit "no diagnosis" reason is recorded), raises charges via `EncounterClosed`, and freezes
the note set for amendment-only editing. An encounter left open past a configurable window appears
on the Clinical Lead's queue — incomplete documentation is a quality signal, so it is surfaced
rather than auto-closed.

---

## 5. Triage and vitals

```
triage {
  systolic_bp, diastolic_bp, pulse, temperature_c, respiratory_rate,
  spo2, weight_kg, height_cm,
  bmi,                          -- computed by trigger; never written by the application
  muac_cm, pain_score,
  triage_category: RED | ORANGE | YELLOW | GREEN
}
```

- **BMI is computed by the database**, in a `BEFORE INSERT OR UPDATE` trigger on `weight_kg` and
  `height_cm`. It cannot disagree with the values beside it, and no application code can set it.
  (A `GENERATED ALWAYS` column would give the same guarantee but reads as schema drift to the ORM
  on every migration, so the trigger is the pragmatic equivalent — verified by
  `scripts/verify-invariants.sh`.)
- Physiologically impossible values are rejected (temperature 12 °C); implausible-but-possible
  values are accepted with a confirmation prompt (temperature 41.5 °C) — because a system that
  refuses to record a genuine emergency is worse than one that asks twice.
- Age-banded validation: an adult respiratory rate range applied to a neonate would reject valid
  observations, so ranges come from the reference table by age band.
- Vitals may repeat within an encounter; all are retained, the latest is "current".

---

## 6. Clinical documentation and amendment

Structured where structure earns its place, free text where it does not.

```
clinical_note {
  encounter_id, note_type: CONSULTATION | NURSING | PROGRESS | PROCEDURE | DISCHARGE,
  presenting_complaint, history_of_presenting_complaint,
  past_medical_history, medication_history, allergies, family_social_history,
  examination_general, examination_systems jsonb,
  assessment, differential_diagnosis, plan,
  author_staff_id, signed_at,
  status: DRAFT | SIGNED | AMENDED,
  amends_id, amendment_reason
}
```

**The amendment rule (spec §43).** A signed note is never modified. An amendment is a new row whose
`amends_id` points to the previous version; the previous row's status becomes `AMENDED` and remains
fully readable. The clinical view renders the head of the chain with an "amended" marker and
one-click access to every prior version, its author, and the stated reason.

A `DRAFT` note may be edited freely by its author — a clinician typing mid-consultation is not
making an amendment. It becomes immutable at signature.

Allergies are additionally promoted to a patient-level flag, surfaced on every prescribing screen,
because burying a penicillin allergy inside a note from 2024 is a patient-safety failure.

---

## 7. Diagnosis

- ICD-10 code plus a **local synonym layer**, so a CHEW can type "typhoid" or "iba" and reach the
  correct code. Synonyms are configuration, extensible per facility.
- `diagnosis_type`: `PRIMARY | SECONDARY | DIFFERENTIAL | PROVISIONAL | CONFIRMED | RULED_OUT`.
- A provisional diagnosis later confirmed or ruled out is an **amendment chain**, so the clinical
  reasoning is preserved. This is exactly the kind of information a later clinician needs.
- Chronic conditions are promoted to `chronic_condition` at patient level, with their own follow-up
  schedule and adherence tracking.

---

## 8. Laboratory

```
ORDER → SAMPLE → ACCESSION → PROCESSING → RESULT → VERIFICATION → CLINICIAN REVIEW
```

| Stage | Records | Notes |
|---|---|---|
| Order | `lab_order`, `lab_order_item` | Raises a charge at order time; clinical indication required |
| Sample | `lab_sample` | Type, collected by/at, container; rejection reason if unsuitable |
| Accession | `lab_sample.accession_number` | Facility-unique, sequential, the lab's working identifier |
| Processing | status transitions | Reagent consumption posts to the stock ledger |
| Result | `lab_result` | Value, unit, flag computed from the age/sex-specific reference range |
| Verification | `verified_by`, `verified_at` | **Only verified results are visible to clinicians** |
| Review | timeline entry | Acknowledgement recorded, especially for critical results |

- **Critical results** trigger immediate in-app and SMS notification to the ordering clinician and
  the Clinical Lead, and remain on an escalation queue until acknowledged, with the acknowledgement
  audited. An unacknowledged critical result escalates after a configurable interval.
- **Turnaround time** is computed from event timestamps (ordered → collected → resulted → verified),
  never entered. It is a KPI and cannot be massaged.
- **Quality control**: `lab_quality_control` records control runs per analyte with Westgard-style
  rule evaluation. A failed QC blocks result release for that analyte until resolved.
- **Amendment**: a corrected result is a new row (`amends_id`); if the original was already viewed
  or acted upon, the amendment raises a high-priority notification to the ordering clinician.

---

## 9. Pharmacy

```
PRESCRIPTION → VERIFICATION → DISPENSING → STOCK DEDUCTION → PAYMENT
```

- **Prescribing checks** at the point of writing: allergy cross-check, duplicate therapy, basic
  interaction checks from a configurable table, weight-based paediatric dosing, and pregnancy
  cautions where pregnancy status is recorded. Warnings can be overridden with a reason, which is
  recorded — clinicians must retain clinical judgement, but the override becomes part of the record.
- **Pharmacist verification** is a distinct, permissioned step (`pharmacy.verify`) separate from
  dispensing (`pharmacy.dispense`), preserving the professional check even when one person holds
  both permissions.
- **FEFO** (first-expiry-first-out) selects the batch automatically — expiry date ascending among
  batches with stock, excluding quarantined batches. Manual override requires a reason.
- **Partial dispensing** is first-class: a patient who can afford four of ten tablets gets four, the
  balance is recorded as outstanding, and the prescription remains open. Pretending otherwise would
  make the data wrong.
- Dispensing is one atomic transaction across `dispensing`, `stock_transaction`, `charge`, and the
  journal entries — see `02-system-architecture.md` §5.

---

## 10. Specialised clinical modules

**Maternity.** `maternity_record` spans ANC through delivery to postnatal: gravida/para, LMP, EDD
(generated from LMP), risk factors, per-visit ANC records, delivery record (mode, outcome, APGAR,
birth weight, complications), and postnatal follow-up. A birth optionally creates a linked patient
record for the newborn.

**Child health.** `immunisation` against a configurable national schedule, with due/overdue
computation from date of birth; `growth_measurement` with WHO z-scores computed, not typed.

**Chronic disease.** `chronic_condition` with a follow-up schedule, adherence tracking, and defaulter
identification — a patient with hypertension who has not attended in four months appears on a
follow-up queue. This is the module that turns an EMR into continuity of care.

---

## 11. The clinical timeline (spec §28)

One query, one screen, everything about a patient in chronological order:

```
registration → encounters → vitals → notes → diagnoses → investigations
            → results → medications → procedures → referrals → follow-ups
```

Implemented as a UNION over the clinical tables with a shared `(occurred_at, kind, summary, ref)`
shape, filtered by the caller's permissions, paginated by cursor. Each entry links to the source
record, and amended entries show the amendment marker inline.

---

## 12. Clinical safety commitments

| Commitment | Mechanism |
|---|---|
| No silent overwrite | Amendment chains on every clinical table |
| Allergies always visible | Patient-level flag surfaced on every prescribing screen |
| Critical results are not missed | Escalating notifications until acknowledged, audited |
| Unverified results are not acted upon | Only verified results reach the clinician view |
| The clinician decides | Warnings and prompts; no autonomous clinical action by the system |
| AI never prescribes | The AI layer has no write access to any clinical table |
| Availability | Offline capture for triage, consultation and prescribing |
| Attribution | Every clinical row records its author, and the author cannot be changed |
