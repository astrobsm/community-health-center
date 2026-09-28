# API routes and the permission each requires

*Generated from the router by `npm run openapi --workspace @chc/api`. Do not edit by hand.*

197 routes — 120 mutating, 6 public.

Every route declares a permission or is explicitly public. The application refuses to start if one
declares neither, so this table cannot be incomplete while the API runs.

Request and response bodies are the Zod schemas in `packages/contracts`, which both tiers import.
They are not restated here: a second definition is a definition that can disagree.

## Ai

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/ai/anomalies` | `analytics.read` |
| POST | `/api/v1/ai/ask` | `ai.query` |
| GET | `/api/v1/ai/forecast` | `analytics.read` |
| GET | `/api/v1/ai/insights` | `ai.query` |
| POST | `/api/v1/ai/insights/review` | `ai.query` |
| GET | `/api/v1/ai/status` | `facility.read` |
| GET | `/api/v1/ai/stock-depletion` | `inventory.read` |

## Analytics

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/analytics/benchmark` | `analytics.benchmark` |
| GET | `/api/v1/analytics/comparison` | `kpi.read` |
| GET | `/api/v1/analytics/dashboard` | `analytics.read` |
| GET | `/api/v1/analytics/data-quality` | `analytics.read` |
| GET | `/api/v1/analytics/drill-down` | `analytics.read` |
| GET | `/api/v1/analytics/figures` | `analytics.read` |
| POST | `/api/v1/analytics/refresh` | `kpi.compute` |
| GET | `/api/v1/analytics/search` | `facility.read` |
| GET | `/api/v1/analytics/trend` | `analytics.read` |

## Assessment

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/assessments` | `assessment.write` |
| GET | `/api/v1/assessments/:id` | `assessment.read` |
| GET | `/api/v1/assessments/:id/progress` | `assessment.read` |
| GET | `/api/v1/assessments/:id/readiness` | `assessment.read` |
| POST | `/api/v1/assessments/:id/responses` | `assessment.write` |
| POST | `/api/v1/assessments/:id/submit` | `assessment.submit` |

## Asset

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/assets` | `asset.read` |
| POST | `/api/v1/assets/:id/advance` | `asset.commission` |
| POST | `/api/v1/assets/:id/commissioning` | `asset.commission` |
| POST | `/api/v1/assets/maintenance` | `asset.write` |
| GET | `/api/v1/assets/maintenance/due` | `asset.read` |

## Attendance

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/attendance/clock` | `attendance.record` |
| POST | `/api/v1/attendance/correct` | `attendance.correct` |
| POST | `/api/v1/attendance/schedules` | `hr.write` |
| GET | `/api/v1/attendance/summary` | `attendance.read` |

## Auth

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/auth/login` | *public* |
| POST | `/api/v1/auth/logout` | `facility.read` |
| POST | `/api/v1/auth/logout-all` | `facility.read` |
| GET | `/api/v1/auth/me` | `facility.read` |
| POST | `/api/v1/auth/mfa/enrol/confirm` | *public* |
| POST | `/api/v1/auth/mfa/verify` | *public* |
| POST | `/api/v1/auth/password` | `facility.read` |
| POST | `/api/v1/auth/refresh` | *public* |
| GET | `/api/v1/auth/sessions` | `facility.read` |
| DELETE | `/api/v1/auth/sessions/:id` | `facility.read` |

## Baseline

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/baselines` | `baseline.read` |
| GET | `/api/v1/baselines/:id` | `baseline.read` |
| PATCH | `/api/v1/baselines/:id` | `baseline.seal` |
| GET | `/api/v1/baselines/preview/:assessmentId` | `baseline.read` |
| POST | `/api/v1/baselines/seal/:assessmentId` | `baseline.seal` |

## Billing

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/billing/charges` | `billing.charge` |
| GET | `/api/v1/billing/invoices` | `billing.read` |
| POST | `/api/v1/billing/invoices` | `billing.invoice` |
| POST | `/api/v1/billing/payments` | `payment.receive` |
| POST | `/api/v1/billing/waive` | `billing.waive` |

## Capex

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/capex-plans` | `capex.read` |
| POST | `/api/v1/capex-plans` | `capex.write` |
| GET | `/api/v1/capex-plans/:id` | `capex.read` |
| POST | `/api/v1/capex-plans/:id/working-capital` | `capex.write` |
| POST | `/api/v1/capex-plans/lines` | `capex.write` |
| POST | `/api/v1/capex-plans/lines/:id/approve` | `capex.approve` |

## Complaint

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/complaints` | `quality.read` |
| POST | `/api/v1/complaints` | `quality.write` |
| POST | `/api/v1/complaints/actions` | `quality.write` |
| POST | `/api/v1/complaints/resolve` | `quality.close` |

