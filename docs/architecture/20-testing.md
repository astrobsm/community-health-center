# 20 — Testing Architecture

The tests exist to prove the product's central claim: that every number can be traced to the
transaction that produced it. A green suite that does not demonstrate that is not useful.

---

## 1. Shape of the suite

```
        /\          E2E — Playwright (~40 specs)
       /  \         the nine workflows + the full acceptance chain + offline
      /────\
     /      \       Integration — Vitest + Testcontainers (~250 specs)
    /        \      real PostgreSQL: triggers, RLS, immutability, transactions
   /──────────\
  /            \    Unit — Vitest (~600 specs)
 /              \   pure domain logic: waterfall, FEFO, scoring, projections
/────────────────\
```

Deliberately heavier in the middle than the classic pyramid. The guarantees this system depends on —
row-level security, append-only rules, balance triggers, the stock cache — **live in the database**.
A mocked test of those would verify nothing at all.

---

## 2. Rules

1. **No mocking the database** for anything that touches a database invariant. Testcontainers
   provides a real PostgreSQL 16 with the real migrations.
2. **No fixtures that bypass the domain.** Test data is created through the same services the
   application uses, so a test that passes proves the real path works.
3. **Every bug gets a failing test first**, committed in the same change as the fix.
4. **Tests are deterministic.** Time is injectable; no `Date.now()` in domain code; random data is
   seeded and the seed is printed on failure.
5. **Tests assert behaviour, not implementation.** Renaming a private method must not break a test.

---

## 3. Unit tests — the pure core

The financially and clinically consequential logic is written as pure functions with no I/O, which
makes it exhaustively testable.

| Module | What is proved |
|---|---|
| `waterfall.ts` | Zero revenue; a loss-making period; a cap binding; a floor binding; cap and floor in tension; full capital recovery mid-period; ordering independence violations rejected |
| `fefo.ts` | Expiry ordering; ties broken by receipt date; quarantined and expired batches excluded; partial allocation across batches; insufficient stock returns a failure, never a negative |
| `projection.ts` | 60 periods; inflation compounding; collection lag; break-even and payback identification; a scenario that never breaks even returns `null`, not a fabricated month |
| `readiness-score.ts` | Weight normalisation; missing domains excluded rather than scored zero; reproducibility |
| `priority-score.ts` | Banding boundaries; override recorded with reason |
| `incentive.ts` | Each component computed independently; the total equals the sum of components; patient volume alone cannot determine an incentive |
| `classification.ts` | Aggregates take the weakest input class; illegal promotions rejected |
| `money.ts` | Minor-unit arithmetic; no precision loss; rounding is explicit and half-up |
| `reconciliation.ts` | Opening + receipts − issues − wastage ± adjustments = closing |

---

## 4. Integration tests — the database guarantees

| Test | Asserts |
|---|---|
| `rls-enforcement.spec.ts` | Raw SQL as the app role cannot read another facility's rows |
| `immutability.spec.ts` | UPDATE/DELETE on every Class-3 and Class-4 table is refused |
| `journal-balance.spec.ts` | An unbalanced entry cannot be committed by any path |
| `stock-trigger.spec.ts` | `quantity_on_hand` always equals the ledger sum after random sequences |
| `no-negative-stock.spec.ts` | Two concurrent dispensings of the last unit: exactly one succeeds |
| `period-close.spec.ts` | Postings to a closed period are rejected |
| `amendment-chain.spec.ts` | Clinical amendments preserve every prior version |
| `audit-trigger.spec.ts` | A direct SQL write still produces an audit row |
| `tariff-versioning.spec.ts` | A past charge re-prices at the tariff in force on its service date |
| `serialisation-retry.spec.ts` | Concurrent stock deduction retries and converges correctly |

---

## 5. The nine mandated workflow suites (spec §77)

Each runs end to end against a real database and asserts the **lineage**, not just the happy path.

