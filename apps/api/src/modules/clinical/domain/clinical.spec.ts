import { describe, expect, it } from 'vitest';

import {
  AmendmentError,
  assertAmendable,
  canEditInPlace,
  carryForward,
  resolveChain,
  type AmendableRecord,
} from './amendment';
import {
  assertWithdrawable,
  canOpenEncounter,
  consentSummary,
  ConsentError,
  effectiveConsent,
  permits,
  purposeRule,
  type ConsentRecord,
} from './consent';
import {
  DEFAULT_MATCH_WEIGHTS,
  formatMrn,
  isValidMrn,
  mrnPrefix,
  scoreDuplicate,
  similarity,
  type MatchablePatient,
} from './identity';

// -----------------------------------------------------------------------------
// Identity
// -----------------------------------------------------------------------------

describe('the medical record number', () => {
  it('is readable and facility-scoped', () => {
    expect(formatMrn('CHC-IKEM', 1)).toMatch(/^CHC-\d{7}$/);
    expect(formatMrn('IKM', 1)).toBe('IKM-0000018');
  });

  it('numbers patients in sequence', () => {
    expect(formatMrn('IKM', 2)).not.toBe(formatMrn('IKM', 1));
    expect(formatMrn('IKM', 123456)).toContain('123456');
  });

  it('carries a check digit that catches a mistyped digit', () => {
    // The mistake people actually make copying a number off a card.
    const mrn = formatMrn('IKM', 4321);

    expect(isValidMrn(mrn)).toBe(true);

    for (let index = 4; index < mrn.length; index += 1) {
      const digit = Number(mrn[index]);
      const wrong = mrn.slice(0, index) + ((digit + 1) % 10) + mrn.slice(index + 1);

      expect(isValidMrn(wrong), wrong).toBe(false);
    }
  });

  it('catches a transposition', () => {
    // 0000123 mistyped as 0000213.
    const mrn = formatMrn('IKM', 1234);
    const transposed = `${mrn.slice(0, 4)}${mrn[5]}${mrn[4]}${mrn.slice(6)}`;

    if (mrn[4] !== mrn[5]) {
      expect(isValidMrn(transposed)).toBe(false);
    }
  });

  it('rejects anything that is not one of ours', () => {
    expect(isValidMrn('IKM-123')).toBe(false);
    expect(isValidMrn('0000018')).toBe(false);
    expect(isValidMrn('')).toBe(false);
    expect(isValidMrn('IKM-00000180')).toBe(false);
  });

  it('accepts a number typed in lower case or with stray spaces', () => {
    const mrn = formatMrn('IKM', 77);

    expect(isValidMrn(` ${mrn.toLowerCase()} `)).toBe(true);
  });

  it('derives a prefix from a facility code', () => {
    expect(mrnPrefix('CHC-IKEM')).toBe('CHC');
    expect(mrnPrefix('ik')).toBe('IK');
  });

  it('refuses a sequence that is not a patient number', () => {
    expect(() => formatMrn('IKM', 0)).toThrow(RangeError);
    expect(() => formatMrn('IKM', -1)).toThrow(RangeError);
    expect(() => formatMrn('IKM', 1.5)).toThrow(RangeError);
  });

  it('says so rather than silently truncating when a facility outgrows the format', () => {
    expect(() => formatMrn('IKM', 10_000_000)).toThrow(/longer MRN format/);
  });
});

