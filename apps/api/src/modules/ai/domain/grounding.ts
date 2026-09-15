/**
 * Grounding validation — the backstop (doc 17 §4 step 7, spec §53).
 *
 * The rule: a generated response may not contain a figure that did not come
 * from the retrieved context. Not one.
 *
 * Everything else in the AI layer is defence in depth — the read-only role, the
 * named query catalogue, the refusal to let a model write SQL. This module is
 * what catches the case those miss: a model that is confidently, plausibly
 * wrong about a number. A wrong figure in a paragraph about a facility's
 * finances is not a style problem; somebody makes a decision on it.
 *
 * So the check is deliberately strict and deliberately dumb. Every run of
 * digits in the output must correspond to a value in the context. A model that
 * wants to say "three" may write it in words; a model that writes "3" must have
 * got the 3 from somewhere.
 *
 * Pure: no I/O, no clock.
 */

export interface NumericToken {
  /** As it appeared in the text. */
  token: string;
  /** Parsed value. */
  value: number;
  /** How many decimal places the author wrote. */
  decimals: number;
  /** Where in the text, for the rejection message. */
  index: number;
}

export interface GroundingFailure {
  token: string;
  value: number;
  reason: string;
}

export interface GroundingResult {
  ok: boolean;
  /** Numeric tokens found in the output. */
  checked: NumericToken[];
  /** Tokens with no counterpart in the context. */
  offending: GroundingFailure[];
  /** Dates in the output that the context does not mention. */
  offendingDates: string[];
  explanation: string;
}

/**
 * ISO dates, taken out before numbers are extracted.
 *
 * Otherwise 2026-09-14 reads as three numbers, one of which is 9, and a model
 * could smuggle any small figure past the check by writing a date.
 */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/**
 * A run of digits, with optional thousands separators, decimals and sign.
 *
 * Currency symbols and per-cent signs sit outside the match, which is what we
 * want: ₦1,250.50 and 1250.5 are the same figure and must match the same
 * context value.
 */
const NUMBER = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;

/** Every number anywhere inside a JSON-ish context, including inside strings. */
export function collectContextNumbers(context: unknown, into = new Set<number>()): Set<number> {
  if (context === null || context === undefined) return into;

  if (typeof context === 'number') {
    if (Number.isFinite(context)) into.add(context);
    return into;
  }

  if (typeof context === 'bigint') {
    into.add(Number(context));
    return into;
  }

  if (typeof context === 'string') {
    // Numbers inside strings count: a figure the context reports as "1,284"
    // is a figure the model may quote.
    for (const match of context.matchAll(NUMBER)) {
      const value = Number(match[0].replace(/,/g, ''));
      if (Number.isFinite(value)) into.add(value);
    }
    return into;
  }

  if (Array.isArray(context)) {
    for (const item of context) collectContextNumbers(item, into);
    return into;
  }

  if (typeof context === 'object') {
    for (const value of Object.values(context as Record<string, unknown>)) {
      collectContextNumbers(value, into);
    }
  }

  return into;
}

export function collectContextDates(context: unknown, into = new Set<string>()): Set<string> {
  if (typeof context === 'string') {
    for (const match of context.matchAll(ISO_DATE)) into.add(match[0]);
    // An ISO timestamp carries its date; the model may quote either.
    const timestamp = /\b(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/.exec(context);
    if (timestamp) into.add(timestamp[1]);
    return into;
  }

  if (context instanceof Date) {
    into.add(context.toISOString().slice(0, 10));
    return into;
  }

  if (Array.isArray(context)) {
    for (const item of context) collectContextDates(item, into);
    return into;
  }

  if (context && typeof context === 'object') {
    for (const value of Object.values(context as Record<string, unknown>)) {
      collectContextDates(value, into);
    }
  }

  return into;
}

export function extractNumbers(text: string): NumericToken[] {
  const withoutDates = text.replace(ISO_DATE, (match) => ' '.repeat(match.length));
  const tokens: NumericToken[] = [];

  for (const match of withoutDates.matchAll(NUMBER)) {
    const raw = match[0];
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;

    const decimalPart = raw.split('.')[1];
    tokens.push({
      token: raw,
      value,
      decimals: decimalPart ? decimalPart.length : 0,
      index: match.index ?? 0,
    });
  }

  return tokens;
}

export interface GroundingOptions {
  /**
   * Values the model may state without them appearing in the context.
   *
   * Empty by default, and it should stay that way. It exists for one case: a
   * caller that supplies its own period bounds to the prompt and knows they
   * are legitimate. Anything put here is a hole in the check, and the caller
   * has to decide it is worth making.
   */
  allowedValues?: readonly number[];
  /**
   * Whether a rounded quotation of a context value is acceptable.
   *
   * On by default: a model writing "1,235" for 1234.56 is quoting, not
   * inventing, and rejecting that would make the check unusable for prose.
   * The rounding must match the precision the model actually wrote.
   */
  allowRounding?: boolean;
}

/**
 * Check a generated response against the context it was given.
 *
 * Returns the offending tokens rather than a bare boolean, because the
 * rejection is logged and somebody has to be able to see what the model tried
 * to say.
 */
export function validateGrounding(
  output: string,
  context: unknown,
  options: GroundingOptions = {},
): GroundingResult {
  const allowRounding = options.allowRounding ?? true;

  const contextNumbers = collectContextNumbers(context);
  for (const allowed of options.allowedValues ?? []) contextNumbers.add(allowed);

  const contextDates = collectContextDates(context);

  const checked = extractNumbers(output);
  const offending: GroundingFailure[] = [];

  for (const token of checked) {
    if (contextNumbers.has(token.value)) continue;

    if (allowRounding && roundsToSomethingIn(token, contextNumbers)) continue;

    offending.push({
      token: token.token,
      value: token.value,
      reason:
        `The figure ${token.token} does not appear in the data the model was given. ` +
        'It may be correct, and it may not; either way nobody can check it, so the response is discarded.',
    });
  }

  const offendingDates = [...new Set(output.match(ISO_DATE) ?? [])].filter(
    (date) => !contextDates.has(date),
  );

  const ok = offending.length === 0 && offendingDates.length === 0;

  return {
    ok,
    checked,
    offending,
    offendingDates,
    explanation: ok
      ? `${checked.length} figure(s) in the response, every one of them present in the retrieved data.`
      : `Rejected. ${offending.length} figure(s) and ${offendingDates.length} date(s) in the response ` +
        'are not in the data the model was given. A response nobody can check is worse than no response.',
  };
}

/** True when the token is a rounded quotation of some context value. */
function roundsToSomethingIn(token: NumericToken, values: ReadonlySet<number>): boolean {
  const factor = 10 ** token.decimals;

  for (const value of values) {
    if (Math.round(value * factor) / factor === token.value) return true;
  }

  return false;
}

/**
 * The refusal a grounded assistant gives when no approved query fits.
 *
 * Kept here, beside the validator, because the two are the same commitment
 * said twice: this layer answers from the records or it does not answer.
 */
export function noApprovedQuery(question: string, alternatives: readonly string[]): string {
  return (
    `I do not have an approved query that answers "${question}".\n\n` +
    (alternatives.length > 0
      ? `Questions I can answer from the records:\n${alternatives.map((item) => `  - ${item}`).join('\n')}\n\n`
      : '') +
    'A new analysis can be added by your administrator. I will not attempt an answer from a query ' +
    'nobody has reviewed.'
  );
}
