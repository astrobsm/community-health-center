# 04 — Entity Relationship Diagram

The full schema is ~160 tables. A single diagram would be unreadable, so it is presented as nine
bounded contexts plus the cross-context join points that carry the data chain.

Notation: `||--o{` = one-to-many, `}o--o{` = many-to-many via a join table, `||--||` = one-to-one.
Every entity also carries the universal columns from `03-database-architecture.md` §1; they are
omitted here for legibility.

---

## 1. Core — tenancy, identity, access

```mermaid
erDiagram
    ORGANISATION ||--o{ FACILITY : operates
    ORGANISATION ||--o{ APP_USER : employs
    ORGANISATION ||--o{ ROLE : defines
    FACILITY ||--|| FACILITY_LOCATION : "sited at"
    FACILITY ||--o{ FACILITY_OWNERSHIP : "owned under"
    FACILITY }o--|| FACILITY_TYPE : "classified as"
    FACILITY ||--o{ DEPARTMENT : contains
    FACILITY ||--o{ SERVICE_OFFERING : provides
    FACILITY ||--o{ FACILITY_STAGE_TRANSITION : "progresses through"
    DEPARTMENT ||--o{ SERVICE_OFFERING : "delivered by"
    SERVICE ||--o{ SERVICE_OFFERING : "catalogued as"
    SERVICE_OFFERING ||--o{ TARIFF_VERSION : "priced by"
    APP_USER ||--o{ USER_ROLE : holds
    ROLE ||--o{ USER_ROLE : "granted via"
    ROLE ||--o{ ROLE_PERMISSION : grants
    PERMISSION ||--o{ ROLE_PERMISSION : "granted by"
    APP_USER ||--o{ USER_FACILITY_ACCESS : "scoped to"
    FACILITY ||--o{ USER_FACILITY_ACCESS : "accessible by"
    APP_USER ||--o{ USER_SESSION : opens
    USER_SESSION ||--o{ REFRESH_TOKEN : issues
    APP_USER ||--o{ USER_MFA_FACTOR : registers
    ORGANISATION ||--o{ SYSTEM_CONFIGURATION : configures

    ORGANISATION {
        uuid id PK
        text name
        text code UK
        text country
    }
    FACILITY {
        uuid id PK
        uuid organisation_id FK
        text name
        text code UK
        enum lifecycle_stage
        uuid facility_type_id FK
    }
    FACILITY_LOCATION {
        uuid id PK
        uuid facility_id FK
        text state
        text lga
        text ward
        numeric latitude
        numeric longitude
    }
    APP_USER {
        uuid id PK
        uuid organisation_id FK
        citext email UK
        text password_hash
        bool mfa_enabled
        enum status
    }
    PERMISSION {
        uuid id PK
        text code UK "module.action"
        text description
    }
```

---

## 2. Assessment, evidence, baseline