describe('duplicate detection', () => {
  const ada: MatchablePatient = {
    givenName: 'Ada',
    familyName: 'Chukwu',
    dateOfBirth: '1990-04-12',
    phones: ['08031234567'],
    sex: 'FEMALE',
  };

  it('flags the same person registered twice', () => {
    const match = scoreDuplicate(ada, { ...ada });

    expect(match.isCandidate).toBe(true);
    expect(match.score).toBeGreaterThan(0.9);
  });

  it('flags a near-miss spelling with the same date of birth', () => {
    const match = scoreDuplicate(ada, { ...ada, familyName: 'Chuku', phones: [] });

    expect(match.isCandidate).toBe(true);
    expect(match.reasons.join(' ')).toContain('1990-04-12');
  });

  it('matches names given in either order', () => {
    // A register holding "Chukwu Ada" and a clerk typing "Ada Chukwu" are the
    // same person, and a comparison that says otherwise is useless.
    const reversed = scoreDuplicate(ada, { ...ada, givenName: 'Chukwu', familyName: 'Ada' });

    expect(reversed.score).toBe(scoreDuplicate(ada, ada).score);
  });

  it('recognises the same telephone line written differently', () => {
    const match = scoreDuplicate(ada, {
      givenName: 'Adaeze',
      familyName: 'Chukwu',
      phones: ['+234 803 123 4567'],
    });

    expect(match.reasons.join(' ')).toContain('same telephone number');
  });

  it('does not flag a common family name on its own', () => {
    // In a community where a dozen people share a name, surfacing all of them
    // on every registration trains clerks to dismiss the warning.
    const match = scoreDuplicate(ada, {
      givenName: 'Emeka',
      familyName: 'Chukwu',
      dateOfBirth: '1975-01-01',
      phones: ['08099999999'],
    });

    expect(match.isCandidate).toBe(false);
  });

  it('treats a different recorded sex as evidence against, not as a rule', () => {
    // Sex is sometimes recorded wrongly. It lowers the score; it does not veto.
    const withSex = scoreDuplicate(ada, { ...ada, sex: 'MALE' });
    const without = scoreDuplicate(ada, { ...ada, sex: 'FEMALE' });

    expect(withSex.score).toBeLessThan(without.score);
    expect(withSex.reasons.join(' ')).toContain('less likely');
  });

  it('ignores an unknown sex rather than penalising it', () => {
    const match = scoreDuplicate(ada, { ...ada, sex: 'UNKNOWN' });

    expect(match.reasons.join(' ')).not.toContain('less likely');
  });

  it('never scores outside 0 to 1', () => {
    const extreme = scoreDuplicate(
      { givenName: 'A', familyName: 'B', sex: 'MALE' },
      { givenName: 'Z', familyName: 'Y', sex: 'FEMALE' },
    );

    expect(extreme.score).toBeGreaterThanOrEqual(0);
    expect(extreme.score).toBeLessThanOrEqual(1);
  });

  it('gives a reason for every match it flags', () => {
    // A warning with no stated grounds is one a clerk cannot act on.
    const match = scoreDuplicate(ada, { ...ada, familyName: 'Chuku' });

    expect(match.reasons.length).toBeGreaterThan(0);
  });

  it('takes its weights from configuration', () => {
    const strict = scoreDuplicate(ada, { ...ada, familyName: 'Chuku', phones: [] }, {
      ...DEFAULT_MATCH_WEIGHTS,
      threshold: 0.95,
    });

    expect(strict.isCandidate).toBe(false);
  });

  it('is symmetric', () => {
    const other: MatchablePatient = { givenName: 'Adaeze', familyName: 'Chukwu', dateOfBirth: '1990-04-12' };

    expect(scoreDuplicate(ada, other).score).toBe(scoreDuplicate(other, ada).score);
  });
});

