# 12 — Financial Architecture

Money is the part of this system where a mistake is least recoverable and most consequential. The
design is conservative on purpose: double-entry, integer arithmetic, append-only, and no deletions.

---

## 1. Principles

1. **Double-entry, always.** Every financial event produces a balanced journal entry. There is no
   "revenue table" that can drift from the ledger.
2. **Integers only.** All amounts are `BIGINT` minor units (kobo) with an explicit currency. Floating
   point never touches money.
3. **Append-only.** `journal_entry` and `journal_line` cannot be updated or deleted. Corrections are
   reversals.
4. **Every entry has a source.** `source_type` + `source_id` point back to the dispensing, payment,
   payroll run, or project expense that caused it.
5. **Periods close.** A closed `financial_period` rejects new postings; reopening requires
   `finance.close_period`, a reason, and an audit record.
6. **Cash is derived.** There is no separate cash system; the cash position is a query over the
   ledger.

---

## 2. Chart of accounts

Hierarchical, seeded as configurable reference data, adjustable per organisation.

```
1000 ASSETS
  1100 Current assets
    1110 Cash on hand            1120 Bank
    1130 Patient receivables     1140 NHIS/HMO receivables
    1150 Inventory — medicines   1160 Inventory — consumables  1170 Inventory — reagents
  1200 Non-current assets
    1210 Buildings & improvements  1220 Medical equipment  1230 Laboratory equipment
    1240 ICT equipment             1250 Furniture & fittings
    1290 Accumulated depreciation (contra)
2000 LIABILITIES
  2110 Supplier payables  2120 Accrued staff costs  2130 Accrued incentives
  2140 Patient deposits   2150 Government entitlement payable
  2160 Partner capital recovery payable
3000 EQUITY / CAPITAL
  3110 Partner capital contributed  3120 Government contributed assets
  3130 Retained surplus             3140 Maintenance & development reserve
4000 REVENUE
  4110 Consultation  4120 Laboratory  4130 Pharmacy  4140 Procedures
  4150 Maternity     4160 Immunisation & preventive  4170 Other clinical  4180 Non-clinical
5000 DIRECT COSTS
  5110 Cost of medicines dispensed  5120 Cost of reagents consumed  5130 Cost of consumables
6000 OPERATING EXPENSES
  6110 Salaries  6120 Staff incentives  6130 Training
  6210 Power/diesel/solar  6220 Water  6230 Communications & internet
  6310 Repairs & maintenance  6320 Cleaning & waste  6330 Security
  6410 Regulatory & licences  6420 Insurance  6430 Bank charges
  6510 Depreciation
7000 DISTRIBUTIONS
  7110 Government entitlement  7120 Partner return  7130 Reserve transfer  7140 Reinvestment
```

---

## 3. Billing chain

```
SERVICE DELIVERED
   ↓  encounter / lab_order_item / dispensing / procedure
CHARGE                     priced from the tariff_version in force on the service date
   ↓  charge.encounter_id, charge.service_offering_id
INVOICE ITEM  →  INVOICE   one invoice per encounter or per billing cycle
   ↓
PAYMENT  →  PAYMENT ALLOCATION   a payment may settle several invoices, partially
   ↓
JOURNAL ENTRY  →  JOURNAL LINES
   ↓
FINANCIAL REPORTS  →  KPI  →  PARTNERSHIP WATERFALL
```

**Tariff versioning is load-bearing.** `tariff_version` has an effective date range; a charge stores
both the price and the `tariff_version_id` used. Re-pricing a past service is therefore impossible,
and a report run today for last March reproduces last March's figures exactly.

---

## 4. Standard postings

All amounts in kobo.

**Service rendered (accrual at the point of charge)**
```
Dr 1130 Patient receivables      2,000,000
   Cr 4110 Consultation revenue           2,000,000
```

**Cash received**
```
Dr 1110 Cash on hand             2,000,000
   Cr 1130 Patient receivables            2,000,000
```

**Medicine dispensed** — revenue and cost of goods in one atomic transaction
```
Dr 1130 Patient receivables      1,500,000
   Cr 4130 Pharmacy revenue               1,500,000
Dr 5110 Cost of medicines dispensed  900,000
   Cr 1150 Inventory — medicines            900,000
```

**Goods received on credit**
```
Dr 1150 Inventory — medicines   12,000,000
   Cr 2110 Supplier payables             12,000,000
```

**Capital asset commissioned**
```
Dr 1220 Medical equipment       48,000,000
   Cr 1120 Bank                           48,000,000
```

**Staff incentive accrued**
```
Dr 6120 Staff incentives         3,200,000
   Cr 2130 Accrued incentives              3,200,000
```

**Government entitlement recognised under the waterfall**
```
Dr 7110 Government entitlement   5,000,000
   Cr 2150 Government entitlement payable   5,000,000
```

**Reversal of an erroneous entry** — never an edit
```
Original entry JE-0412 status → REVERSED
New entry JE-0577, reverses_id = JE-0412, reason mandatory, approver recorded
Dr / Cr exactly inverted
```

