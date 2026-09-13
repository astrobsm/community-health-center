# 14 — Inventory Architecture

The stock ledger is the inventory truth. Quantity on hand is not a number someone maintains; it is
the sum of every movement that ever happened.

---

## 1. The ledger model

```
inventory_category → inventory_item → inventory_batch → stock_transaction  [APPEND-ONLY]
```

`stock_transaction` is the only table that can change stock. It is append-only, signed, and every
row points back to what caused it.

```sql
stock_transaction (
  id uuid PK,
  inventory_batch_id uuid NOT NULL,
  transaction_type   stock_txn_type NOT NULL,   -- RECEIPT|ISSUE|TRANSFER|ADJUSTMENT|RETURN|WASTAGE
  quantity           numeric(14,3) NOT NULL,    -- SIGNED: + increases, − decreases
  from_location_id   uuid,
  to_location_id     uuid,
  unit_cost_minor    bigint,
  source_type        text NOT NULL,             -- 'dispensing'|'goods_receipt'|'lab_consumption'|...
  source_id          uuid,
  reason_code        text,                      -- mandatory for ADJUSTMENT and WASTAGE
  approved_by        uuid,                      -- mandatory for ADJUSTMENT and WASTAGE
  occurred_at        timestamptz NOT NULL,
  ...
)
```

**Signed quantities, one column.** Storing `quantity_in` and `quantity_out` separately invites a row
with both populated. One signed column makes the sum trivially correct:

```sql
SELECT sum(quantity) FROM supply.stock_transaction WHERE inventory_batch_id = $1;
```

---

## 2. The one deliberate cache

`inventory_batch.quantity_on_hand` is a materialised running balance. It exists because FEFO
selection and stock-availability checks happen on every dispensing, and summing the ledger each time
would not scale.

It is **maintained exclusively by a database trigger** — no application code writes it:

```sql
CREATE FUNCTION supply.apply_stock_transaction() RETURNS trigger AS $$
BEGIN
  UPDATE supply.inventory_batch
     SET quantity_on_hand = quantity_on_hand + NEW.quantity,
         updated_at = now()
   WHERE id = NEW.inventory_batch_id;

  IF (SELECT quantity_on_hand FROM supply.inventory_batch
       WHERE id = NEW.inventory_batch_id) < 0 THEN
    RAISE EXCEPTION 'Stock cannot go negative for batch %', NEW.inventory_batch_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

Plus `CHECK (quantity_on_hand >= 0)` as a second line of defence.

**Nightly reconciliation** recomputes every batch balance from the ledger and compares:

```sql
SELECT b.id, b.quantity_on_hand, coalesce(sum(t.quantity), 0) AS ledger_balance
FROM supply.inventory_batch b
LEFT JOIN supply.stock_transaction t ON t.inventory_batch_id = b.id
GROUP BY b.id, b.quantity_on_hand
HAVING b.quantity_on_hand <> coalesce(sum(t.quantity), 0);
```

Any row returned is a defect: it raises a `CRITICAL` alert, and the ledger — never the cache — is
treated as correct.

---

## 3. Movement types

| Type | Sign | Requires | Typical source |
|---|---|---|---|
| `RECEIPT` | + | Goods receipt note | Procurement, donation, transfer in |
| `ISSUE` | − | Dispensing, lab consumption, or department issue | Pharmacy, laboratory, ward |
| `TRANSFER` | ± | Both locations; two paired rows | Store → dispensary |
| `ADJUSTMENT` | ± | Reason code **and** approver | Stock count variance |
| `RETURN` | + | Original dispensing reference | Patient return, supplier return |
| `WASTAGE` | − | Reason code, approver, and evidence for high value | Expiry, breakage, cold-chain failure |

`ADJUSTMENT` and `WASTAGE` are the only types a human can originate directly; every other type is
created by a workflow (dispensing, receipt, lab consumption). This is what stops the ledger from
becoming an editable spreadsheet.

---

## 4. Batch and expiry management

Every batch carries its number, expiry date, quantity received, unit cost, supplier, and originating
goods-receipt line. Full traceability runs from a patient's dispensing record back to the purchase
order and the supplier — which is exactly what a product recall requires.

**FEFO selection** (pure function, `domain/fefo.ts`):

```
candidates = batches where item matches
             and quantity_on_hand > 0
             and status = ACTIVE            (not QUARANTINED, not RECALLED)
             and expiry_date > today
