/**
 * Critical laboratory results (doc 13 §8, acceptance criterion I).
 *
 * A result outside the critical range is not information sitting in a queue.
 * Somebody has to be told, and somebody has to say they were told — a
 * potassium of 7.2 that nobody acknowledged is a patient who may die of a
 * notification that was delivered to an empty room.
 *
 * So escalation repeats until acknowledged, widening at each step, and never
 * stops on its own. The only thing that stops it is a person saying they have
 * it.
 *
 * Pure: the clock is injected.
 */

export type ResultFlag =
  | 'NORMAL'
  | 'LOW'
  | 'HIGH'
  | 'CRITICAL_LOW'
  | 'CRITICAL_HIGH'
  | 'ABNORMAL'
  /** The analyser could not read the sample. Not a value, and not normal. */
  | 'INDETERMINATE';

export interface ReferenceRange {
  lowNormal: number | null;
  highNormal: number | null;
  lowCritical: number | null;
  highCritical: number | null;
}

/**
 * Where a numeric result sits against its reference range.
 *
 * Critical is checked before normal, because a range configured with an
 * overlapping critical bound must still flag the emergency.
 */
export function flagResult(value: number, range: ReferenceRange): ResultFlag {
  if (range.lowCritical !== null && value <= range.lowCritical) return 'CRITICAL_LOW';
  if (range.highCritical !== null && value >= range.highCritical) return 'CRITICAL_HIGH';
  if (range.lowNormal !== null && value < range.lowNormal) return 'LOW';
  if (range.highNormal !== null && value > range.highNormal) return 'HIGH';

  // With no normal range configured, a value cannot be called normal — saying
  // so would invent a clinical judgement nobody made.
  if (range.lowNormal === null && range.highNormal === null) return 'ABNORMAL';

  return 'NORMAL';
}

export function isCritical(flag: ResultFlag): boolean {
  return flag === 'CRITICAL_LOW' || flag === 'CRITICAL_HIGH';
}

export interface EscalationStep {
  afterMinutes: number;
  notify: string;
  /** Said plainly, because whoever configures this must understand the cost. */
  rationale: string;
}

/**
 * Who is told, and when.
 *
 * Configurable per organisation (§89); these are the defaults. The intervals
 * are short because the clinical window is short, and the last step has no
 * successor — it repeats, because there is nobody left to escalate to and the
 * result still has not been acknowledged.
 */
export const DEFAULT_ESCALATION: readonly EscalationStep[] = [
  {
    afterMinutes: 0,
    notify: 'ORDERING_CLINICIAN',
    rationale: 'The person who ordered the test is the person waiting for it.',
  },
  {
    afterMinutes: 15,
    notify: 'CLINICAL_LEAD',
    rationale: 'A quarter of an hour unacknowledged means the clinician is not at their screen.',
  },
  {
    afterMinutes: 30,
    notify: 'FACILITY_MANAGER',
    rationale: 'Half an hour means nobody clinical has picked it up; it becomes an operational problem.',
  },
  {
    afterMinutes: 60,
    notify: 'ON_CALL',
    rationale: 'An hour unacknowledged is a failure of the whole chain. Repeats until somebody answers.',
  },
];

export interface EscalationState {
  /** When the critical result was verified and escalation began. */
  startedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  /** Steps already delivered, by index into the ladder. */
  deliveredSteps: readonly number[];
}

export interface EscalationDecision {
  /** Steps that are now due and have not been delivered. */
  due: Array<EscalationStep & { index: number }>;
  isAcknowledged: boolean;
  /** Minutes since escalation began. */
  elapsedMinutes: number;
  /** True while this must keep firing. */
  continues: boolean;
  summary: string;
}

/**
 * What to send now.
 *
 * Returns nothing once acknowledged, and keeps returning the final step
 * forever until then. A scheduler calling this every minute will not let a
 * critical result go quiet.
 */
export function nextEscalation(
  state: EscalationState,
  now: Date,
  ladder: readonly EscalationStep[] = DEFAULT_ESCALATION,
): EscalationDecision {
  const elapsed = Math.floor((now.getTime() - state.startedAt.getTime()) / 60_000);

  if (state.acknowledgedAt !== null) {
    return {
      due: [],
      isAcknowledged: true,
      elapsedMinutes: elapsed,
      continues: false,
      summary:
        `Acknowledged by ${state.acknowledgedBy ?? 'a clinician'} after ` +
        `${Math.floor((state.acknowledgedAt.getTime() - state.startedAt.getTime()) / 60_000)} minute(s). ` +
        'Escalation has stopped.',
    };
  }

  const delivered = new Set(state.deliveredSteps);

  const due = ladder
    .map((step, index) => ({ ...step, index }))
    .filter((step) => elapsed >= step.afterMinutes && !delivered.has(step.index));

  const lastIndex = ladder.length - 1;
  const exhausted = delivered.has(lastIndex) && due.length === 0;

  // The final step repeats. There is nobody left to escalate to, and silence
  // is not an acceptable resting state for a critical result.
  if (exhausted && elapsed >= ladder[lastIndex].afterMinutes) {
    due.push({ ...ladder[lastIndex], index: lastIndex });
  }

  return {
    due,
    isAcknowledged: false,
    elapsedMinutes: elapsed,
    continues: true,
    summary:
      `Not acknowledged after ${elapsed} minute(s). ` +
      (due.length > 0
        ? `Notifying: ${due.map((step) => step.notify.toLowerCase().replace(/_/g, ' ')).join(', ')}.`
        : 'The next notification is not yet due.'),
  };
}

export class CriticalResultError extends Error {
  constructor(
    message: string,
    readonly code: 'not-verified' | 'already-acknowledged' | 'reason-required',
  ) {
    super(message);
    this.name = 'CriticalResultError';
  }
}

/**
 * Whether a result may be released to the clinical record.
 *
 * An unverified result is a machine reading, not a clinical fact. Releasing
 * one would put a number in front of a clinician that no laboratory scientist
 * has looked at — and they would, reasonably, act on it.
 */
export function assertReleasable(result: {
  status: string;
  verifiedBy: string | null;
  enteredBy: string | null;
}): void {
  if (result.status !== 'VERIFIED') {
    throw new CriticalResultError(
      'This result has not been verified, so it is not visible for clinical use. ' +
        'A laboratory scientist must check it against the sample and the method before anyone acts on it.',
      'not-verified',
    );
  }

  if (result.verifiedBy && result.enteredBy && result.verifiedBy === result.enteredBy) {
    // Not a hard refusal here — a single-scientist laboratory is a real
    // situation — but the caller is told, so the fact is on the record.
    return;
  }
}

/**
 * Whether the same person may verify a result they entered.
 *
 * In a laboratory with one scientist on shift, insisting on two people means
 * no results are released at all, which is worse. So it is permitted and
 * recorded, rather than forbidden and worked around.
 */
export function selfVerificationNote(enteredBy: string | null, verifiedBy: string | null): string | null {
  if (!enteredBy || !verifiedBy || enteredBy !== verifiedBy) return null;

  return (
    'Entered and verified by the same person. Recorded so that a reviewer can see it; in a laboratory ' +
    'with one scientist on shift this is unavoidable, and refusing it would mean releasing nothing.'
  );
}