---

## 5. Balance enforcement

A deferred constraint trigger runs at COMMIT:

```sql
CREATE CONSTRAINT TRIGGER trg_balance_journal_entry
AFTER INSERT ON fin.journal_line
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fin.assert_entry_balanced();
```

`assert_entry_balanced()` raises unless `sum(debit_minor) = sum(credit_minor)` for the entry and
every line shares one currency. Deferred, so lines may be inserted individually within the
transaction; enforced, so an unbalanced entry can never be committed by any code path.

---

## 6. Daily cash reconciliation (spec §33)

```
opening_balance + receipts − approved_expenses = expected_closing
variance = actual_counted_closing − expected_closing
```

Run per facility per day, per cash point.

- `opening_balance` — previous day's sealed closing, not a typed figure.
- `receipts` — sum of `payment` rows with method `CASH` for the day.
- `approved_expenses` — cash disbursements with an approval record.
- `actual_counted_closing` — physically counted and entered by the cashier, countersigned.

Any non-zero variance requires a reason and escalates to the Facility Manager. A variance above a
configurable threshold blocks the next day's cash session until it is resolved. The reconciliation
is sealed on approval and becomes immutable.

---

## 7. Five-year financial model

Separate from the ledger by design. The ledger records what happened; the model projects what might.
They meet only in the forecast-versus-actual comparison.

**Inputs** (`model_assumption`, each classified `ASSUMPTION`, each with a rationale):
patients/day, operating days/month, service mix %, tariff per service, annual growth %, inflation %,
variable cost ratio, fixed monthly costs, staff costs, incentive pool %, CAPEX schedule, working
capital, opening cash, depreciation period, collection rate, and collection lag.

Each of these is one row, including every service line's share, tariff and cost ratio. An assumption
row is the unit that carries a rationale, locks on approval, and produces an impact preview when
changed — a tariff buried in a JSON blob would have none of those properties, and tariffs are
exactly what gets renegotiated.

There is no separate bad-debt input: uncollected revenue IS `1 − collection_rate`, and holding the
same quantity in two places would let them disagree.

**Engine** — a pure function, `apps/api/src/modules/financial-model/domain/projection.ts`, with no
I/O, no ambient clock and no randomness, producing 60 monthly periods:

```
growth[m]           = (1 + annual_growth) ^ (m / 12)        -- annual, applied monthly
inflation[m]        = (1 + annual_inflation) ^ (m / 12)

patients[m]         = patients_per_day × operating_days × growth[m]
revenue[m]          = patients[m] × Σ(mix × tariff)         -- tariffs are NOT inflated
bad_debt[m]         = revenue[m] × (1 − collection_rate)
collections[m]      = revenue[m − lag] × collection_rate
direct_cost[m]      = patients[m] × Σ(mix × tariff × variable_cost_ratio) × inflation[m]
opex[m]             = fixed_costs × inflation[m]
staff[m]            = staff_costs × inflation[m]
incentive[m]        = max(0, revenue − bad_debt − direct − opex − staff) × incentive_rate
ebitda[m]           = revenue − bad_debt − direct − opex − staff − incentive
surplus[m]          = ebitda[m] − depreciation[m]
cash[m]             = cash[m−1] + collections[m] − (direct + opex + staff + incentive) − capex[m]
break_even_month    = first m where cumulative_surplus ≥ 0, else NULL
payback_month       = first m where cumulative_net_cash ≥ total_investment, else NULL
```

Four of those lines are there for reasons worth stating:

- **Growth and inflation compound annually**, applied monthly. 1% a month is 12.7% a year, not 12%,
  and over five years that error reaches 40%.
- **Tariffs are not inflated.** A tariff changes when somebody changes it, which is an assumption
  edit with an impact preview — not something that drifts upward on its own. Costs do inflate, so
  margins compress over the horizon unless tariffs are revisited. That is the real pressure a
  facility is under, and the model should show it rather than assume it away.
- **Uncollected revenue is a cost in the month it is billed.** The collection rate is a loss; the
  lag is the delay. Without this, a facility collecting 92% would report five years of surplus
  containing 8% of revenue it never saw, break even earlier than it truly does, and — once a
  partnership shares surplus — distribute against uncollected billings.
- **Cash uses collections, not revenue, and excludes depreciation.** Conflating the two is the most
  common error in a spreadsheet model, and it hides exactly the month a facility runs out of money.

`break_even_month` and `payback_month` are NULL when they never occur. A model that never breaks
even must say so: a fabricated month here would be the single most misleading number the system
could produce.

**Scenarios** — `CONSERVATIVE | BASE | GROWTH | STRESS`, each a full assumption set, never a
multiplier applied to a single base case (a stress case with different cost behaviour cannot be
expressed as one scalar).

**Sensitivity** — one-at-a-time variation of each driver by ±10/20/30%, reported as the impact on
break-even month, five-year surplus, and partner payback. Deliberately not a Monte Carlo simulation:
a distribution over inputs nobody has measured produces a confidence interval that looks
authoritative and means nothing, whereas "if volume is 20% lower, break-even moves from month 21 to
month 44" is a sentence a facility manager can argue with.

