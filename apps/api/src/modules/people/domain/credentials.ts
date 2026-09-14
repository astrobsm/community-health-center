/**
 * Credentials and the right to practise (spec §24).
 *
 * A lapsed licence is not an administrative untidiness. It is a clinician who
 * may not lawfully see patients, and a facility that lets one keep working has
 * a problem that reaches the patient, the regulator and the insurer at once.
 *
 * So status is DERIVED from the expiry date on every read. A credential does
 * not lapse because a nightly job ran; it lapses because the date passed, and
 * the job exists only to tell somebody (§10).
 *
 * Pure: the clock is injected.
 */

export type CredentialStatus = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED' | 'UNVERIFIED';

export interface Credential {
  id: string;
  credentialType: string;
  credentialNumber: string | null;
  issuingBody: string | null;
  expiresOn: Date | null;
  /** The stored status. A suspension is a decision and outranks the calendar. */
  status: CredentialStatus;
  verifiedAt: Date | null;
}

export interface CredentialAssessment {
  id: string;
  credentialType: string;
  storedStatus: CredentialStatus;
  effectiveStatus: CredentialStatus;
  expiresOn: Date | null;
  daysToExpiry: number | null;
  /** True when this credential does not permit practice today. */
  blocksPractice: boolean;
  message: string;
}

const DEFAULT_WARNING_DAYS = 60;

export function assessCredential(
  credential: Credential,
  now: Date,
  warningDays = DEFAULT_WARNING_DAYS,
): CredentialAssessment {
  const days =
    credential.expiresOn === null
      ? null
      : Math.ceil((credential.expiresOn.getTime() - now.getTime()) / 86_400_000);

  // A suspension is somebody's decision about this person. The calendar does
  // not overturn it, and neither does a renewal.
  if (credential.status === 'SUSPENDED') {
    return {
      id: credential.id,
      credentialType: credential.credentialType,
      storedStatus: credential.status,
      effectiveStatus: 'SUSPENDED',
      expiresOn: credential.expiresOn,
      daysToExpiry: days,
      blocksPractice: true,
      message: `${credential.credentialType} is suspended. This person may not practise under it.`,
    };
  }

  // Expiry is checked before verification, because the two answer different
  // questions and the calendar's answer is the one that stops somebody
  // practising. A licence that ran out in March is expired whether or not
  // anybody ever checked it against the register.
  if (days !== null && days <= 0) {
    return {
      id: credential.id,
      credentialType: credential.credentialType,
      storedStatus: credential.status,
      effectiveStatus: 'EXPIRED',
      expiresOn: credential.expiresOn,
      daysToExpiry: days,
      blocksPractice: true,
      message:
        `${credential.credentialType} expired on ${credential.expiresOn!.toISOString().slice(0, 10)}. ` +
        'This person may not practise under it until it is renewed and the renewal is verified.',
    };
  }

  if (credential.verifiedAt === null) {
    // Unverified is not invalid — a new starter's licence may be genuine and
    // simply unchecked — but it is not evidence either, and saying so is the
    // only way it gets checked.
    return {
      id: credential.id,
      credentialType: credential.credentialType,
      storedStatus: credential.status,
      effectiveStatus: 'UNVERIFIED',
      expiresOn: credential.expiresOn,
      daysToExpiry: days,
      blocksPractice: false,
      message:
        `${credential.credentialType} has not been verified against the issuing body. ` +
        'It is recorded but it is not yet evidence.',
    };
  }

  if (days === null) {
    return {
      id: credential.id,
      credentialType: credential.credentialType,
      storedStatus: credential.status,
      effectiveStatus: 'VALID',
      expiresOn: null,
      daysToExpiry: null,
      blocksPractice: false,
      message: `${credential.credentialType} has no expiry date recorded.`,
    };
  }

  if (days <= warningDays) {
    return {
      id: credential.id,
      credentialType: credential.credentialType,
      storedStatus: credential.status,
      effectiveStatus: 'EXPIRING',
      expiresOn: credential.expiresOn,
      daysToExpiry: days,
      blocksPractice: false,
      message:
        `${credential.credentialType} expires in ${days} day(s), on ` +
        `${credential.expiresOn!.toISOString().slice(0, 10)}. Renewal takes time; start now.`,
    };
  }

  return {
    id: credential.id,
    credentialType: credential.credentialType,
    storedStatus: credential.status,
    effectiveStatus: 'VALID',
    expiresOn: credential.expiresOn,
    daysToExpiry: days,
    blocksPractice: false,
    message: `${credential.credentialType} is valid until ${credential.expiresOn!.toISOString().slice(0, 10)}.`,
  };
}

export interface PracticeDecision {
  mayPractise: boolean;
  blocking: CredentialAssessment[];
  expiring: CredentialAssessment[];
  summary: string;
}

/**
 * Whether this person may see patients today.
 *
 * A member of staff with no credentials recorded at all is NOT blocked here:
 * a cleaner and a records clerk need none, and blocking everybody without a
 * licence would stop the facility working. What is blocked is somebody
 * holding a credential that has lapsed or been suspended — a specific,
 * checkable fact.
 */
export function assessPractice(
  credentials: readonly Credential[],
  now: Date,
  warningDays = DEFAULT_WARNING_DAYS,
): PracticeDecision {
  const assessments = credentials.map((credential) => assessCredential(credential, now, warningDays));

  const blocking = assessments.filter((assessment) => assessment.blocksPractice);
  const expiring = assessments.filter((assessment) => assessment.effectiveStatus === 'EXPIRING');

  return {
    mayPractise: blocking.length === 0,
    blocking,
    expiring,
    summary:
      blocking.length > 0
        ? `Practice is blocked: ${blocking.map((item) => item.message).join(' ')}`
        : expiring.length > 0
          ? `Practice is permitted. ${expiring.length} credential(s) need renewing soon: ` +
            `${expiring.map((item) => `${item.credentialType} in ${item.daysToExpiry} day(s)`).join(', ')}.`
          : credentials.length === 0
            ? 'No credentials are recorded for this person. Nothing blocks them, and nothing evidences them either.'
            : 'All recorded credentials are current.',
  };
}
