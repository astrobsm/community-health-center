import { describe, expect, it } from 'vitest';

import {
  MFA_REQUIRED_ROLES,
  OFFLINE_DISALLOWED_ROLES,
  PERMISSIONS,
  ROLE_CODES,
  ROLE_TEMPLATES,
  SEGREGATION_OF_DUTIES,
  isPermission,
  parsePermission,
  type Permission,
  type RoleCode,
} from './permissions.js';

describe('permission catalogue', () => {
  it('has no duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('uses module.action form throughout', () => {
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z_]+\.[a-z_]+$/);
      const { module, action } = parsePermission(permission);
      expect(module).not.toBe('');
      expect(action).not.toBe('');
    }
  });

  it('recognises only catalogued permissions', () => {
    expect(isPermission('pharmacy.dispense')).toBe(true);
    expect(isPermission('pharmacy.destroy_everything')).toBe(false);
  });
});

describe('role templates', () => {
  it('defines every role code', () => {
    for (const code of ROLE_CODES) {
      expect(ROLE_TEMPLATES[code]).toBeDefined();
      expect(ROLE_TEMPLATES[code].name).not.toBe('');
      expect(ROLE_TEMPLATES[code].description).not.toBe('');
    }
  });

  it('grants only permissions that exist in the catalogue', () => {
    // The seed fails loudly on an unknown permission; this catches it earlier,
    // at the point the role is edited.
    for (const code of ROLE_CODES) {
      for (const permission of ROLE_TEMPLATES[code].permissions) {
        expect(isPermission(permission), `${code} grants unknown permission "${permission}"`).toBe(true);
      }
    }
  });

  it('grants no role a duplicate permission', () => {
    for (const code of ROLE_CODES) {
      const granted = ROLE_TEMPLATES[code].permissions;
      expect(new Set(granted).size, `${code} lists a permission twice`).toBe(granted.length);
    }
  });
});

describe('least privilege — these are the claims doc 08 makes, asserted', () => {
  const has = (role: RoleCode, permission: Permission) =>
    ROLE_TEMPLATES[role].permissions.includes(permission);

  it('the Cashier holds no clinical permission whatsoever', () => {
    // A cashier handles money at a window. Giving them clinical read access
    // would be a confidentiality failure with no operational justification.
    const clinicalPrefixes = ['clinical.', 'lab.', 'pharmacy.', 'encounter.write'];
    for (const permission of ROLE_TEMPLATES.CASHIER.permissions) {
      for (const prefix of clinicalPrefixes) {
        expect(permission.startsWith(prefix), `CASHIER must not hold ${permission}`).toBe(false);
      }
    }
    expect(has('CASHIER', 'patient.read_identified')).toBe(false);
  });

  it('observer roles never see identified patient data', () => {
    // Spec section 41: patient-identifiable data must not be exposed to
    // government or community observers.
    expect(has('GOVERNMENT_OBSERVER', 'patient.read_identified')).toBe(false);
    expect(has('COMMUNITY_OBSERVER', 'patient.read_identified')).toBe(false);
    expect(has('GOVERNMENT_OBSERVER', 'patient.read')).toBe(false);
    expect(has('COMMUNITY_OBSERVER', 'patient.read')).toBe(false);
  });

  it('the Auditor can read everything and write nothing', () => {
    const writeLike = ['write', 'post', 'approve', 'execute', 'dispense', 'adjust', 'seal', 'merge', 'receive', 'issue', 'refund', 'waive', 'close', 'unlock', 'commission', 'draft', 'generate', 'configure', 'record', 'correct', 'submit', 'verify', 'upload', 'order', 'collect', 'process', 'prioritise', 'request', 'complete', 'return', 'count', 'charge', 'invoice', 'transition_stage', 'compute_waterfall', 'credential_verify', 'approve_incentive'];
    for (const permission of ROLE_TEMPLATES.AUDITOR.permissions) {
      const { action } = parsePermission(permission);
      expect(
        writeLike.includes(action),
        `AUDITOR must hold no mutating permission, but holds "${permission}"`,
      ).toBe(false);
    }
    // And it must actually be able to audit.
    expect(has('AUDITOR', 'audit.read')).toBe(true);
  });

  it('no seeded role can impersonate another user', () => {
    // Impersonation must be granted deliberately, time-boxed and audited —
    // never inherited by holding a job title.
    for (const code of ROLE_CODES) {
      expect(has(code, 'admin.impersonate'), `${code} must not hold admin.impersonate`).toBe(false);
    }
  });

  it('the Super Administrator cannot read identified clinical data by default', () => {
    // Platform administration is not a clinical role. Reading a patient record
    // requires an explicit, audited break-glass.
    expect(has('SUPER_ADMIN', 'patient.read_identified')).toBe(false);
  });

  it('the Patient role reaches only its own record', () => {
    const allowed = new Set(['patient.read', 'encounter.read', 'clinical.read', 'lab.read', 'billing.read']);
    for (const permission of ROLE_TEMPLATES.PATIENT.permissions) {
      expect(allowed.has(permission), `PATIENT must not hold ${permission}`).toBe(true);
    }
  });

  it('clinical roles can do their job', () => {
    // Least privilege must not become "too little to work". These are the
    // permissions without which the role is useless.
    expect(has('CLINICIAN', 'clinical.write')).toBe(true);
    expect(has('CLINICIAN', 'lab.order')).toBe(true);
    expect(has('NURSE', 'clinical.write')).toBe(true);
    expect(has('PHARMACY_PERSONNEL', 'pharmacy.dispense')).toBe(true);
    expect(has('LAB_PERSONNEL', 'lab.verify')).toBe(true);
    expect(has('FINANCE_OFFICER', 'finance.post')).toBe(true);
    expect(has('PROJECT_MANAGER', 'project.write')).toBe(true);
  });

  it('separates pharmacist verification from dispensing', () => {
    // Two distinct permissions, so the professional check survives even where
    // one person holds both (doc 13 section 9).
    expect(isPermission('pharmacy.verify')).toBe(true);
    expect(isPermission('pharmacy.dispense')).toBe(true);
  });
});

