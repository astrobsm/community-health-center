/**
 * Patient identity (doc 13 §2).
 *
 * Two jobs, and the second matters more than it looks:
 *
 *  - Produce a medical record number a clerk can read off a card, say down a
 *    telephone line, and write on a form, where a single mistyped digit is
 *    caught rather than silently attaching a consultation to someone else.
 *
 *  - Notice when a person may already be registered, WITHOUT refusing to
 *    register them. Turning a patient away because their name resembles
 *    somebody else's is not a duplicate-prevention strategy; it is a denial of
 *    care. The match is recorded for review and registration proceeds.
 *
 * Pure: no I/O, no clock.
 */

const SEQUENCE_DIGITS = 6;

/**
 * A facility-scoped MRN with a check digit: IKM-0000017.
 *
 * The last digit is a Luhn check over the sequence, which catches every
 * single-digit error and almost every transposition — the two mistakes people
 * actually make when copying a number by hand.
 */
export function formatMrn(prefix: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('An MRN sequence must be a positive whole number.');
  }

  const body = String(sequence).padStart(SEQUENCE_DIGITS, '0');

  if (body.length > SEQUENCE_DIGITS) {
    throw new RangeError(
      `This facility has passed ${10 ** SEQUENCE_DIGITS - 1} patients and needs a longer MRN format.`,
    );
  }

  return `${normalisePrefix(prefix)}-${body}${luhnCheckDigit(body)}`;
}

export function isValidMrn(mrn: string): boolean {
  const match = /^([A-Z]{2,5})-(\d{6})(\d)$/.exec(mrn.trim().toUpperCase());
  if (!match) return false;

  return luhnCheckDigit(match[2]) === Number(match[3]);
}

/** The prefix a facility's MRNs carry, from its code. */
export function mrnPrefix(facilityCode: string): string {
  return normalisePrefix(facilityCode);
}

function normalisePrefix(value: string): string {
  const letters = value.toUpperCase().replace(/[^A-Z]/g, '');

  if (letters.length < 2) {
    throw new RangeError(`"${value}" does not yield an MRN prefix of at least two letters.`);
  }

  return letters.slice(0, 3);
}

function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let double = true;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);

    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }

    sum += value;
    double = !double;
  }

  return (10 - (sum % 10)) % 10;
}

// -----------------------------------------------------------------------------
// Duplicate detection
// -----------------------------------------------------------------------------

export interface MatchablePatient {
  givenName: string;
  familyName: string;
  dateOfBirth?: string | null;
  /** Any phone number on the record. */
  phones?: readonly string[];
  sex?: string | null;
}

export interface DuplicateMatch {
  score: number;
  reasons: string[];
  /** Above the threshold: worth a human look, never a refusal. */
  isCandidate: boolean;
}

export interface MatchWeights {
  name: number;
  dateOfBirth: number;
  phone: number;
  /** A different recorded sex subtracts, rather than ruling out. */
  sexMismatchPenalty: number;
  threshold: number;
}

/**
 * Weights, configurable per organisation (§89).
 *
 * The defaults are set so that a shared phone number and a similar name is
 * enough to ask the question, but a common name alone is not — in a community
 * where a dozen people share a family name, surfacing all of them on every
 * registration trains clerks to dismiss the warning.
 */
export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  name: 0.5,
  dateOfBirth: 0.3,
  phone: 0.35,
  sexMismatchPenalty: 0.2,
  threshold: 0.6,
};

export function scoreDuplicate(
  a: MatchablePatient,
  b: MatchablePatient,
  weights: MatchWeights = DEFAULT_MATCH_WEIGHTS,
): DuplicateMatch {
  const reasons: string[] = [];
  let score = 0;

  const nameSimilarity = similarity(fullName(a), fullName(b));
  if (nameSimilarity > 0) {
    score += nameSimilarity * weights.name;

    if (nameSimilarity >= 0.9) {
      reasons.push(nameSimilarity === 1 ? 'The names are identical.' : 'The names are nearly identical.');
    } else if (nameSimilarity >= 0.6) {
      reasons.push('The names are similar.');
    }
  }

  if (a.dateOfBirth && b.dateOfBirth && a.dateOfBirth === b.dateOfBirth) {
    score += weights.dateOfBirth;
    reasons.push(`Both records give a date of birth of ${a.dateOfBirth}.`);
  }

  const sharedPhone = (a.phones ?? [])
    .map(normalisePhone)
    .find((phone) => phone.length >= 7 && (b.phones ?? []).map(normalisePhone).includes(phone));

  if (sharedPhone) {
    score += weights.phone;
    reasons.push('Both records carry the same telephone number.');
  }

  if (a.sex && b.sex && a.sex !== 'UNKNOWN' && b.sex !== 'UNKNOWN' && a.sex !== b.sex) {
    score -= weights.sexMismatchPenalty;
    reasons.push('The records give a different sex, which makes a duplicate less likely.');
  }

  const bounded = Math.max(0, Math.min(1, round(score, 4)));

  return { score: bounded, reasons, isCandidate: bounded >= weights.threshold };
}

/**
 * Dice coefficient over character bigrams.
 *
 * Chosen because it handles the errors that actually occur in a register:
 * transposed letters, a dropped vowel, an anglicised spelling. It is not
 * phonetic — "Chukwu" and "Chuku" score well, but a genuinely different name
 * does not creep over the threshold.
 */
export function similarity(a: string, b: string): number {
  const left = normaliseName(a);
  const right = normaliseName(b);

  if (left.length === 0 || right.length === 0) return 0;
  if (left === right) return 1;
  if (left.length === 1 || right.length === 1) return 0;

  const bigrams = new Map<string, number>();

  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2);
    bigrams.set(pair, (bigrams.get(pair) ?? 0) + 1);
  }

  let shared = 0;

  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2);
    const count = bigrams.get(pair) ?? 0;

    if (count > 0) {
      bigrams.set(pair, count - 1);
      shared += 1;
    }
  }

  return round((2 * shared) / (left.length - 1 + right.length - 1), 4);
}

/**
 * Names compared without regard to order.
 *
 * A register may hold "Chukwu Ada" where a clerk types "Ada Chukwu"; they are
 * the same person, and a comparison that says otherwise is useless.
 */
function fullName(patient: MatchablePatient): string {
  return [patient.givenName, patient.familyName]
    .map((part) => normaliseName(part))
    .filter(Boolean)
    .sort()
    .join(' ');
}

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Last nine digits, so 08031234567 and +2348031234567 are the same line. */
function normalisePhone(value: string): string {
  return value.replace(/\D/g, '').slice(-9);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