```mermaid
erDiagram
    ASSESSMENT_TEMPLATE ||--o{ ASSESSMENT_TEMPLATE_VERSION : "versioned as"
    ASSESSMENT_TEMPLATE_VERSION ||--o{ ASSESSMENT_SECTION : contains
    ASSESSMENT_SECTION ||--o{ ASSESSMENT_ITEM : contains
    FACILITY ||--o{ FACILITY_ASSESSMENT : "assessed by"
    ASSESSMENT_TEMPLATE_VERSION ||--o{ FACILITY_ASSESSMENT : "captured with"
    FACILITY_ASSESSMENT ||--o{ ASSESSMENT_RESPONSE : records
    ASSESSMENT_ITEM ||--o{ ASSESSMENT_RESPONSE : "answered by"
    ASSESSMENT_RESPONSE ||--o{ ASSESSMENT_FINDING : produces
    ASSESSMENT_RESPONSE ||--o{ ASSESSMENT_EVIDENCE : "supported by"
    ASSESSMENT_FINDING ||--o{ FINDING_EVIDENCE : "proven by"
    EVIDENCE ||--o{ ASSESSMENT_EVIDENCE : links
    EVIDENCE ||--o{ FINDING_EVIDENCE : links
    EVIDENCE ||--o| PHOTOGRAPH : "may be"
    EVIDENCE ||--o| DOCUMENT : "may be"
    FACILITY_ASSESSMENT ||--o{ ASSESSMENT_SCORE : scores
    FACILITY_ASSESSMENT ||--o| BASELINE_SNAPSHOT : seals
    BASELINE_SNAPSHOT ||--o{ BASELINE_METRIC : freezes

    FACILITY_ASSESSMENT {
        uuid id PK
        uuid facility_id FK
        enum assessment_type "PRE_ASSESSMENT|DUE_DILIGENCE|FIELD|FOLLOW_UP"
        enum status "DRAFT|IN_PROGRESS|SUBMITTED|VERIFIED"
        numeric completion_percent
        timestamptz started_at
        timestamptz submitted_at
    }
    ASSESSMENT_ITEM {
        uuid id PK
        uuid section_id FK
        text code
        text question
        enum response_type "BOOLEAN|SCALE|NUMBER|TEXT|SELECT|MULTISELECT"
        numeric weight
        bool evidence_required
    }
    ASSESSMENT_RESPONSE {
        uuid id PK
        uuid assessment_id FK
        uuid item_id FK
        jsonb answer
        numeric score
        text note
        enum classification
        bool verified
        uuid verified_by FK
    }
    ASSESSMENT_FINDING {
        uuid id PK
        uuid response_id FK
        text title
        enum severity
        enum priority "P1|P2|P3|P4"
        bigint estimated_cost_minor
        text recommendation
    }
    BASELINE_SNAPSHOT {
        uuid id PK
        uuid facility_id FK
        uuid assessment_id FK
        int sequence "1 = Day 0"
        timestamptz sealed_at
        uuid sealed_by FK
        text content_hash "tamper evidence"
    }
    BASELINE_METRIC {
        uuid id PK
        uuid snapshot_id FK
        text metric_code
        numeric value
        text unit
        enum classification
        text source_reference
    }
```

---

## 3. Planning — needs, CAPEX, financial model, partnership

```mermaid
erDiagram
    ASSESSMENT_FINDING ||--o{ NEED : "gives rise to"
    NEED ||--o{ RECOMMENDATION : addressed_by
    RECOMMENDATION ||--o{ CAPEX_LINE : costed_as
    CAPEX_PLAN ||--o{ CAPEX_LINE : contains
    CAPEX_PLAN ||--o| WORKING_CAPITAL_PLAN : accompanies
    CAPEX_LINE ||--o| CAPITAL_PROJECT : "becomes"
    FACILITY ||--o{ FINANCIAL_MODEL : projects
    FINANCIAL_MODEL ||--o{ MODEL_ASSUMPTION : "driven by"
    FINANCIAL_MODEL ||--o{ MODEL_SCENARIO : "run as"
    MODEL_SCENARIO ||--o{ MODEL_PROJECTION : produces
    FACILITY ||--o{ PARTNERSHIP : "governed by"
    PARTNERSHIP ||--o{ PARTNERSHIP_OBLIGATION : imposes
    PARTNERSHIP ||--o{ REVENUE_SHARE_MODEL : "shares under"
    REVENUE_SHARE_MODEL ||--o{ WATERFALL_STEP : "computed by"
    PARTNERSHIP ||--o{ CAPITAL_RECOVERY_EVENT : recovers
    PARTNERSHIP ||--o{ CONTRACT : "formalised by"
    CONTRACT ||--o{ CONTRACT_VERSION : "versioned as"
    CONTRACT ||--o| MOU : "drafted as"
    PROPOSAL ||--o{ PROPOSAL_SECTION : contains
    FACILITY ||--o{ PROPOSAL : "subject of"
    PROPOSAL ||--o{ APPROVAL : requires
    LETTER_TEMPLATE ||--o{ LETTER : instantiates

    MODEL_ASSUMPTION {
        uuid id PK
        uuid model_id FK
        text code "patients_per_day, tariff, inflation..."
        numeric value
        text unit
        enum classification "ASSUMPTION"
        text rationale
        bool locked "approved models require confirmation to change"
    }
    MODEL_PROJECTION {
        uuid id PK
        uuid scenario_id FK
        int period_index "0..59 monthly"
        bigint revenue_minor
        bigint direct_cost_minor
        bigint opex_minor
        bigint surplus_minor
        bigint cash_balance_minor
        enum classification "PROJECTED"
    }
    WATERFALL_STEP {
        uuid id PK
        uuid revenue_share_model_id FK
        int sequence
        text label
        enum basis "GROSS_REVENUE|OPERATING_SURPLUS|FIXED|RESIDUAL"
        numeric rate
        bigint fixed_amount_minor
        bigint cap_minor
        bigint floor_minor
        uuid beneficiary_party_id FK
    }
    CAPITAL_RECOVERY_EVENT {
        uuid id PK
        uuid partnership_id FK
        enum event_type "INVESTMENT|RECOVERY|RETURN"
        bigint amount_minor
        uuid source_payment_id FK
        date occurred_on
    }
```