describe('MFA and offline policy', () => {
  it('requires MFA for every role that can move money or change access', () => {
    for (const role of MFA_REQUIRED_ROLES) {
      expect(ROLE_CODES).toContain(role);
    }
    expect(MFA_REQUIRED_ROLES).toContain('FINANCE_OFFICER');
    expect(MFA_REQUIRED_ROLES).toContain('ORG_ADMIN');
    expect(MFA_REQUIRED_ROLES).toContain('SUPER_ADMIN');
  });

  it('bars high-privilege roles from offline mode', () => {
    // Offline permissions are a snapshot from the last sync, so revocation
    // reaches the device late. High-privilege roles must not carry that risk.
    for (const role of OFFLINE_DISALLOWED_ROLES) {
      expect(ROLE_CODES).toContain(role);
    }
    expect(OFFLINE_DISALLOWED_ROLES).toContain('FINANCE_OFFICER');
  });

  it('allows frontline clinical roles to work offline', () => {
    // The whole point of offline capability: care must not stop.
    for (const role of ['NURSE', 'CHEW', 'CLINICIAN', 'PHARMACY_PERSONNEL'] as RoleCode[]) {
      expect(OFFLINE_DISALLOWED_ROLES).not.toContain(role);
    }
  });
});

describe('segregation of duties', () => {
  it('declares a rule and a reason for every conflict pair', () => {
    expect(SEGREGATION_OF_DUTIES.length).toBeGreaterThan(0);
    for (const rule of SEGREGATION_OF_DUTIES) {
      expect(rule.action).not.toBe('');
      expect(rule.conflictsWith).not.toBe('');
      expect(rule.rule.length).toBeGreaterThan(20);
      expect(rule.action).not.toBe(rule.conflictsWith);
    }
  });

  it('covers the four conflicts that matter most', () => {
    const pairs = SEGREGATION_OF_DUTIES.map((r) => `${r.action}|${r.conflictsWith}`);
    expect(pairs).toContain('payment.raise|payment.approve');
    expect(pairs).toContain('procurement.request|procurement.approve');
    expect(pairs).toContain('inventory.adjust|inventory.adjust.approve');
    expect(pairs).toContain('performance.compute_incentive|performance.approve_incentive');
  });
});

describe('reachability', () => {
  /**
   * A permission granted only to SUPER_ADMIN is, in practice, a permission
   * nobody in an operating organisation holds.
   *
   * This test exists because two features were built against permissions no
   * seeded role carried — the work was correct and simply could not be
   * performed by anyone. Anything genuinely reserved for platform
   * administration belongs in the list below, stated on purpose.
   */
  const PLATFORM_ONLY: readonly Permission[] = [
    'admin.system',
    // Deliberately in no template at all, SUPER_ADMIN's included. Acting as
    // another person is granted one-off and audited, never inherited.
    'admin.impersonate',
  ];

  it('grants every permission to at least one role an organisation can assign', () => {
    const granted = new Set<string>();

    for (const [code, template] of Object.entries(ROLE_TEMPLATES)) {
      if (code === 'SUPER_ADMIN') continue;
      for (const permission of template.permissions) granted.add(permission);
    }

    const unreachable = PERMISSIONS.filter(
      (permission) => !granted.has(permission) && !PLATFORM_ONLY.includes(permission),
    );

    expect(unreachable, 'permissions no assignable role can exercise').toEqual([]);
  });

  it('gives someone the ability to build a model and someone else the ability to approve it', () => {
    // Separation of duties only works if both halves actually exist.
    const holders = (permission: Permission): string[] =>
      Object.entries(ROLE_TEMPLATES)
        .filter(([code, template]) => code !== 'SUPER_ADMIN' && template.permissions.includes(permission))
        .map(([code]) => code);

    expect(holders('financial_model.write').length).toBeGreaterThan(0);
    expect(holders('financial_model.approve').length).toBeGreaterThan(0);
    expect(holders('capex.write').length).toBeGreaterThan(0);
    expect(holders('capex.approve').length).toBeGreaterThan(0);

    // And they must not be the same single role, or the control is decorative.
    expect(holders('capex.write')).not.toEqual(holders('capex.approve'));
    expect(holders('financial_model.write')).not.toEqual(holders('financial_model.approve'));
  });
});