**Change impact** (spec §72) — before an assumption is written, the engine reports what the change
would do to revenue, surplus, break-even, payback, cash and working capital, and warns when a
break-even disappears or the facility would run out of money. Which outputs an assumption affects is
declared, not inferred, so a new output cannot be added without stating what it depends on.

**Locking** — approving a model locks every assumption. Changing one then returns `423 Locked`.
Unlocking is a separate permission and does not reopen the approved model: it creates the next
version and marks the approved one superseded, so what a government partner was shown stays exactly
as it was. Authorship carries across, so the approver who unlocked is still not the author and a
second pair of eyes is still required. Database triggers refuse a locked assumption change and any
edit to a projected period, so none of this depends on the application being the caller.

Every output row is classified `PROJECTED` and stamped with the model version. A projected figure
can never be presented as actual, and the API schema makes that structurally impossible.

---

## 8. Change-impact engine (spec §72)

Assumptions in an **approved** model are `locked`. Changing one requires `financial_model.unlock`,
returns `423 Locked` otherwise, and first produces an impact preview:

```
Change: consultation tariff  ₦2,000 → ₦2,500  (+25%)

Dependent outputs:
  Year-1 revenue            ₦58.2M → ₦66.1M      +13.6%
  Break-even month               14 → 11          −3 months
  5-year operating surplus  ₦41.3M → ₦58.7M      +42.1%
  Government entitlement    ₦12.4M → ₦17.6M      +42.1%
  Partner capital recovery  month 31 → month 26   −5 months
  Affordability KPI                        ⚠ breaches the community affordability ceiling

Confirm this change? It creates model version v5 and supersedes v4.
Reason (required): ______
```

The dependency graph is declared in `model-dependencies.ts`, so a new output cannot be added without
declaring what it depends on — the impact analysis cannot quietly fall out of date.

---

## 9. Partnership waterfall

No percentage is hard-coded anywhere. The waterfall is ordered configuration:

```
seq basis              label                            rate/amount   cap      floor
 1  GROSS_REVENUE      Gross revenue                    —             —        —
 2  GROSS_REVENUE      Direct costs                     actual        —        —
 3  GROSS_REVENUE      Operating expenses               actual        —        —
 4  OPERATING_SURPLUS  Approved staff incentives        configurable  cap      —
 5  OPERATING_SURPLUS  Maintenance/development reserve  configurable  —        floor
 6  OPERATING_SURPLUS  Government entitlement           configurable  —        floor
 7  RESIDUAL           Partner capital recovery         configurable  outstanding —
 8  RESIDUAL           Partner return                   configurable  —        —
 9  RESIDUAL           Reinvestment / distribution      residual      —        —
```

The calculator is a pure function over `(ledgerTotals, waterfallSteps)`. It is exhaustively unit
tested, including: zero revenue, a loss-making month, a cap binding, a floor binding, a floor and
cap in tension, and full capital recovery mid-period.

`revenue_share_model` is versioned with an effective date range. **The version in force on the
period being computed is always used** — so a renegotiation next year cannot retroactively change
last year's government entitlement.

---

## 10. Capital recovery (spec §74)

```
Approved investment    capex_line where status = APPROVED
Actual investment      project_expense + goods_receipt, both with payments posted
Eligible investment    actual ∩ the contract's eligibility rules
Recovered              Σ capital_recovery_event where type = RECOVERY
Outstanding            eligible − recovered
Agreed return          per the contract's return terms
Projected recovery     from current surplus run-rate, classified PROJECTED
```

`capital_recovery_event` is append-only and each row references the `payment` that funded it. A
partner cannot claim recovery of money that was never spent — the link to a real payment is required
by a foreign key, not by policy.

---

## 11. Forecast versus actual (spec §37)

The model stays live after commissioning. Monthly, an automated comparison produces per metric:
forecast, actual, variance (absolute and %), and cumulative variance. Where variance exceeds a
configurable band for three consecutive periods, the system raises a `ForecastDriftDetected`
notification and proposes a re-forecast — which creates a **new model version**, preserving the
original. The original projection is never adjusted to match reality; that would destroy the record
of what was promised.

---

## 12. Controls

| Control | Implementation |
|---|---|
| Segregation of duties | The user who raises a payment cannot approve it; enforced, not advisory |
| Approval thresholds | Configurable by amount; above threshold requires a second approver |
| No deletion | Rules on `journal_entry`/`journal_line`; reversal is the only correction |
| Period close | Trigger rejects postings to a closed period |
| Duplicate payment detection | Same supplier + amount + reference within a window is blocked pending review |
| Three-way match | PO ↔ GRN ↔ invoice; variance beyond tolerance blocks payment |
| Bank reconciliation | Statement lines matched to ledger; unmatched items aged and escalated |
| Waivers | Require `billing.waive`, a reason, and appear on a standing report |
| Audit | Every financial action, synchronously audited at `CRITICAL` severity |