---

## 4. Execution — projects, procurement, assets

```mermaid
erDiagram
    CAPITAL_PROJECT ||--o{ PROJECT_PHASE : "broken into"
    PROJECT_PHASE ||--o{ PROJECT_TASK : contains
    PROJECT_TASK ||--o{ PROJECT_TASK_DEPENDENCY : "depends on"
    CAPITAL_PROJECT ||--o{ PROJECT_MILESTONE : tracks
    CAPITAL_PROJECT ||--o{ PROJECT_BUDGET : funded_by
    CAPITAL_PROJECT ||--o{ PROJECT_EXPENSE : spends
    CAPITAL_PROJECT ||--o{ PROJECT_EVIDENCE : evidenced_by
    CAPITAL_PROJECT ||--o{ RISK : "exposed to"
    CAPITAL_PROJECT ||--o{ PURCHASE_REQUEST : triggers
    SUPPLIER ||--o{ QUOTATION : submits
    PURCHASE_REQUEST ||--o{ QUOTATION : "invites"
    PURCHASE_REQUEST ||--o{ PURCHASE_ORDER : "results in"
    SUPPLIER ||--o{ PURCHASE_ORDER : fulfils
    PURCHASE_ORDER ||--o{ PURCHASE_ORDER_LINE : lists
    PURCHASE_ORDER ||--o{ GOODS_RECEIPT : "received as"
    GOODS_RECEIPT ||--o{ GOODS_RECEIPT_LINE : records
    GOODS_RECEIPT_LINE ||--o| INVENTORY_BATCH : "creates (consumable)"
    GOODS_RECEIPT_LINE ||--o| EQUIPMENT_ASSET : "creates (capital)"
    PURCHASE_ORDER ||--o{ SUPPLIER_INVOICE : billed_by
    SUPPLIER_INVOICE ||--o{ PAYMENT : settled_by
    EQUIPMENT_ASSET ||--o{ ASSET_MAINTENANCE : maintained_by
    EQUIPMENT_ASSET ||--o{ COMMISSIONING_RECORD : commissioned_by
    ROOM ||--o{ EQUIPMENT_ASSET : houses
    FACILITY ||--o{ ROOM : contains
    FACILITY ||--o{ INFRASTRUCTURE_ITEM : "built of"
    FACILITY ||--o{ UTILITY : "served by"

    CAPITAL_PROJECT {
        uuid id PK
        uuid facility_id FK
        uuid recommendation_id FK "lineage to the finding"
        text name
        enum category "BUILDING|EQUIPMENT|LAB|PHARMACY|ICT|POWER|WATER|..."
        enum priority "P1|P2|P3|P4"
        enum status
        date planned_start
        date planned_end
    }
    PROJECT_BUDGET {
        uuid id PK
        uuid project_id FK
        bigint budgeted_minor
        bigint approved_minor
        bigint committed_minor
        bigint spent_minor "derived view, not typed"
        uuid budget_line_id FK
    }
    EQUIPMENT_ASSET {
        uuid id PK
        uuid facility_id FK
        text asset_tag UK
        text manufacturer
        text model
        text serial_number
        uuid room_id FK
        text funding_source
        date purchase_date
        bigint cost_minor
        enum condition
        enum commissioning_status
        date warranty_expires_on
    }
```

---

## 5. Clinical — patient, encounter, laboratory, pharmacy