describe('name similarity', () => {
  it('is 1 for identical names, ignoring case and accents', () => {
    expect(similarity('Chukwu', 'chukwu')).toBe(1);
    expect(similarity('Ngozi', 'Ngọzi')).toBe(1);
  });

  it('scores a dropped letter well above a different name', () => {
    // The absolute figure matters less than the gap: a dropped letter must
    // clear the threshold once a date of birth agrees, and a different name
    // must not, however common the surname.
    const dropped = similarity('Chukwu', 'Chuku');

    expect(dropped).toBeGreaterThan(0.6);
    expect(dropped).toBeGreaterThan(similarity('Chukwu', 'Adeyemi') * 2);
  });

  it('scores a different name low', () => {
    expect(similarity('Chukwu', 'Adeyemi')).toBeLessThan(0.3);
  });

  it('is 0 when either side is empty', () => {
    expect(similarity('', 'Chukwu')).toBe(0);
    expect(similarity('  ', 'Chukwu')).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Amendment
// -----------------------------------------------------------------------------

const note = (overrides: Partial<AmendableRecord> = {}): AmendableRecord => ({
  id: 'note-1',
  status: 'DRAFT',
  authorStaffId: 'staff-1',
  amendsId: null,
  amendmentReason: null,
  signedAt: null,
  createdAt: new Date('2026-09-01T09:00:00.000Z'),
  ...overrides,
});

describe('editing a clinical note', () => {
  it('lets the author edit their own draft', () => {
    // Someone typing mid-consultation is not making an amendment.
    expect(canEditInPlace(note(), 'staff-1').allowed).toBe(true);
  });

  it('refuses another clinician editing that draft', () => {
    const decision = canEditInPlace(note(), 'staff-2');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('under their name');
  });

  it('refuses any edit once it is signed', () => {
    const decision = canEditInPlace(
      note({ status: 'SIGNED', signedAt: new Date('2026-09-01T10:00:00.000Z') }),
      'staff-1',
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('cannot be changed');
    expect(decision.reason).toContain('2026-09-01');
  });

  it('refuses an edit to a superseded version too', () => {
    expect(canEditInPlace(note({ status: 'AMENDED' }), 'staff-1').allowed).toBe(false);
  });
});

describe('amending a clinical note', () => {
  const signed = note({ status: 'SIGNED', signedAt: new Date('2026-09-01T10:00:00.000Z') });

  it('is allowed on a signed note with a reason', () => {
    expect(() => assertAmendable(signed, 'The allergy was recorded against the wrong drug.')).not.toThrow();
  });

  it('requires a reason', () => {
    // The reason is the whole value of the amendment to a later reader.
    expect(() => assertAmendable(signed, undefined)).toThrow(AmendmentError);
    expect(() => assertAmendable(signed, 'oops')).toThrow(/must say why/);
  });

  it('refuses to amend a draft', () => {
    expect(() => assertAmendable(note(), 'A perfectly good reason here.')).toThrow(/still a draft/);
  });

  it('refuses to amend a version that has already been superseded', () => {
    // Amending mid-chain would fork the history into two truths.
    expect(() => assertAmendable(note({ status: 'AMENDED' }), 'A perfectly good reason here.')).toThrow(
      /already been superseded/,
    );
  });

  it('gives each refusal a code a caller can act on', () => {
    try {
      assertAmendable(signed, '');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AmendmentError).code).toBe('reason-required');
    }
  });
});

describe('resolving an amendment chain', () => {
  const v1 = note({ id: 'v1', status: 'AMENDED', signedAt: new Date('2026-09-01T10:00:00.000Z') });
  const v2 = note({
    id: 'v2',
    status: 'AMENDED',
    amendsId: 'v1',
    amendmentReason: 'Corrected the drug name.',
    createdAt: new Date('2026-09-02T09:00:00.000Z'),
  });
  const v3 = note({
    id: 'v3',
    status: 'SIGNED',
    amendsId: 'v2',
    amendmentReason: 'Added the dose.',
    createdAt: new Date('2026-09-03T09:00:00.000Z'),
  });

  it('finds the version in force', () => {
    const [chain] = resolveChain([v1, v2, v3]);

    expect(chain.current.id).toBe('v3');
  });

  it('preserves every prior version, oldest first', () => {
    // The acceptance criterion: an amendment preserves every prior version.
    const [chain] = resolveChain([v3, v1, v2]);

    expect(chain.history.map((record) => record.id)).toEqual(['v1', 'v2']);
    expect(chain.amendmentCount).toBe(2);
    expect(chain.wasAmended).toBe(true);
  });

  it('keeps each version reason with it', () => {
    const [chain] = resolveChain([v1, v2, v3]);

    expect(chain.current.amendmentReason).toBe('Added the dose.');
    expect(chain.history[1].amendmentReason).toBe('Corrected the drug name.');
  });

  it('reports an unamended note as unamended', () => {
    const [chain] = resolveChain([note({ status: 'SIGNED' })]);

    expect(chain.wasAmended).toBe(false);
    expect(chain.history).toEqual([]);
  });

  it('handles several independent notes on one encounter', () => {
    const other = note({ id: 'other', status: 'SIGNED' });
    const chains = resolveChain([v1, v2, v3, other]);

    expect(chains).toHaveLength(2);
    expect(chains.map((chain) => chain.current.id).sort()).toEqual(['other', 'v3']);
  });

  it('still shows what it can when an earlier version is not loaded', () => {
    // A partially loaded chain must not make a note vanish from the record.
    const [chain] = resolveChain([v3]);

    expect(chain.current.id).toBe('v3');
    expect(chain.history).toEqual([]);
  });

  it('returns nothing for nothing', () => {
    expect(resolveChain([])).toEqual([]);
  });

  it('does not loop forever on a corrupt chain', () => {
    // Impossible from this application's own writes; taking the whole record
    // view down if it ever happened would not be.
    const a = note({ id: 'a', amendsId: 'b' });
    const b = note({ id: 'b', amendsId: 'a' });

    expect(() => resolveChain([a, b])).not.toThrow();
  });
});

describe('carrying content forward into an amendment', () => {
  it('copies what is not being changed', () => {
    // A clinician correcting one sentence should not have to retype a
    // consultation, and nothing should be lost by a field left blank.
    const previous = { assessment: 'Malaria', plan: 'ACT', allergies: 'Penicillin' };

    const next = carryForward(previous, { assessment: 'Typhoid' }, []);

    expect(next).toEqual({ assessment: 'Typhoid', plan: 'ACT', allergies: 'Penicillin' });
  });

  it('omits the fields that must not be copied', () => {
    const previous = { id: 'v1', status: 'SIGNED', assessment: 'Malaria' };

    expect(carryForward(previous, {}, ['id', 'status'])).toEqual({ assessment: 'Malaria' });
  });
});

// -----------------------------------------------------------------------------
// Consent
// -----------------------------------------------------------------------------

const NOW = new Date('2026-09-14T10:00:00.000Z');

const consent = (overrides: Partial<ConsentRecord> = {}): ConsentRecord => ({
  purpose: 'TREATMENT',
  granted: true,
  grantedAt: new Date('2026-09-01T09:00:00.000Z'),
  withdrawnAt: null,
  privacyNoticeVersion: 'v1',
  ...overrides,
});

describe('effective consent', () => {
  it('is granted when it was granted', () => {
    expect(effectiveConsent([consent()], 'TREATMENT', NOW).state).toBe('GRANTED');
  });

  it('distinguishes never asked from refused', () => {
    // Nobody having asked is a different situation from the patient saying no.
    expect(effectiveConsent([], 'SMS_CONTACT', NOW).state).toBe('NOT_RECORDED');
    expect(
      effectiveConsent([consent({ purpose: 'SMS_CONTACT', granted: false })], 'SMS_CONTACT', NOW).state,
    ).toBe('REFUSED');
  });

  it('takes effect the moment it is withdrawn', () => {
    // The acceptance criterion. Computed on read, never cached, so there is no
    // window in which a withdrawn consent still permits anything.
    const withdrawn = consent({
      purpose: 'SMS_CONTACT',
      withdrawnAt: new Date('2026-09-14T09:59:59.000Z'),
    });

    expect(effectiveConsent([withdrawn], 'SMS_CONTACT', NOW).state).toBe('WITHDRAWN');
    expect(permits([withdrawn], 'SMS_CONTACT', NOW)).toBe(false);
  });

  it('was still in force a moment before the withdrawal', () => {
    const withdrawn = consent({
      purpose: 'SMS_CONTACT',
      withdrawnAt: new Date('2026-09-14T09:59:59.000Z'),
    });

    expect(effectiveConsent([withdrawn], 'SMS_CONTACT', new Date('2026-09-14T09:00:00.000Z')).state).toBe(
      'GRANTED',
    );
  });

  it('honours the most recent record', () => {
    const records = [
      consent({ purpose: 'PHOTOGRAPH', granted: false, grantedAt: new Date('2026-09-01T09:00:00.000Z') }),
      consent({ purpose: 'PHOTOGRAPH', granted: true, grantedAt: new Date('2026-09-10T09:00:00.000Z') }),
    ];

    expect(effectiveConsent(records, 'PHOTOGRAPH', NOW).state).toBe('GRANTED');
  });

  it('lets a patient grant again after withdrawing', () => {
    const records = [
      consent({ purpose: 'SMS_CONTACT', grantedAt: new Date('2026-09-01T09:00:00.000Z'), withdrawnAt: new Date('2026-09-02T09:00:00.000Z') }),
      consent({ purpose: 'SMS_CONTACT', grantedAt: new Date('2026-09-10T09:00:00.000Z') }),
    ];

    expect(effectiveConsent(records, 'SMS_CONTACT', NOW).state).toBe('GRANTED');
  });

  it('ignores a record dated after the moment being asked about', () => {
    const future = consent({ purpose: 'SMS_CONTACT', grantedAt: new Date('2026-12-01T09:00:00.000Z') });

    expect(effectiveConsent([future], 'SMS_CONTACT', NOW).state).toBe('NOT_RECORDED');
  });

  it('records which privacy notice the patient actually saw', () => {
    // When the notice changes, prior consents stay valid against what was shown.
    expect(effectiveConsent([consent({ privacyNoticeVersion: 'v3' })], 'TREATMENT', NOW).privacyNoticeVersion).toBe(
      'v3',
    );
  });

  it('summarises every purpose, including the ones never asked about', () => {
    const summary = consentSummary([consent()], NOW);

    expect(summary).toHaveLength(6);
    expect(summary.filter((entry) => entry.state === 'NOT_RECORDED')).toHaveLength(5);
  });
});

describe('opening an encounter', () => {
  const required: ConsentRecord[] = [consent({ purpose: 'TREATMENT' }), consent({ purpose: 'DATA_STORAGE' })];

  it('is allowed with the consents care requires', () => {
    expect(canOpenEncounter(required, NOW).allowed).toBe(true);
  });

  it('is refused without them, naming what is missing', () => {
    const decision = canOpenEncounter([], NOW);

    expect(decision.allowed).toBe(false);
    expect(decision.missing).toEqual(['TREATMENT', 'DATA_STORAGE']);
    expect(decision.reason).toContain('treatment');
    expect(decision.reason).toContain('proxy');
  });

  it('does not require the optional consents', () => {
    // A patient who declines text messages is still a patient.
    expect(canOpenEncounter(required, NOW).allowed).toBe(true);
  });
});

describe('withdrawing consent', () => {
  it('is allowed for the purposes that are genuinely optional', () => {
    for (const purpose of ['SMS_CONTACT', 'RESEARCH_AGGREGATE', 'PHOTOGRAPH'] as const) {
      expect(() => assertWithdrawable(purpose, 'GRANTED'), purpose).not.toThrow();
    }
  });

  it('refuses treatment, and says what to do instead', () => {
    // A screen offering to withdraw something it cannot withdraw leaves the
    // patient believing they have done something they have not.
    try {
      assertWithdrawable('TREATMENT', 'GRANTED');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConsentError).code).toBe('not-withdrawable');
      expect((error as Error).message).toContain('discharged');
    }
  });

  it('refuses record keeping, and points at the data-protection procedure', () => {
    expect(() => assertWithdrawable('DATA_STORAGE', 'GRANTED')).toThrow(/retention requirements/);
  });

  it('refuses to withdraw something that was never granted', () => {
    expect(() => assertWithdrawable('SMS_CONTACT', 'NOT_RECORDED')).toThrow(/nothing to withdraw/);
    expect(() => assertWithdrawable('SMS_CONTACT', 'WITHDRAWN')).toThrow(/nothing to withdraw/);
  });

  it('explains every purpose in words a patient could be read', () => {
    for (const rule of ['TREATMENT', 'DATA_STORAGE', 'SMS_CONTACT', 'RESEARCH_AGGREGATE', 'PHOTOGRAPH', 'GOVERNMENT_AGGREGATE_REPORTING'] as const) {
      const explanation = purposeRule(rule).explanation;

      expect(explanation.length, rule).toBeGreaterThan(20);
      expect(explanation, rule).not.toMatch(/consent to the processing of/i);
    }
  });

  it('never identifies a patient in government statistics', () => {
    expect(purposeRule('GOVERNMENT_AGGREGATE_REPORTING').explanation).toContain('never identify you');
  });
});