## Compliance

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/compliance` | `quality.read` |
| POST | `/api/v1/compliance/status` | `quality.write` |

## Contract

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/contracts/:id/content` | `contract.read` |
| POST | `/api/v1/contracts/:id/execute` | `contract.execute` |
| POST | `/api/v1/contracts/generate` | `contract.draft` |

## Credential

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/credentials` | `hr.write` |
| GET | `/api/v1/credentials/expiring` | `hr.read` |
| POST | `/api/v1/credentials/suspend` | `hr.credential_verify` |
| POST | `/api/v1/credentials/verify` | `hr.credential_verify` |

## Document

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/documents/:id` | `document.read` |
| GET | `/api/v1/documents/:id/content` | `document.read` |
| POST | `/api/v1/documents/:id/decide` | `document.approve` |
| POST | `/api/v1/documents/:id/submit` | `document.generate` |
| POST | `/api/v1/documents/generate` | `document.generate` |

## Encounter

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/encounters` | `encounter.write` |
| POST | `/api/v1/encounters/:id/close` | `encounter.write` |
| POST | `/api/v1/encounters/diagnoses` | `clinical.write` |
| POST | `/api/v1/encounters/diagnoses/:id/amend` | `clinical.amend` |
| POST | `/api/v1/encounters/notes` | `clinical.write` |
| POST | `/api/v1/encounters/notes/:id/amend` | `clinical.amend` |
| POST | `/api/v1/encounters/notes/:id/sign` | `clinical.write` |
| POST | `/api/v1/encounters/notes/:id/update` | `clinical.write` |
| GET | `/api/v1/encounters/timeline/:patientId` | `clinical.read` |
| POST | `/api/v1/encounters/triage` | `encounter.write` |

## Evidence

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/evidence` | `evidence.read` |
| POST | `/api/v1/evidence` | `evidence.upload` |
| GET | `/api/v1/evidence/:id` | `evidence.read` |
| POST | `/api/v1/evidence/:id/confirm-upload` | `evidence.upload` |
| POST | `/api/v1/evidence/:id/upload-intent` | `evidence.upload` |
| POST | `/api/v1/evidence/:id/verify` | `evidence.verify` |

## Facility

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/facilities` | `facility.read` |
| GET | `/api/v1/facilities/:id` | `facility.read` |
| GET | `/api/v1/facilities/:id/stage-history` | `facility.read` |
| POST | `/api/v1/facilities/:id/transition` | `facility.transition_stage` |

## Finance

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/finance/daily-cash` | `finance.reconcile` |
| GET | `/api/v1/finance/entries/:sourceType/:sourceId` | `finance.read` |
| POST | `/api/v1/finance/periods` | `finance.post` |
| POST | `/api/v1/finance/periods/:id/close` | `finance.close_period` |
| GET | `/api/v1/finance/trial-balance` | `finance.read` |

## FinancialModel

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/financial-models` | `financial_model.write` |
| GET | `/api/v1/financial-models/:id` | `financial_model.read` |
| POST | `/api/v1/financial-models/:id/approve` | `financial_model.approve` |
| POST | `/api/v1/financial-models/:id/assumptions/:code` | `financial_model.write` |
| POST | `/api/v1/financial-models/:id/assumptions/:code/preview` | `financial_model.read` |
| GET | `/api/v1/financial-models/:id/scenarios/:scenarioType` | `financial_model.read` |
| POST | `/api/v1/financial-models/:id/scenarios/:scenarioType/compute` | `financial_model.write` |
| GET | `/api/v1/financial-models/:id/sensitivity` | `financial_model.read` |
| POST | `/api/v1/financial-models/:id/unlock` | `financial_model.unlock` |

## Finding

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/findings` | `assessment.read` |
| POST | `/api/v1/findings` | `assessment.write` |

## Incentive

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/incentives/:incentiveId` | `performance.read` |
| POST | `/api/v1/incentives/approve` | `performance.approve_incentive` |
| POST | `/api/v1/incentives/compute` | `performance.compute_incentive` |

## Incident

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/incidents` | `quality.read` |
| POST | `/api/v1/incidents` | `quality.write` |
| POST | `/api/v1/incidents/actions/complete` | `quality.write` |
| POST | `/api/v1/incidents/close` | `quality.close` |
| POST | `/api/v1/incidents/investigate` | `quality.write` |

## Inventory

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/inventory/adjust` | `inventory.adjust` |
| GET | `/api/v1/inventory/batches/:id/reconcile` | `inventory.read` |
| GET | `/api/v1/inventory/expiring` | `inventory.read` |
| POST | `/api/v1/inventory/receive` | `inventory.receive` |
| GET | `/api/v1/inventory/stock` | `inventory.read` |
| POST | `/api/v1/inventory/write-off` | `inventory.adjust` |

## Kpi

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/kpis` | `kpi.read` |
| POST | `/api/v1/kpis/assign` | `kpi.configure` |
| POST | `/api/v1/kpis/compute` | `kpi.compute` |
| GET | `/api/v1/kpis/queries` | `kpi.read` |
| GET | `/api/v1/kpis/registry` | `kpi.read` |
| GET | `/api/v1/kpis/results/:resultId` | `kpi.read` |