```mermaid
erDiagram
    PATIENT ||--o{ PATIENT_IDENTIFIER : "identified by"
    PATIENT ||--o{ PATIENT_CONTACT : "reachable at"
    PATIENT ||--o{ PATIENT_CONSENT : grants
    COMMUNITY ||--o{ PATIENT : "resident in"
    PATIENT ||--o{ ENCOUNTER : attends
    FACILITY ||--o{ ENCOUNTER : hosts
    ENCOUNTER ||--o| TRIAGE : "triaged by"
    ENCOUNTER ||--o{ CLINICAL_NOTE : documents
    ENCOUNTER ||--o{ DIAGNOSIS : diagnoses
    ENCOUNTER ||--o{ PROCEDURE : performs
    ENCOUNTER ||--o{ REFERRAL : refers
    ENCOUNTER ||--o{ APPOINTMENT : "schedules follow-up"
    ENCOUNTER ||--o{ CHARGE : "gives rise to"
    ENCOUNTER ||--o{ PRESCRIPTION : prescribes
    PRESCRIPTION ||--o{ PRESCRIPTION_ITEM : lists
    MEDICATION ||--o{ PRESCRIPTION_ITEM : "prescribed as"
    PRESCRIPTION_ITEM ||--o{ DISPENSING : "dispensed by"
    INVENTORY_BATCH ||--o{ DISPENSING : "drawn from"
    ENCOUNTER ||--o{ LAB_ORDER : orders
    LAB_ORDER ||--o{ LAB_ORDER_ITEM : lists
    LAB_TEST ||--o{ LAB_ORDER_ITEM : "ordered as"
    LAB_ORDER_ITEM ||--o{ LAB_SAMPLE : "collected as"
    LAB_SAMPLE ||--o{ LAB_RESULT : yields
    LAB_TEST ||--o{ LAB_REFERENCE_RANGE : "interpreted by"
    LAB_TEST ||--o{ LAB_QUALITY_CONTROL : "controlled by"
    CLINICAL_NOTE ||--o| CLINICAL_NOTE : amends
    DIAGNOSIS ||--o| DIAGNOSIS : amends

    PATIENT {
        uuid id PK
        uuid facility_id FK
        text given_name
        text family_name
        date date_of_birth
        enum sex
        uuid community_id FK
        enum status
    }
    ENCOUNTER {
        uuid id PK
        uuid patient_id FK
        uuid facility_id FK
        enum encounter_type "OPD|ANC|IMMUNISATION|EMERGENCY|ADMISSION|FOLLOW_UP"
        enum status "OPEN|CLOSED|CANCELLED"
        timestamptz started_at
        timestamptz ended_at
        uuid attending_staff_id FK
    }
    TRIAGE {
        uuid id PK
        uuid encounter_id FK
        int systolic_bp
        int diastolic_bp
        int pulse
        numeric temperature_c
        int respiratory_rate
        int spo2
        numeric weight_kg
        numeric height_cm
        numeric bmi "trigger-computed"
        int pain_score
    }
    LAB_RESULT {
        uuid id PK
        uuid sample_id FK
        uuid lab_test_id FK
        text value
        text unit
        enum flag "NORMAL|LOW|HIGH|CRITICAL"
        enum status "PRELIMINARY|VERIFIED|AMENDED"
        uuid verified_by FK
        timestamptz verified_at
        uuid amends_id FK
    }
    DISPENSING {
        uuid id PK
        uuid prescription_item_id FK
        uuid inventory_batch_id FK
        numeric quantity
        uuid dispensed_by FK
        timestamptz dispensed_at
        uuid charge_id FK
    }
```

---

## 6. Supply chain — inventory and stock ledger

```mermaid
erDiagram
    INVENTORY_CATEGORY ||--o{ INVENTORY_ITEM : classifies
    INVENTORY_ITEM ||--o| MEDICATION : "may be"
    INVENTORY_ITEM ||--o{ INVENTORY_BATCH : "stocked as"
    INVENTORY_ITEM ||--o{ REORDER_RULE : "governed by"
    INVENTORY_BATCH ||--o{ STOCK_TRANSACTION : "moved by"
    STOCK_LOCATION ||--o{ STOCK_TRANSACTION : "from/to"
    STOCK_COUNT ||--o{ STOCK_COUNT_LINE : counts
    STOCK_COUNT_LINE ||--o| STOCK_ADJUSTMENT : "reconciled by"
    STOCK_ADJUSTMENT ||--|| STOCK_TRANSACTION : "posted as"
    SUPPLIER ||--o{ INVENTORY_BATCH : supplies

    INVENTORY_BATCH {
        uuid id PK
        uuid inventory_item_id FK
        text batch_number
        date expiry_date
        numeric quantity_received
        numeric quantity_on_hand "trigger-maintained cache"
        bigint unit_cost_minor
        uuid supplier_id FK
        uuid goods_receipt_line_id FK
    }
    STOCK_TRANSACTION {
        uuid id PK
        uuid inventory_batch_id FK
        enum transaction_type "RECEIPT|ISSUE|TRANSFER|ADJUSTMENT|RETURN|WASTAGE"
        numeric quantity "signed"
        uuid from_location_id FK
        uuid to_location_id FK
        text source_type "polymorphic lineage"
        uuid source_id
        text reason_code
        uuid approved_by FK
        timestamptz occurred_at
    }
```