order by expiry_date asc, received_at asc
allocate greedily across batches until the requested quantity is satisfied
```

Batches expiring within the dispensing window are flagged so the pharmacist sees it; expired batches
are never selectable. A manual override of FEFO requires a reason and is audited.

**Expiry lifecycle**: a scheduled job moves batches through `ACTIVE → NEAR_EXPIRY (configurable,
default 90 days) → EXPIRED → quarantined`. Expiry automatically posts a `WASTAGE` transaction and a
write-off journal entry, so expired stock never silently inflates either inventory or the balance
sheet.

---

## 5. Stock counts and reconciliation (spec §45)

```
Opening + Receipts − Issues − Wastage ± Adjustments = Closing
```

Computed per item per period directly from the ledger, and compared against a physical count.

Count workflow: initiate (optionally blind, so counters do not see expected quantities) → count by
batch → system computes variance → variance below tolerance is auto-accepted with a logged
`ADJUSTMENT`; above tolerance requires investigation, a reason, and Facility Manager approval →
count sealed and immutable.

Persistent variance on a specific item or a specific staff member's shifts is surfaced as a **stock
accountability** signal feeding the performance module — which is why the spec insists incentives
must not rest on patient volume alone.

---

## 6. Alerts (spec §31)

Evaluated after every stock transaction and on a schedule:

| Alert | Rule |
|---|---|
| Low stock | `on_hand ≤ reorder_level` |
| Critical stock | `on_hand ≤ critical_level`, or projected stock-out within lead time |
| Stock-out | `on_hand = 0` for a tracer item — a tracked KPI |
| Near expiry | Expiry within the configured horizon |
| Expired | Past expiry with stock remaining |
| Abnormal consumption | Period consumption > mean + 3σ over the trailing window |
| Slow moving | No movement in N days with stock on hand |
| Negative attempt | Any rejected transaction — a strong signal of a process problem |

Reorder levels are **computed, not typed**: `average_daily_consumption × lead_time_days ×
safety_factor`, recalculated monthly from actual consumption. A manual override is permitted, must
be justified, and is shown alongside the computed value so the difference is always visible.

---

## 7. Procurement reconciliation (spec §46)

Three-way match, per line:

```
PURCHASE ORDER  ↔  GOODS RECEIPT  ↔  SUPPLIER INVOICE  →  PAYMENT
```

| Discrepancy | Handling |
|---|---|
| Quantity received ≠ ordered | Flagged; over-receipt beyond tolerance requires approval |
| Price invoiced ≠ ordered | Flagged; variance beyond tolerance blocks payment |
| Invoiced without receipt | **Payment blocked** |
| Received without an order | Flagged as an emergency purchase requiring retrospective approval |
| Duplicate invoice number | Blocked |
| Payment exceeding the matched invoice | Blocked |

Tolerances are configuration, not code. Every override is audited with a reason and an approver.

---

## 8. Multi-location stock

`stock_location` models main store, dispensary, laboratory, wards, and outreach kits. A transfer is
two paired transactions inside one database transaction, so stock is never in flight or double
counted. Location-level permissions mean the laboratory officer can issue reagents but not dispense
medicines.

---

## 9. Valuation

- Weighted average cost per item, recomputed on each receipt; cost of goods issued uses the value of
  the specific batch, which is exact rather than approximate.
- Inventory value on the balance sheet is derived from the ledger: `Σ (quantity_on_hand ×
  batch_unit_cost)`. It is never typed, and it always agrees with account 1150 because both come
  from the same transactions.

---

## 10. Testing

| Test | Asserts |
|---|---|
| `stock-ledger-integrity.spec.ts` | `quantity_on_hand` equals the ledger sum after random operation sequences |
| `no-negative-stock.spec.ts` | Concurrent dispensing of the last unit: one succeeds, one fails cleanly |
| `fefo.spec.ts` | Correct batch order including expiry ties, quarantine and partial allocation |
| `expiry-lifecycle.spec.ts` | Expiry posts wastage and a write-off entry |
| `stock-reconciliation.spec.ts` | The opening/closing identity holds across a period |
| `three-way-match.spec.ts` | Every discrepancy in §7 is caught |
| `reorder-calculation.spec.ts` | Reorder levels recompute from real consumption |
| `dispense-to-stock-ledger.spec.ts` | Acceptance criterion H end to end |
