/**
 * Commissioning (spec §22, acceptance criterion F).
 *
 * An asset is not a resource because it arrived. A theatre lamp in a crate is
 * not light in a theatre. It counts toward what a facility can actually do
 * only when every check passes — and "every" is the whole point: a piece of
 * equipment that works but has nobody trained on it is not available for
 * patients, and reporting it as available would put a number in a government
 * report that the facility cannot deliver against.
 *
 * Pure: no I/O, no clock.
 */

export interface CommissioningChecks {
  functionalTestPassed: boolean;
  safetyCheckPassed: boolean;
  staffTrained: boolean;
  consumablesAvailable: boolean;
  utilitiesConnected: boolean;
}

export const COMMISSIONING_CHECKS: Array<{
  key: keyof CommissioningChecks;
  label: string;
  whyItMatters: string;
}> = [
  {
    key: 'functionalTestPassed',
    label: 'Functional test',
    whyItMatters: 'Equipment that has not been switched on and tested is not known to work.',
  },
  {
    key: 'safetyCheckPassed',
    label: 'Safety check',
    whyItMatters: 'Electrical and mechanical safety, before anyone stands next to it.',
  },
  {
    key: 'staffTrained',
    label: 'Staff trained',
    whyItMatters: 'Equipment nobody can operate is not a service the facility offers.',
  },
  {
    key: 'consumablesAvailable',
    label: 'Consumables available',
    whyItMatters: 'An analyser with no reagents runs no tests.',
  },
  {
    key: 'utilitiesConnected',
    label: 'Utilities connected',
    whyItMatters: 'Power, water and drainage as the equipment requires them.',
  },
];

export interface CommissioningReadiness {
  ready: boolean;
  passed: number;
  total: number;
  outstanding: Array<{ key: keyof CommissioningChecks; label: string; whyItMatters: string }>;
  /** Stated plainly, for a screen and for a report. */
  summary: string;
}

export function assessReadiness(checks: CommissioningChecks): CommissioningReadiness {
  const outstanding = COMMISSIONING_CHECKS.filter((check) => !checks[check.key]);
  const passed = COMMISSIONING_CHECKS.length - outstanding.length;

  return {
    ready: outstanding.length === 0,
    passed,
    total: COMMISSIONING_CHECKS.length,
    outstanding,
    summary:
      outstanding.length === 0
        ? `All ${COMMISSIONING_CHECKS.length} commissioning checks pass. This asset is available for use.`
        : `${passed} of ${COMMISSIONING_CHECKS.length} checks pass. Outstanding: ` +
          `${outstanding.map((check) => check.label.toLowerCase()).join(', ')}. ` +
          'This asset is not yet available for use and does not count toward service readiness.',
  };
}

/**
 * Which commissioning status an asset may hold, given its checks.
 *
 * Progression is by evidence, not by declaration: a status cannot be set
 * beyond what the checks support. COMMISSIONED in particular requires all
 * five, which is acceptance criterion F.
 */
export const COMMISSIONING_PROGRESSION = [
  'NOT_RECEIVED',
  'RECEIVED',
  'INSTALLED',
  'TESTED',
  'COMMISSIONED',
  'DECOMMISSIONED',
] as const;

export type CommissioningStatus = (typeof COMMISSIONING_PROGRESSION)[number];

export interface StatusDecision {
  allowed: boolean;
  reason?: string;
}

export function canAdvanceTo(
  target: CommissioningStatus,
  current: CommissioningStatus,
  checks: CommissioningChecks,
): StatusDecision {
  if (target === current) {
    return { allowed: false, reason: `This asset is already ${current}.` };
  }

  // Decommissioning is always available: equipment breaks, and a facility must
  // be able to say so at any point.
  if (target === 'DECOMMISSIONED') return { allowed: true };

  if (current === 'DECOMMISSIONED') {
    return {
      allowed: false,
      reason:
        'This asset is decommissioned. Recommissioning it means receiving it again as a repaired or replaced ' +
        'asset, so that the checks are performed afresh.',
    };
  }

  const currentIndex = COMMISSIONING_PROGRESSION.indexOf(current);
  const targetIndex = COMMISSIONING_PROGRESSION.indexOf(target);

  if (targetIndex < currentIndex) {
    return {
      allowed: false,
      reason:
        `An asset cannot move back from ${current} to ${target}. If the earlier step was recorded in error, ` +
        'correct it with a note rather than reversing the status.',
    };
  }

  if (targetIndex > currentIndex + 1) {
    return {
      allowed: false,
      reason:
        `An asset cannot go from ${current} straight to ${target}. Record ` +
        `${COMMISSIONING_PROGRESSION[currentIndex + 1]} first, so each step has a date and a person against it.`,
    };
  }

  if (target === 'TESTED' && !checks.functionalTestPassed) {
    return { allowed: false, reason: 'The functional test has not been recorded as passed.' };
  }

  if (target === 'COMMISSIONED') {
    const readiness = assessReadiness(checks);
    if (!readiness.ready) {
      return { allowed: false, reason: readiness.summary };
    }
  }

  return { allowed: true };
}

/**
 * What a facility can actually deliver, counted honestly.
 *
 * Only commissioned assets count. An asset in a crate, an asset nobody is
 * trained on, and an asset with no power are all equipment the facility owns
 * and cannot use; reporting them as capacity would put a figure in a
 * government report the facility cannot deliver against (§82).
 */
export function readinessSummary(
  assets: ReadonlyArray<{ category: string; commissioningStatus: string }>,
): {
  total: number;
  commissioned: number;
  awaitingCommissioning: number;
  decommissioned: number;
  byCategory: Record<string, { total: number; commissioned: number }>;
  note: string;
} {
  const byCategory: Record<string, { total: number; commissioned: number }> = {};
  let commissioned = 0;
  let decommissioned = 0;

  for (const asset of assets) {
    const entry = byCategory[asset.category] ?? { total: 0, commissioned: 0 };
    entry.total += 1;

    if (asset.commissioningStatus === 'COMMISSIONED') {
      entry.commissioned += 1;
      commissioned += 1;
    } else if (asset.commissioningStatus === 'DECOMMISSIONED') {
      decommissioned += 1;
    }

    byCategory[asset.category] = entry;
  }

  const awaiting = assets.length - commissioned - decommissioned;

  return {
    total: assets.length,
    commissioned,
    awaitingCommissioning: awaiting,
    decommissioned,
    byCategory,
    note:
      awaiting === 0
        ? 'Every asset on the register is either commissioned or decommissioned.'
        : `${awaiting} asset(s) are owned but not yet available for use. They are excluded from service readiness.`,
  };
}