---

## 7. Finance

```mermaid
erDiagram
    FINANCIAL_ACCOUNT ||--o{ FINANCIAL_ACCOUNT : "parent of"
    FINANCIAL_PERIOD ||--o{ JOURNAL_ENTRY : contains
    JOURNAL_ENTRY ||--o{ JOURNAL_LINE : "balanced by"
    FINANCIAL_ACCOUNT ||--o{ JOURNAL_LINE : posts_to
    JOURNAL_ENTRY ||--o| JOURNAL_ENTRY : reverses
    SERVICE_OFFERING ||--o{ CHARGE : "raised for"
    ENCOUNTER ||--o{ CHARGE : "arises from"
    CHARGE ||--o| INVOICE_ITEM : "billed as"
    INVOICE ||--o{ INVOICE_ITEM : lists
    PATIENT ||--o{ INVOICE : owes
    INVOICE ||--o{ PAYMENT_ALLOCATION : "settled by"
    PAYMENT ||--o{ PAYMENT_ALLOCATION : allocates
    PAYMENT ||--o{ REFUND : refunded_by
    BUDGET ||--o{ BUDGET_LINE : contains
    FINANCIAL_ACCOUNT ||--o{ BUDGET_LINE : budgets
    BANK_ACCOUNT ||--o{ BANK_STATEMENT_LINE : reports
    BANK_RECONCILIATION ||--o{ BANK_STATEMENT_LINE : matches
    DAILY_CASH_RECONCILIATION ||--o{ PAYMENT : counts

    JOURNAL_ENTRY {
        uuid id PK
        uuid facility_id FK
        uuid financial_period_id FK
        date entry_date
        text description
        text source_type "DISPENSING|PAYMENT|PAYROLL|PROJECT_EXPENSE|..."
        uuid source_id
        uuid reverses_id FK
        enum status "POSTED|REVERSED"
        uuid posted_by FK
    }
    JOURNAL_LINE {
        uuid id PK
        uuid journal_entry_id FK
        uuid financial_account_id FK
        bigint debit_minor
        bigint credit_minor
        char currency
    }
    PAYMENT {
        uuid id PK
        uuid facility_id FK
        bigint amount_minor
        enum method "CASH|POS|TRANSFER|NHIS|WAIVER"
        text reference
        uuid received_by FK
        timestamptz received_at
    }
```

---

## 8. People — HR, attendance, performance

```mermaid
erDiagram
    STAFF ||--o{ STAFF_CREDENTIAL : holds
    STAFF ||--o{ STAFF_POSTING : "posted as"
    DEPARTMENT ||--o{ STAFF_POSTING : hosts
    STAFF ||--o{ STAFF_SCHEDULE : rostered_in
    STAFF_SCHEDULE ||--o{ SHIFT : contains
    STAFF ||--o{ ATTENDANCE : records
    STAFF ||--o{ LEAVE : takes
    STAFF ||--o{ PERFORMANCE_METRIC_RESULT : scores
    PERFORMANCE_METRIC ||--o{ PERFORMANCE_METRIC_RESULT : defines
    STAFF ||--o{ PERFORMANCE_REVIEW : reviewed_in
    STAFF ||--o{ STAFF_INCENTIVE : earns
    STAFF_INCENTIVE ||--o{ INCENTIVE_COMPONENT : "computed from"
    PERFORMANCE_METRIC_RESULT ||--o{ INCENTIVE_COMPONENT : "feeds"
    APP_USER ||--o| STAFF : "may be"

    ATTENDANCE {
        uuid id PK
        uuid staff_id FK
        uuid facility_id FK
        enum event_type "CLOCK_IN|CLOCK_OUT"
        timestamptz occurred_at
        enum method "QR|PIN|BIOMETRIC|MANUAL"
        numeric latitude
        numeric longitude
        uuid recorded_by FK
        text device_id
    }
    INCENTIVE_COMPONENT {
        uuid id PK
        uuid staff_incentive_id FK
        uuid performance_metric_id FK
        numeric metric_value
        numeric weight
        bigint amount_minor
        text formula_text "human-readable, auditable"
    }
```