## Laboratory

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/laboratory/critical` | `lab.read` |
| POST | `/api/v1/laboratory/orders` | `lab.order` |
| POST | `/api/v1/laboratory/results` | `lab.process` |
| POST | `/api/v1/laboratory/results/:id/acknowledge` | `clinical.read` |
| POST | `/api/v1/laboratory/results/:id/verify` | `lab.verify` |
| GET | `/api/v1/laboratory/results/encounter/:encounterId` | `lab.read` |
| POST | `/api/v1/laboratory/samples` | `lab.collect` |
| POST | `/api/v1/laboratory/samples/:id/reject` | `lab.collect` |

## Lineage

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/lineage` | `analytics.read` |
| GET | `/api/v1/lineage/:entityType/:id/downstream` | `analytics.read` |
| GET | `/api/v1/lineage/:entityType/:id/upstream` | `analytics.read` |

## Meta

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/meta/health` | *public* |
| GET | `/api/v1/meta/version` | *public* |

## Need

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/needs` | `needs.read` |
| POST | `/api/v1/needs` | `needs.write` |

## Partnership

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/partnerships` | `partnership.write` |
| GET | `/api/v1/partnerships/:id` | `partnership.read` |
| GET | `/api/v1/partnerships/:id/capital-recovery` | `partnership.read` |
| GET | `/api/v1/partnerships/:id/settlement/:financialPeriodId` | `partnership.compute_waterfall` |
| POST | `/api/v1/partnerships/obligations` | `partnership.write` |
| POST | `/api/v1/partnerships/obligations/:id/settle` | `partnership.write` |
| POST | `/api/v1/partnerships/parties` | `partnership.write` |
| POST | `/api/v1/partnerships/recovery-events` | `partnership.write` |
| POST | `/api/v1/partnerships/revenue-share-models` | `partnership.write` |

## Patient

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/patients` | `patient.write` |
| GET | `/api/v1/patients/:id` | `patient.read` |
| POST | `/api/v1/patients/consents` | `patient.write` |
| POST | `/api/v1/patients/consents/withdraw` | `patient.write` |
| POST | `/api/v1/patients/duplicate-check` | `patient.read` |
| GET | `/api/v1/patients/duplicates` | `patient.read` |
| POST | `/api/v1/patients/merge` | `patient.merge` |
| GET | `/api/v1/patients/search` | `patient.read` |

## Performance

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/performance/compute` | `performance.read` |
| GET | `/api/v1/performance/metrics` | `performance.read` |
| POST | `/api/v1/performance/metrics` | `performance.configure` |
| GET | `/api/v1/performance/queries` | `performance.read` |

## Pharmacy

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/pharmacy/dispense` | `pharmacy.dispense` |
| POST | `/api/v1/pharmacy/preview` | `pharmacy.read` |
| POST | `/api/v1/pharmacy/returns` | `pharmacy.dispense` |

## Procurement

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/procurement/invoices` | `procurement.receive` |
| GET | `/api/v1/procurement/invoices/:id/match` | `procurement.read` |
| POST | `/api/v1/procurement/invoices/:id/pay` | `payment.raise` |
| POST | `/api/v1/procurement/orders` | `procurement.order` |
| POST | `/api/v1/procurement/payments/:id/approve` | `payment.approve` |
| POST | `/api/v1/procurement/quotations` | `procurement.request` |
| POST | `/api/v1/procurement/quotations/:id/select` | `procurement.order` |
| POST | `/api/v1/procurement/receipts` | `procurement.receive` |
| POST | `/api/v1/procurement/requests` | `procurement.request` |
| POST | `/api/v1/procurement/requests/:id/decide` | `procurement.approve` |
| POST | `/api/v1/procurement/suppliers` | `procurement.request` |

## Project

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/projects` | `project.write` |
| GET | `/api/v1/projects/:id` | `project.read` |
| POST | `/api/v1/projects/phases` | `project.write` |
| POST | `/api/v1/projects/tasks` | `project.write` |
| POST | `/api/v1/projects/tasks/:id/progress` | `project.write` |

## QualityCycle

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/quality-cycles` | `quality.read` |
| POST | `/api/v1/quality-cycles` | `quality.write` |
| POST | `/api/v1/quality-cycles/advance` | `quality.write` |

## Recommendation

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/recommendations` | `needs.write` |

## Risk

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/risks` | `quality.read` |
| POST | `/api/v1/risks` | `quality.write` |

## Staff

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/staff` | `hr.read` |
| POST | `/api/v1/staff` | `hr.write` |
| GET | `/api/v1/staff/:staffId/credentials` | `hr.read` |
| GET | `/api/v1/staff/establishment` | `hr.read` |
| POST | `/api/v1/staff/exit` | `hr.write` |
