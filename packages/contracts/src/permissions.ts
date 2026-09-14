/**
 * Permission catalogue and role templates (doc 08).
 *
 * This file is the source of truth. The `permission` table is seeded from it,
 * the API's `@RequirePermission()` decorator is typed against it, and the web
 * client's route guards import the same constants — so a permission cannot
 * exist on one side of the wire and not the other.
 */

export const PERMISSIONS = [
  // Facility and configuration
  'facility.read',
  'facility.write',
  'facility.transition_stage',
  'config.read',
  'config.write',

  // Assessment and evidence
  'assessment.read',
  'assessment.write',
  'assessment.submit',
  'assessment.verify',
  'evidence.read',
  'evidence.upload',
  'evidence.verify',
  'baseline.read',
  'baseline.seal',

  // Planning
  'needs.read',
  'needs.write',
  'needs.prioritise',
  'capex.read',
  'capex.write',
  'capex.approve',
  'financial_model.read',
  'financial_model.write',
  'financial_model.approve',
  'financial_model.unlock',

  // Partnership and contracts
  'partnership.read',
  'partnership.write',
  'partnership.compute_waterfall',
  'proposal.read',
  'proposal.write',
  'proposal.approve',
  'contract.read',
  'contract.draft',
  'contract.execute',

  // Execution
  'project.read',
  'project.write',
  'project.complete',
  'procurement.read',
  'procurement.request',
  'procurement.approve',
  'procurement.order',
  'procurement.receive',
  'asset.read',
  'asset.write',
  'asset.commission',

  // Clinical
  'patient.read',
  'patient.read_identified',
  'patient.write',
  'patient.merge',
  'encounter.read',
  'encounter.write',
  'encounter.close',
  'clinical.read',
  'clinical.write',
  'clinical.amend',
  'lab.read',
  'lab.order',
  'lab.collect',
  'lab.process',
  'lab.verify',
  'pharmacy.read',
  'pharmacy.verify',
  'pharmacy.dispense',
  'pharmacy.return',

  // Supply chain
  'inventory.read',
  'inventory.receive',
  'inventory.issue',
  'inventory.adjust',
  'inventory.count',

  // Finance
  'billing.read',
  'billing.charge',
  'billing.invoice',
  'billing.waive',
  'payment.receive',
  'payment.refund',
  'finance.read',
  'finance.post',
  'finance.reverse',
  'finance.close_period',
  'finance.reconcile',

  // People
  'hr.read',
  'hr.write',
  'hr.credential_verify',
  'attendance.read',
  'attendance.record',
  'attendance.correct',
  'performance.read',
  'performance.configure',
  'performance.approve_incentive',

  // Quality and measurement
  'quality.read',
  'quality.write',
  'quality.close',
  'kpi.read',
  'kpi.configure',

  // Output
  'document.read',
  'document.generate',
  'document.approve',
  'report.read',
  'report.export',
  'analytics.read',
  'analytics.benchmark',
  'ai.query',

  // Administration
  'audit.read',
  'rbac.read',
  'rbac.write',
  'admin.system',
  'admin.backup',
  'admin.impersonate',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_SET = new Set<string>(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/** Split `module.action` for grouping in the admin UI and the seed. */
export function parsePermission(permission: Permission): { module: string; action: string } {
  const index = permission.indexOf('.');
  return { module: permission.slice(0, index), action: permission.slice(index + 1) };
}

export const ROLE_CODES = [
  'SUPER_ADMIN',
  'ORG_ADMIN',
  'FACILITY_MANAGER',
  'PROJECT_MANAGER',
  'CLINICAL_LEAD',
  'CLINICIAN',
  'NURSE',
  'CHEW',
  'LAB_PERSONNEL',
  'PHARMACY_PERSONNEL',
  'INVENTORY_OFFICER',
  'FINANCE_OFFICER',
  'CASHIER',
  'HR_OFFICER',
  'AUDITOR',
  'GOVERNMENT_OBSERVER',
  'COMMUNITY_OBSERVER',
  'PATIENT',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/**
 * Every read permission in the catalogue, including `audit.read`.
 *
 * `analytics.benchmark` is deliberately NOT here: cross-facility comparison is
 * a distinct capability, granted explicitly to the roles that need it.
 */
const READ_EVERYTHING: Permission[] = PERMISSIONS.filter((p) => p.endsWith('.read')) as Permission[];

/**
 * Seeded role templates (spec §58), each built to the least privilege that
 * lets the role do its job.
 *
 * These invariants are asserted by `rbac-least-privilege.spec.ts`, not merely
 * intended:
 *   - CASHIER holds no `clinical.*` permission.
 *   - GOVERNMENT_OBSERVER and COMMUNITY_OBSERVER hold no `patient.read_identified`.
 *   - AUDITOR holds nothing ending in write/post/approve/execute/dispense/adjust.
 *   - No seeded role holds `admin.impersonate`.
 */
export const ROLE_TEMPLATES: Record<RoleCode, { name: string; description: string; permissions: Permission[] }> = {
  SUPER_ADMIN: {
    name: 'Super Administrator',
    description:
      'Platform administration across organisations. Deliberately excludes patient.read_identified: seeing an identified clinical record requires an explicit, audited break-glass.',
    permissions: PERMISSIONS.filter(
      (p) => p !== 'patient.read_identified' && p !== 'admin.impersonate',
    ) as Permission[],
  },

  ORG_ADMIN: {
    name: 'Organisation Administrator',
    description: 'All facilities in the organisation. No clinical write access.',
    permissions: [
      ...READ_EVERYTHING,
      'facility.write',
      'facility.transition_stage',
      'config.write',
      'rbac.write',
      'capex.approve',
      // Sealing Day 0 is irreversible and establishes the reference point for
      // the whole partnership, so it sits with the administrator rather than
      // the project manager who captured the assessment. Same reasoning for
      // verification: its value comes from being done by someone else.
      'baseline.seal',
      'evidence.verify',
      'assessment.verify',
      // A partnership is a commercial and legal arrangement, not a planning
      // artefact, so drafting one sits with the administrator alongside the
      // contract permissions rather than with the project manager.
      'partnership.write',
      // Computing a settlement reads the ledger and applies the agreed terms.
      // READ_EVERYTHING already exposes every input; withholding the total the
      // government is owed would protect nothing and would stop the person who
      // signed the agreement from reporting on it.
      'partnership.compute_waterfall',
      'financial_model.approve',
      // Unlocking an approved model belongs with the person who approved it,
      // not the modeller. It supersedes the approved version rather than
      // editing it, and the new version still needs a second approver — so a
      // single administrator cannot approve, unlock and re-approve alone.
      'financial_model.unlock',
      'proposal.approve',
      'contract.draft',
      'contract.execute',
      'document.approve',
      'report.export',
      'kpi.configure',
      'performance.configure',
      'ai.query',
      'admin.backup',
    ] as Permission[],
  },

  FACILITY_MANAGER: {
    name: 'Facility Manager',
    description: 'Day-to-day operations, staff, stock oversight, finance read, KPIs. No clinical write.',
    permissions: [
      'facility.read',
      'config.read',
      'assessment.read',
      'evidence.read',
      'baseline.read',
      'needs.read',
      'capex.read',
      'financial_model.read',
      'partnership.read',
      'project.read',
      'procurement.read',
      'procurement.approve',
      'asset.read',
      'patient.read',
      'encounter.read',
      'clinical.read',
      'lab.read',
      'pharmacy.read',
      'inventory.read',
      'inventory.adjust',
      'billing.read',
      'billing.waive',
      'finance.read',
      'finance.reconcile',
      'hr.read',
      'hr.write',
      'attendance.read',
      'attendance.correct',
      'performance.read',
      'performance.approve_incentive',
      'quality.read',
      'quality.write',
      'quality.close',
      'kpi.read',
      'document.read',
      'document.generate',
      'report.read',
      'report.export',
      'analytics.read',
      'ai.query',
    ],
  },

  PROJECT_MANAGER: {
    name: 'Project Manager',
    description: 'Assessment, projects, procurement, CAPEX and risks.',
    permissions: [
      'facility.read',
      'config.read',
      'assessment.read',
      'assessment.write',
      'assessment.submit',
      'evidence.read',
      'evidence.upload',
      'baseline.read',
      'needs.read',
      'needs.write',
      'needs.prioritise',
      'capex.read',
      'capex.write',
      'financial_model.read',
      'financial_model.write',
      'partnership.read',
      'proposal.read',
      'proposal.write',
      'contract.read',
      'project.read',
      'project.write',
      'project.complete',
      'procurement.read',
      'procurement.request',
      'procurement.order',
      'procurement.receive',
      'asset.read',
      'asset.write',
      'asset.commission',
      'quality.read',
      'quality.write',
      'kpi.read',
      'document.read',
      'document.generate',
      'report.read',
      'analytics.read',
      'ai.query',
    ],
  },

  CLINICAL_LEAD: {
    name: 'Clinical Lead',
    description: 'Full clinical access, amendments, clinical audit and quality.',
    permissions: [
      'facility.read',
      'config.read',
      'patient.read',
      'patient.read_identified',
      'patient.write',
      'patient.merge',
      'encounter.read',
      'encounter.write',
      'encounter.close',
      'clinical.read',
      'clinical.write',
      'clinical.amend',
      'lab.read',
      'lab.order',
      'lab.verify',
      'pharmacy.read',
      'pharmacy.verify',
      'quality.read',
      'quality.write',
      'quality.close',
      'kpi.read',
      'document.read',
      'report.read',
      'analytics.read',
      'ai.query',
    ],
  },

  CLINICIAN: {
    name: 'Doctor / Clinician',
    description: 'Consultation, orders and prescriptions within their facility.',
    permissions: [
      'facility.read',
      'patient.read',
      'patient.read_identified',
      'patient.write',
      'encounter.read',
      'encounter.write',
      'encounter.close',
      'clinical.read',
      'clinical.write',
      'clinical.amend',
      'lab.read',
      'lab.order',
      'pharmacy.read',
      'quality.read',
      'quality.write',
      'document.read',
      'report.read',
    ],
  },

  NURSE: {
    name: 'Nurse / Midwife',
    description: 'Triage, nursing, maternity, immunisation and follow-up.',
    permissions: [
      'facility.read',
      'patient.read',
      'patient.read_identified',
      'patient.write',
      'encounter.read',
      'encounter.write',
      'clinical.read',
      'clinical.write',
      'lab.read',
      'lab.collect',
      'pharmacy.read',
      'inventory.read',
      'quality.read',
      'quality.write',
      'attendance.record',
      'document.read',
    ],
  },

  CHEW: {
    name: 'CHEW / Community Health Worker',
    description: 'Triage, limited consultation, community work and outreach.',
    permissions: [
      'facility.read',
      'patient.read',
      'patient.read_identified',
      'patient.write',
      'encounter.read',
      'encounter.write',
      'clinical.read',
      'clinical.write',
      'assessment.read',
      'assessment.write',
      'evidence.upload',
      'quality.read',
      'attendance.record',
      'document.read',
    ],
  },

  LAB_PERSONNEL: {
    name: 'Laboratory Personnel',
    description: 'Orders, samples, results, verification, QC and reagent stock.',
    permissions: [
      'facility.read',
      'patient.read',
      'patient.read_identified',
      'encounter.read',
      'lab.read',
      'lab.collect',
      'lab.process',
      'lab.verify',
      'inventory.read',
      'inventory.issue',
      'quality.read',
      'quality.write',
      'attendance.record',
      'document.read',
      'report.read',
    ],
  },

  PHARMACY_PERSONNEL: {
    name: 'Pharmacy Personnel',
    description: 'Prescription verification, dispensing and pharmacy stock.',
    permissions: [
      'facility.read',
      'patient.read',
      'patient.read_identified',
      'encounter.read',
      'clinical.read',
      'pharmacy.read',
      'pharmacy.verify',
      'pharmacy.dispense',
      'pharmacy.return',
      'inventory.read',
      'inventory.receive',
      'inventory.issue',
      'inventory.count',
      'billing.read',
      'billing.charge',
      'quality.read',
      'attendance.record',
      'document.read',
      'report.read',
    ],
  },

  INVENTORY_OFFICER: {
    name: 'Inventory Officer',
    description: 'Stock receipt, issue and counts. Adjustments require a separate approver.',
    permissions: [
      'facility.read',
      'inventory.read',
      'inventory.receive',
      'inventory.issue',
      'inventory.count',
      'inventory.adjust',
      'procurement.read',
      'procurement.request',
      'procurement.receive',
      'asset.read',
      'quality.read',
      'attendance.record',
      'document.read',
      'report.read',
    ],
  },

  FINANCE_OFFICER: {
    name: 'Finance Officer',
    description: 'Billing, payments, ledger, reconciliation and budgets.',
    permissions: [
      'facility.read',
      'config.read',
      'billing.read',
      'billing.charge',
      'billing.invoice',
      'billing.waive',
      'payment.receive',
      'payment.refund',
      'finance.read',
      'finance.post',
      'finance.reverse',
      'finance.close_period',
      'finance.reconcile',
      'procurement.read',
      'project.read',
      'partnership.read',
      'partnership.compute_waterfall',
      'financial_model.read',
      'capex.read',
      'kpi.read',
      'document.read',
      'document.generate',
      'report.read',
      'report.export',
      'analytics.read',
      'ai.query',
    ],
  },

  CASHIER: {
    name: 'Cashier',
    description:
      'Receives payments and issues receipts. Holds NO clinical permission of any kind — asserted by test.',
    permissions: [
      'facility.read',
      'patient.read',
      'billing.read',
      'payment.receive',
      'document.read',
      'attendance.record',
    ],
  },

  HR_OFFICER: {
    name: 'HR Officer',
    description: 'Staff records, credentials, postings, attendance and leave.',
    permissions: [
      'facility.read',
      'hr.read',
      'hr.write',
      'hr.credential_verify',
      'attendance.read',
      'attendance.record',
      'attendance.correct',
      'performance.read',
      'quality.read',
      'document.read',
      'report.read',
      'analytics.read',
    ],
  },

  AUDITOR: {
    name: 'Auditor',
    description:
      'Read-only everywhere, including the audit log. Holds no write permission anywhere in the system — asserted by test.',
    permissions: [...READ_EVERYTHING, 'patient.read_identified', 'report.export', 'analytics.benchmark'],
  },

  GOVERNMENT_OBSERVER: {
    name: 'Government / LGA Observer',
    description:
      'Aggregate performance, KPIs and public value. No identified patient data, ever (spec §41).',
    permissions: [
      'facility.read',
      'kpi.read',
      'analytics.read',
      'analytics.benchmark',
      'report.read',
      'document.read',
      'partnership.read',
      'project.read',
      'asset.read',
      'quality.read',
    ],
  },

  COMMUNITY_OBSERVER: {
    name: 'Community Observer',
    description: 'A narrower aggregate view for community representatives.',
    permissions: ['facility.read', 'kpi.read', 'report.read', 'quality.read'],
  },

  PATIENT: {
    name: 'Patient',
    description: 'Own record only: demographics, appointments, and results released to patients.',
    permissions: ['patient.read', 'encounter.read', 'clinical.read', 'lab.read', 'billing.read'],
  },
};

/**
 * Roles for which MFA is mandatory (doc 07 §3) — those that can move money,
 * execute agreements, or change who can do what.
 */
export const MFA_REQUIRED_ROLES: RoleCode[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'FINANCE_OFFICER', 'AUDITOR'];

/**
 * Roles barred from offline mode (doc 07 §5).
 *
 * Offline permissions are a snapshot from the last sync, so a revocation
 * reaches the device late. High-privilege roles must not carry that risk.
 */
export const OFFLINE_DISALLOWED_ROLES: RoleCode[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'FINANCE_OFFICER', 'AUDITOR'];

/**
 * Action-level segregation of duties (doc 18 §9).
 *
 * Enforced per action rather than by role design, because an organisation may
 * legitimately grant one person both permissions and the check must still hold.
 */
export const SEGREGATION_OF_DUTIES: ReadonlyArray<{
  action: string;
  conflictsWith: string;
  rule: string;
}> = [
  { action: 'payment.raise', conflictsWith: 'payment.approve', rule: 'The person who raises a payment may not approve it.' },
  { action: 'procurement.request', conflictsWith: 'procurement.approve', rule: 'The requester may not approve the purchase order.' },
  { action: 'inventory.adjust', conflictsWith: 'inventory.adjust.approve', rule: 'The person recording a stock adjustment may not approve it.' },
  { action: 'finance.post', conflictsWith: 'finance.close_period', rule: 'The person posting entries may not close the period.' },
  { action: 'performance.compute_incentive', conflictsWith: 'performance.approve_incentive', rule: 'The person computing an incentive may not approve its payment.' },
];