---

## 9. Quality, KPI, audit, community

```mermaid
erDiagram
    FACILITY ||--o{ KPI_ASSIGNMENT : tracks
    KPI ||--o{ KPI_ASSIGNMENT : assigned_as
    KPI_ASSIGNMENT ||--o{ KPI_RESULT : produces
    BASELINE_METRIC ||--o{ KPI_ASSIGNMENT : "baselines"
    FACILITY ||--o{ INCIDENT : records
    INCIDENT ||--o{ CORRECTIVE_ACTION : triggers
    FACILITY ||--o{ COMPLAINT : receives
    COMPLAINT ||--o{ COMPLAINT_ACTION : "resolved by"
    FACILITY ||--o{ QUALITY_IMPROVEMENT : runs
    QUALITY_IMPROVEMENT ||--o{ CORRECTIVE_ACTION : implements
    FACILITY ||--o{ RISK : registers
    FACILITY ||--o{ COMPLIANCE_STATUS : declares
    COMPLIANCE_REQUIREMENT ||--o{ COMPLIANCE_STATUS : "assessed as"
    FACILITY ||--o{ COMMUNITY : serves
    COMMUNITY ||--|| COMMUNITY_PROFILE : "described by"
    COMMUNITY ||--o{ COMMUNITY_SURVEY : surveyed_by
    PATIENT ||--o{ PATIENT_SURVEY : answers
    APP_USER ||--o{ AUDIT_LOG : generates
    APP_USER ||--o{ NOTIFICATION : receives
    SYNC_EVENT }o--|| APP_USER : "raised by"

    KPI {
        uuid id PK
        text code UK
        text name
        text definition
        text unit
        text source_query_id "named SQL, never hand-typed"
        enum direction "HIGHER_BETTER|LOWER_BETTER"
    }
    KPI_RESULT {
        uuid id PK
        uuid kpi_assignment_id FK
        date period_start
        date period_end
        numeric value
        numeric target
        numeric baseline
        enum status "GREEN|AMBER|RED"
        enum classification
        timestamptz computed_at
        jsonb inputs "provenance of the computation"
    }
    AUDIT_LOG {
        uuid id PK
        uuid organisation_id FK
        uuid facility_id FK
        uuid actor_user_id FK
        text action
        text entity_type
        uuid entity_id
        jsonb old_value
        jsonb new_value
        text reason
        text device_id
        inet ip_address
        timestamptz occurred_at
    }
```

---

## 10. The cross-context chain

These are the foreign keys that make the product's central claim provable. They cross bounded
contexts deliberately, and each is covered by an acceptance test.

| From | To | Column | Proves |
|---|---|---|---|
| `assessment_finding` | `need` | `need.finding_id` | Problem was observed, not invented |
| `recommendation` | `capital_project` | `capital_project.recommendation_id` | Spending traces to a finding |
| `capex_line` | `budget_line` | `budget_line.capex_line_id` | Budget traces to a plan |
| `purchase_order` | `capital_project` | `purchase_order.project_id` | Procurement traces to a project |
| `goods_receipt_line` | `equipment_asset` | `equipment_asset.goods_receipt_line_id` | Asset traces to a purchase |
| `equipment_asset` | `commissioning_record` | `commissioning_record.asset_id` | Asset became operational |
| `encounter` | `charge` | `charge.encounter_id` | Revenue traces to care delivered |
| `charge` | `invoice_item` → `invoice` → `payment` | allocation chain | Cash traces to a service |
| `payment` | `journal_entry` | `journal_entry.source_id` | Ledger traces to cash |
| `dispensing` | `stock_transaction` | `stock_transaction.source_id` | Stock movement traces to a patient |
| `attendance` | `performance_metric_result` | computed inputs | Performance traces to events |
| `journal_line` | `capital_recovery_event` | `capital_recovery_event.source_payment_id` | Partner return traces to real money |
| `baseline_metric` | `kpi_assignment` | `kpi_assignment.baseline_metric_id` | Today is comparable to Day 0 |

---

## 11. Generating the live diagram

The diagrams above are maintained by hand for readability. A generated, exhaustive diagram of the
actual schema is produced from the database and must be regenerated after every migration:

```bash
npm run db:erd        # renders docs/architecture/generated/erd-full.svg from the live schema
```

If the generated diagram and this document disagree, **the generated diagram is correct** and this
document is stale — fix it in the same pull request as the migration.
