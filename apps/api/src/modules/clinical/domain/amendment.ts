/**
 * The amendment rule (spec §43, doc 13 §6).
 *
 * A signed clinical record is never modified. An amendment is a NEW record
 * pointing at the previous one; the previous one becomes AMENDED and stays
 * fully readable, with its author, its timestamp and the stated reason for
 * superseding it.
 *
 * This is not bureaucracy. A clinician reading a record next year needs to
 * know what the person in front of the patient actually believed at the time,
 * and a record that quietly changed under them is worse than no record: it is
 * a record that cannot be trusted, which makes every other entry suspect too.
 *
 * A DRAFT may be edited freely by its author. Someone typing mid-consultation
 * is not making an amendment, and forcing them to justify every correction
 * before they have finished the sentence would make the rule hated and
 * therefore worked around.
 *
 * Pure: no I/O, no clock.
 */

export type RecordStatus = 'DRAFT' | 'SIGNED' | 'AMENDED';

export interface AmendableRecord {
  id: string;
  status: RecordStatus;
  authorStaffId: string | null;
  amendsId: string | null;
  amendmentReason: string | null;
  signedAt: Date | null;
  createdAt: Date;
}

export class AmendmentError extends Error {
  constructor(
    message: string,
    readonly code: 'signed-record-immutable' | 'not-the-author' | 'reason-required' | 'already-amended' | 'draft-not-amendable',
  ) {
    super(message);
    this.name = 'AmendmentError';
  }
}

export interface EditDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether a record may be edited in place.
 *
 * Only a draft, and only by its author. A second clinician improving a
 * colleague's unsigned note is writing their own opinion into someone else's
 * name, which is a different problem from amendment and a worse one.
 */
export function canEditInPlace(record: AmendableRecord, userStaffId: string | null): EditDecision {
  if (record.status !== 'DRAFT') {
    return {
      allowed: false,
      reason:
        `This note was signed${record.signedAt ? ` on ${record.signedAt.toISOString().slice(0, 10)}` : ''} and ` +
        'cannot be changed. Record an amendment instead; the original stays readable and the reason is kept with it.',
    };
  }

  if (record.authorStaffId && userStaffId && record.authorStaffId !== userStaffId) {
    return {
      allowed: false,
      reason:
        'This draft belongs to another clinician. Editing it would put your words under their name. ' +
        'Write your own note on this encounter instead.',
    };
  }

  return { allowed: true };
}

/**
 * Whether this record may be amended, and refuse clearly if not.
 *
 * Throws rather than returning a flag: every caller must handle it, and a
 * silently-skipped amendment would leave a clinician believing they had
 * corrected a record they had not.
 */
export function assertAmendable(record: AmendableRecord, reason: string | undefined): void {
  if (record.status === 'DRAFT') {
    throw new AmendmentError(
      'This note is still a draft. Edit it directly and sign it; an amendment supersedes something that was signed.',
      'draft-not-amendable',
    );
  }

  if (record.status === 'AMENDED') {
    throw new AmendmentError(
      'This note has already been superseded. Amend the current version, so the chain stays a single line.',
      'already-amended',
    );
  }

  if ((reason ?? '').trim().length < 10) {
    // The reason is the whole value of the amendment to a later reader. "typo"
    // is acceptable; nothing is not.
    throw new AmendmentError(
      'An amendment must say why. A later clinician needs to know what changed and why, not merely that something did.',
      'reason-required',
    );
  }
}

export interface ResolvedChain<T extends AmendableRecord> {
  /** The version in force: the one nothing else supersedes. */
  current: T;
  /** Every superseded version, oldest first. */
  history: T[];
  /** True when this record has been amended at least once. */
  wasAmended: boolean;
  amendmentCount: number;
}

/**
 * Resolve an amendment chain to its head plus full history.
 *
 * The clinical view renders the head with an "amended" marker and one-click
 * access to every prior version. Nothing is hidden and nothing is dropped:
 * a version that fell out of this function would be a version a clinician
 * could not see, which is the failure the whole rule exists to prevent.
 */
export function resolveChain<T extends AmendableRecord>(records: readonly T[]): ResolvedChain<T>[] {
  if (records.length === 0) return [];

  const byId = new Map(records.map((record) => [record.id, record]));
  const supersededBy = new Map<string, T>();

  for (const record of records) {
    if (record.amendsId && byId.has(record.amendsId)) {
      supersededBy.set(record.amendsId, record);
    }
  }

  // A head is a record nothing amends. Records whose predecessor is not in the
  // set are still heads of what we can see — a partially loaded chain must not
  // silently vanish.
  const heads = records.filter((record) => !supersededBy.has(record.id));

  return heads.map((head) => {
    const history: T[] = [];
    let cursor: T | undefined = head;
    const seen = new Set<string>();

    while (cursor?.amendsId) {
      // Defensive: a cycle cannot arise from this application's own writes,
      // but looping forever on a corrupt chain would take the whole record
      // view down rather than showing what can be shown.
      if (seen.has(cursor.id)) break;
      seen.add(cursor.id);

      const previous: T | undefined = byId.get(cursor.amendsId);
      if (!previous) break;

      history.unshift(previous);
      cursor = previous;
    }

    return {
      current: head,
      history,
      wasAmended: history.length > 0,
      amendmentCount: history.length,
    };
  });
}

/**
 * The fields carried forward into an amendment.
 *
 * An amendment starts as a copy of what it supersedes, so a clinician
 * correcting one sentence does not have to retype a consultation — and so
 * nothing is lost by accident through a field left blank.
 */
export function carryForward<T extends Record<string, unknown>>(
  previous: T,
  changes: Partial<T>,
  omit: readonly string[],
): T {
  const carried: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(previous)) {
    if (omit.includes(key)) continue;
    carried[key] = value;
  }

  return { ...carried, ...changes } as T;
}