| # | Suite | Chain asserted |
|---|---|---|
| 1 | Assessment | create → respond → attach evidence → verify → seal baseline → baseline is immutable |
| 2 | Project | finding → need → recommendation → capex → project → procurement → completion → evidence |
| 3 | Clinical | patient → encounter → triage → diagnosis → lab order → prescription → timeline complete |
| 4 | Laboratory | order → sample → accession → result → verification → clinician visibility → TAT computed |
| 5 | Pharmacy | prescription → verification → FEFO dispensing → stock deduction → charge → journal |
| 6 | Finance | charge → invoice → payment → journal → reconciliation → balanced ledger |
| 7 | Inventory | purchase → receipt → batch → issue → count → reconciliation identity holds |
| 8 | HR | roster → attendance → performance metrics → incentive with an auditable formula |
| 9 | Longitudinal | baseline → intervention → current → comparison shows the correct delta |

Each suite ends with a **lineage assertion**: starting from the final number, walk the foreign keys
back to the originating record, and fail if the chain breaks anywhere.

---

## 6. The full acceptance test (spec §78)

`acceptance/full-chain.e2e.ts` executes the entire product in one run:

```
create facility → pre-assessment → field assessment → photographic evidence → baseline
→ gap analysis → capital plan → financial model → partnership model → proposal → letter
→ MOU → project → procurement → asset commissioning → go live → patient → encounter
→ lab → pharmacy → payment → finance → KPI → baseline/current comparison → management report
```

It asserts at the end that:

- the management report's patient count equals the number of encounters actually created;
- its revenue equals the ledger's posted revenue;
- its stock position equals the ledger sum;
- the baseline comparison reflects exactly the interventions performed;
- every figure in the generated PDF carries a classification;
- every figure traces to a source record.

This single test is the definition of "the system works".

---

## 7. Offline and sync

| Test | Method |
|---|---|
| `offline-capture.e2e.ts` | Playwright offline mode; complete a full assessment with photos; reconnect; verify server state |
| `offline-clinical.e2e.ts` | Register, triage, consult, prescribe offline; sync; verify the timeline |
| `sync-conflict.e2e.ts` | Two browser contexts edit the same record; assert the declared policy, assert nothing is lost |
| `sync-partial-failure.spec.ts` | One invalid record in a batch of fifty does not block the other forty-nine |
| `clock-skew.spec.ts` | A device clock two years wrong still orders and syncs correctly |
| `quota-pressure.e2e.ts` | Storage nearing quota warns and degrades safely |

---

## 8. Security tests

Enumerated in `18-security.md` §11. They run in CI on every pull request, not only at release.

---

## 9. Performance

k6 scenarios against the target hardware, on a simulated 3G profile:

| Scenario | Budget |
|---|---|
| Dashboard load (facility manager) | p95 < 1.5 s |
| Patient search (10k patients) | p95 < 400 ms |
| Encounter save | p95 < 600 ms |
| Dispensing transaction | p95 < 800 ms |
| Sync push, 50 records | p95 < 3 s |
| Monthly report generation | < 30 s |
| Concurrent users at a facility | 30 without degradation |

Frontend budgets, enforced in CI: initial bundle < 250 KB gzipped; route chunk < 150 KB; Lighthouse
performance ≥ 90 on a mid-range Android profile; Time to Interactive < 3 s on simulated 3G.

---

## 10. Accessibility

- `axe-core` on every page in CI; zero critical violations permitted.
- Keyboard-only traversal of the clinical workflow is tested.
- Contrast ≥ 4.5:1; touch targets ≥ 44 px; the app is usable at 200% zoom.
- Screen-reader smoke tests on triage and dispensing — the two screens where an error is most
  consequential.

---

## 11. Coverage

Coverage is a diagnostic, not a target. Thresholds are set where they mean something:

| Area | Minimum |
|---|---|
| `domain/` pure logic | **95%** |
| Services | 85% |
| Controllers | 75% |
| Overall | 80% |

An uncovered branch in `waterfall.ts` or `fefo.ts` fails the build. An uncovered branch in a
presentational component does not.

---

## 12. CI pipeline

```
lint → typecheck → boundaries → unit → integration (Testcontainers) → build
  → e2e (Playwright) → security → a11y → bundle budget → migration-on-restored-dump
```

The pipeline blocks merge on any failure. Migrations are additionally tested against a
production-shaped restored dump, because a migration that succeeds on an empty schema and fails on
real data is the most expensive kind of surprise.
