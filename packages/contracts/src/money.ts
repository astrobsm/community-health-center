import { z } from 'zod';

/**
 * Money — integer minor units only (ADR 0003).
 *
 * Every amount in this system is a whole number of kobo. There is no path
 * through this module by which a float touches money.
 */

export const CURRENCY_MINOR_UNITS: Record<string, number> = {
  NGN: 100,
  USD: 100,
  EUR: 100,
  GBP: 100,
};

export const DEFAULT_CURRENCY = 'NGN';

export const moneySchema = z.object({
  amountMinor: z.union([z.bigint(), z.number().int()]).transform((v) => BigInt(v)),
  currency: z.string().length(3).default(DEFAULT_CURRENCY),
});

export type Money = { amountMinor: bigint; currency: string };

export function money(amountMinor: bigint | number, currency: string = DEFAULT_CURRENCY): Money {
  return { amountMinor: BigInt(amountMinor), currency };
}

export const ZERO = (currency: string = DEFAULT_CURRENCY): Money => money(0n, currency);

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Cannot combine ${a} and ${b}. Cross-currency arithmetic requires an explicit conversion.`);
    this.name = 'CurrencyMismatchError';
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function sum(amounts: readonly Money[], currency: string = DEFAULT_CURRENCY): Money {
  return amounts.reduce<Money>((acc, m) => add(acc, m), ZERO(currency));
}

export function negate(a: Money): Money {
  return { amountMinor: -a.amountMinor, currency: a.currency };
}

export function isZero(a: Money): boolean {
  return a.amountMinor === 0n;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

export const RoundingMode = {
  HALF_UP: 'HALF_UP',
  DOWN: 'DOWN',
  UP: 'UP',
} as const;
export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

/**
 * Multiply by a rate (a tariff percentage, a waterfall share, an inflation
 * factor).
 *
 * The rate arrives as a number because it is genuinely fractional, but the
 * multiplication is carried out in integer arithmetic at a fixed scale, and
 * rounding is EXPLICIT. There is no implicit rounding anywhere in this module:
 * silent rounding is how ledgers drift.
 */
export function multiply(a: Money, rate: number, mode: RoundingMode = RoundingMode.HALF_UP): Money {
  if (!Number.isFinite(rate)) throw new TypeError(`Rate must be finite, received ${rate}`);

  const SCALE = 1_000_000n; // six decimal places, matching numeric(12,6) in the database
  const scaledRate = BigInt(Math.round(rate * 1_000_000));
  const product = a.amountMinor * scaledRate;

  return { amountMinor: divideRounded(product, SCALE, mode), currency: a.currency };
}

function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;

  const negative = numerator < 0n !== denominator < 0n;

  switch (mode) {
    case RoundingMode.DOWN:
      return quotient;
    case RoundingMode.UP:
      return negative ? quotient - 1n : quotient + 1n;
    case RoundingMode.HALF_UP: {
      const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
      const absDenominator = denominator < 0n ? -denominator : denominator;
      if (twiceRemainder >= absDenominator) return negative ? quotient - 1n : quotient + 1n;
      return quotient;
    }
  }
}

/**
 * Split a total across weighted shares so the parts sum EXACTLY to the whole.
 *
 * Uses the largest-remainder method: floor every share, then hand the leftover
 * minor units one at a time to the shares with the largest fractional parts.
 *
 * This matters in the partnership waterfall, where naive rounding of each
 * share independently loses or invents kobo, and the residual step then
 * inherits an error that nobody can explain.
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0)) throw new RangeError('Allocation weights must be non-negative.');

  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight === 0) throw new RangeError('Allocation weights must not sum to zero.');

  const negative = total.amountMinor < 0n;
  const magnitude = negative ? -total.amountMinor : total.amountMinor;

  const SCALE = 1_000_000n;
  const scaledWeights = weights.map((w) => BigInt(Math.round((w / totalWeight) * 1_000_000)));
  const scaledTotal = scaledWeights.reduce((acc, w) => acc + w, 0n);

  const shares = scaledWeights.map((w) => (magnitude * w) / scaledTotal);
  const remainders = scaledWeights.map((w, i) => ({
    index: i,
    remainder: (magnitude * w) % scaledTotal,
  }));

  let allocated = shares.reduce((acc, s) => acc + s, 0n);
  let leftover = magnitude - allocated;

  remainders.sort((a, b) => (b.remainder === a.remainder ? a.index - b.index : b.remainder > a.remainder ? 1 : -1));

  let i = 0;
  while (leftover > 0n) {
    const target = remainders[i % remainders.length];
    if (target) shares[target.index] = (shares[target.index] ?? 0n) + 1n;
    leftover -= 1n;
    i += 1;
  }

  allocated = shares.reduce((acc, s) => acc + s, 0n);
  // Invariant: the parts must equal the whole. If this ever fails the bug is
  // here, not in the caller — fail loudly rather than distribute wrong money.
  if (allocated !== magnitude) {
    throw new Error(`Allocation invariant violated: parts ${allocated} !== total ${magnitude}`);
  }

  return shares.map((s) => ({ amountMinor: negative ? -s : s, currency: total.currency }));
}

/** Clamp to a cap and/or a floor, as waterfall steps require. */
export function clamp(a: Money, opts: { floorMinor?: bigint | null; capMinor?: bigint | null }): Money {
  let value = a.amountMinor;
  if (opts.floorMinor != null && value < opts.floorMinor) value = opts.floorMinor;
  if (opts.capMinor != null && value > opts.capMinor) value = opts.capMinor;
  return { amountMinor: value, currency: a.currency };
}

/** Convert minor units to a major-unit string for display only. Never for arithmetic. */
export function toMajorString(a: Money): string {
  const minorPerMajor = BigInt(CURRENCY_MINOR_UNITS[a.currency] ?? 100);
  const negative = a.amountMinor < 0n;
  const magnitude = negative ? -a.amountMinor : a.amountMinor;
  const major = magnitude / minorPerMajor;
  const minor = magnitude % minorPerMajor;
  const digits = String(minorPerMajor).length - 1;
  return `${negative ? '-' : ''}${major}.${String(minor).padStart(digits, '0')}`;
}

/**
 * Parse a user-entered major-unit amount into minor units.
 *
 * Rejects anything with more decimal places than the currency supports rather
 * than silently rounding a user's input — if someone types ₦10.005, they
 * should be told, not quietly charged ₦10.01.
 */
export function fromMajorString(input: string, currency: string = DEFAULT_CURRENCY): Money {
  const trimmed = input.trim().replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new TypeError(`"${input}" is not a valid amount.`);

  const [, sign, whole, fraction = ''] = match;
  const digits = String(CURRENCY_MINOR_UNITS[currency] ?? 100).length - 1;
  if (fraction.length > digits) {
    throw new RangeError(`${currency} supports ${digits} decimal place(s); "${input}" has ${fraction.length}.`);
  }

  const minorPerMajor = BigInt(CURRENCY_MINOR_UNITS[currency] ?? 100);
  const amount = BigInt(whole ?? '0') * minorPerMajor + BigInt(fraction.padEnd(digits, '0') || '0');
  return { amountMinor: sign === '-' ? -amount : amount, currency };
}

/** Locale-aware display string, e.g. "₦48,200.00". Display only. */
export function formatMoney(a: Money, locale = 'en-NG'): string {
  const minorPerMajor = CURRENCY_MINOR_UNITS[a.currency] ?? 100;
  const digits = String(minorPerMajor).length - 1;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: a.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(a.amountMinor) / minorPerMajor);
}
