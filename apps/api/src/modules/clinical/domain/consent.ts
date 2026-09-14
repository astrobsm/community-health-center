/**
 * Consent (spec §84, doc 13 §3).
 *
 * Purpose-scoped, versioned against the privacy notice the patient actually
 * saw, and withdrawable where withdrawal is meaningful.
 *
 * Effective consent is COMPUTED from the records on every read, never cached.
 * That is what makes a withdrawal take effect immediately rather than at the
 * next sync, the next cache expiry, or the next time somebody remembers.
 *
 * Pure: no I/O, and the clock is injected.
 */

export type ConsentPurpose =
  | 'TREATMENT'
  | 'DATA_STORAGE'
  | 'SMS_CONTACT'
  | 'RESEARCH_AGGREGATE'
  | 'PHOTOGRAPH'
  | 'GOVERNMENT_AGGREGATE_REPORTING';

export interface PurposeRule {
  purpose: ConsentPurpose;
  label: string;
  /** Care cannot proceed without it. */
  requiredForCare: boolean;
  /** Whether the patient may withdraw it through this system. */
  withdrawable: boolean;
  /** Said to the patient, and shown on the consent screen. */
  explanation: string;
}

export const CONSENT_PURPOSES: readonly PurposeRule[] = [
  {
    purpose: 'TREATMENT',
    label: 'Treatment',
    requiredForCare: true,
    // Not withdrawable here because withdrawing it means declining care, which
    // is a conversation with a clinician and a discharge, not a toggle.
    withdrawable: false,
    explanation: 'Consent to be examined and treated at this facility.',
  },
  {
    purpose: 'DATA_STORAGE',
    label: 'Keeping your records',
    requiredForCare: true,
    // Erasure is a separate, regulated process with its own retention rules;
    // a switch here would promise something the law may not permit.
    withdrawable: false,
    explanation: 'Keeping a record of your care so the next clinician who sees you knows your history.',
  },
  {
    purpose: 'SMS_CONTACT',
    label: 'Text messages',
    requiredForCare: false,
    withdrawable: true,
    explanation: 'Appointment reminders and follow-up messages by SMS.',
  },
  {
    purpose: 'RESEARCH_AGGREGATE',
    label: 'Research, without your name',
    requiredForCare: false,
    withdrawable: true,
    explanation: 'Including your data in research figures. Your name is never attached.',
  },
  {
    purpose: 'PHOTOGRAPH',
    label: 'Photographs',
    requiredForCare: false,
    withdrawable: true,
    explanation: 'Taking clinical photographs. Asked again each time one is needed.',
  },
  {
    purpose: 'GOVERNMENT_AGGREGATE_REPORTING',
    label: 'Government statistics',
    requiredForCare: false,
    // Reported as counts with no identity attached, under the facility's
    // statutory reporting obligations. The patient is told, not asked.
    withdrawable: false,
    explanation:
      'Counts of activity reported to the health authority. These are totals only and never identify you.',
  },
];

const BY_PURPOSE = new Map(CONSENT_PURPOSES.map((rule) => [rule.purpose, rule]));

export function purposeRule(purpose: ConsentPurpose): PurposeRule {
  const rule = BY_PURPOSE.get(purpose);
  if (!rule) throw new RangeError(`"${purpose}" is not a consent purpose this system recognises.`);
  return rule;
}

export interface ConsentRecord {
  purpose: ConsentPurpose;
  granted: boolean;
  grantedAt: Date;
  withdrawnAt: Date | null;
  privacyNoticeVersion: string | null;
}

export type ConsentState = 'GRANTED' | 'WITHDRAWN' | 'REFUSED' | 'NOT_RECORDED';

export interface EffectiveConsent {
  purpose: ConsentPurpose;
  label: string;
  state: ConsentState;
  since: Date | null;
  privacyNoticeVersion: string | null;
  requiredForCare: boolean;
  withdrawable: boolean;
  explanation: string;
}

/**
 * The state of one purpose as at a moment.
 *
 * The most recent record wins, and a withdrawal at any point in that record
 * ends it. NOT_RECORDED is distinct from REFUSED: nobody having asked is a
 * different situation from the patient having said no, and treating them the
 * same would either block care that should proceed or assume agreement that
 * was never given.
 */
export function effectiveConsent(
  records: readonly ConsentRecord[],
  purpose: ConsentPurpose,
  at: Date,
): EffectiveConsent {
  const rule = purposeRule(purpose);

  const relevant = records
    .filter((record) => record.purpose === purpose && record.grantedAt <= at)
    .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());

  const latest = relevant[0];

  if (!latest) {
    return {
      purpose,
      label: rule.label,
      state: 'NOT_RECORDED',
      since: null,
      privacyNoticeVersion: null,
      requiredForCare: rule.requiredForCare,
      withdrawable: rule.withdrawable,
      explanation: rule.explanation,
    };
  }

  const withdrawn = latest.withdrawnAt !== null && latest.withdrawnAt <= at;

  return {
    purpose,
    label: rule.label,
    state: withdrawn ? 'WITHDRAWN' : latest.granted ? 'GRANTED' : 'REFUSED',
    since: withdrawn ? latest.withdrawnAt : latest.grantedAt,
    privacyNoticeVersion: latest.privacyNoticeVersion,
    requiredForCare: rule.requiredForCare,
    withdrawable: rule.withdrawable,
    explanation: rule.explanation,
  };
}

export function consentSummary(records: readonly ConsentRecord[], at: Date): EffectiveConsent[] {
  return CONSENT_PURPOSES.map((rule) => effectiveConsent(records, rule.purpose, at));
}

export interface CareDecision {
  allowed: boolean;
  missing: ConsentPurpose[];
  reason?: string;
}

/**
 * Whether an encounter may be opened.
 *
 * Requires the purposes marked as required for care. This is a real gate: a
 * facility that records treatment without consent has a problem no amount of
 * later documentation fixes.
 */
export function canOpenEncounter(records: readonly ConsentRecord[], at: Date): CareDecision {
  const missing = CONSENT_PURPOSES.filter((rule) => rule.requiredForCare)
    .filter((rule) => effectiveConsent(records, rule.purpose, at).state !== 'GRANTED')
    .map((rule) => rule.purpose);

  if (missing.length === 0) return { allowed: true, missing: [] };

  return {
    allowed: false,
    missing,
    reason:
      `Consent has not been recorded for: ${missing
        .map((purpose) => purposeRule(purpose).label.toLowerCase())
        .join(', ')}. ` +
      'Record it with the patient, or with a proxy where the patient cannot consent personally, before opening the encounter.',
  };
}

export class ConsentError extends Error {
  constructor(
    message: string,
    readonly code: 'not-withdrawable' | 'not-granted' | 'unknown-purpose',
  ) {
    super(message);
    this.name = 'ConsentError';
  }
}

/**
 * Whether this purpose may be withdrawn, refusing clearly if not.
 *
 * A screen that offers to withdraw something it cannot withdraw is worse than
 * one that explains why: the patient believes they have done something they
 * have not.
 */
export function assertWithdrawable(purpose: ConsentPurpose, current: ConsentState): void {
  const rule = purposeRule(purpose);

  if (!rule.withdrawable) {
    throw new ConsentError(
      purpose === 'TREATMENT'
        ? 'Consent to treatment is not withdrawn through this system. A patient declining further care should ' +
          'be seen by a clinician and discharged, so the decision and its reasons are recorded properly.'
        : purpose === 'DATA_STORAGE'
          ? 'Keeping a clinical record is subject to retention requirements, so it is not switched off here. ' +
            'A request to erase records is handled under the data-protection procedure.'
          : `"${rule.label}" is not withdrawable: ${rule.explanation}`,
      'not-withdrawable',
    );
  }

  if (current !== 'GRANTED') {
    throw new ConsentError(
      `"${rule.label}" is currently ${current.toLowerCase().replace('_', ' ')}, so there is nothing to withdraw.`,
      'not-granted',
    );
  }
}

/**
 * Whether an action depending on a consent may proceed.
 *
 * Used before sending an SMS, taking a photograph, or including a patient in a
 * research extract. Computed from the records each time, so a withdrawal five
 * minutes ago is honoured.
 */
export function permits(records: readonly ConsentRecord[], purpose: ConsentPurpose, at: Date): boolean {
  return effectiveConsent(records, purpose, at).state === 'GRANTED';
}
