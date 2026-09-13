import { describe, expect, it } from 'vitest';

import {
  CurrencyMismatchError,
  RoundingMode,
  add,
  allocate,
  clamp,
  compare,
  formatMoney,
  fromMajorString,
  money,
  multiply,
  subtract,
  sum,
  toMajorString,
} from './money.js';

describe('money arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(add(money(10n), money(20n)).amountMinor).toBe(30n);
    expect(subtract(money(10n), money(25n)).amountMinor).toBe(-15n);
  });

  it('refuses to combine different currencies', () => {
    expect(() => add(money(100n, 'NGN'), money(100n, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('sums an empty list to zero rather than throwing', () => {
    expect(sum([]).amountMinor).toBe(0n);
  });

  it('has no floating-point drift over many additions', () => {
    // The reason this module exists: 0.1 + 0.2 !== 0.3 in IEEE-754, and a
    // ledger that accumulates that error stops balancing.
    const tenKobo = money(10n);
    let total = money(0n);
    for (let i = 0; i < 1_000_000; i += 1) total = add(total, tenKobo);
    expect(total.amountMinor).toBe(10_000_000n);
  });

  it('compares without coercion', () => {
    expect(compare(money(100n), money(200n))).toBe(-1);
    expect(compare(money(200n), money(200n))).toBe(0);
    expect(compare(money(300n), money(200n))).toBe(1);
  });
});

describe('multiply', () => {
  it('applies a rate with explicit half-up rounding', () => {
    // 1000 kobo x 12.5% = 125 exactly
    expect(multiply(money(1000n), 0.125).amountMinor).toBe(125n);
    // 1001 kobo x 12.5% = 125.125 -> 125
    expect(multiply(money(1001n), 0.125).amountMinor).toBe(125n);
    // 1004 kobo x 12.5% = 125.5 -> 126 (half up)
    expect(multiply(money(1004n), 0.125).amountMinor).toBe(126n);
  });

  it('rounds down and up on request', () => {
    expect(multiply(money(1004n), 0.125, RoundingMode.DOWN).amountMinor).toBe(125n);
    expect(multiply(money(1001n), 0.125, RoundingMode.UP).amountMinor).toBe(126n);
  });

  it('rounds negative amounts away from zero on half-up', () => {
    expect(multiply(money(-1004n), 0.125).amountMinor).toBe(-126n);
  });

  it('rejects a non-finite rate rather than producing NaN money', () => {
    expect(() => multiply(money(1000n), Number.NaN)).toThrow(TypeError);
    expect(() => multiply(money(1000n), Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('allocate', () => {
  // This is the function the partnership waterfall depends on. Naive rounding
  // of each share independently loses or invents kobo, and the residual step
  // then inherits an error nobody can explain.

  it('splits evenly when it divides exactly', () => {
    const parts = allocate(money(300n), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([100n, 100n, 100n]);
  });

  it('distributes an indivisible remainder without losing a single kobo', () => {
    const parts = allocate(money(100n), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([34n, 33n, 33n]);
    expect(parts.reduce((a, p) => a + p.amountMinor, 0n)).toBe(100n);
  });

  it('honours uneven weights', () => {
    const parts = allocate(money(1000n), [70, 20, 10]);
    expect(parts.map((p) => p.amountMinor)).toEqual([700n, 200n, 100n]);
  });

  it('always sums exactly to the total, for many awkward splits', () => {
    for (let total = 1n; total <= 500n; total += 1n) {
      for (const weights of [[1, 1, 1], [1, 2, 3], [70, 20, 10], [1, 1, 1, 1, 1, 1, 1]]) {
        const parts = allocate(money(total), weights);
        const recombined = parts.reduce((a, p) => a + p.amountMinor, 0n);
        expect(recombined).toBe(total);
      }
    }
  });

  it('handles negative totals (a reversal) without losing value', () => {
    const parts = allocate(money(-100n), [1, 1, 1]);
    expect(parts.reduce((a, p) => a + p.amountMinor, 0n)).toBe(-100n);
  });

  it('allocates zero to every share when the total is zero', () => {
    const parts = allocate(money(0n), [1, 2, 3]);
    expect(parts.map((p) => p.amountMinor)).toEqual([0n, 0n, 0n]);
  });

  it('rejects weights that sum to zero rather than dividing by zero', () => {
    expect(() => allocate(money(100n), [0, 0])).toThrow(RangeError);
  });

  it('rejects negative weights', () => {
    expect(() => allocate(money(100n), [1, -1])).toThrow(RangeError);
  });
});

describe('clamp', () => {
  it('applies a cap and a floor as waterfall steps require', () => {
    expect(clamp(money(1000n), { capMinor: 800n }).amountMinor).toBe(800n);
    expect(clamp(money(100n), { floorMinor: 500n }).amountMinor).toBe(500n);
    expect(clamp(money(600n), { floorMinor: 500n, capMinor: 800n }).amountMinor).toBe(600n);
  });

  it('lets the cap win when a floor and cap are in tension', () => {
    // A configuration error, but it must behave predictably rather than throw
    // in the middle of a period-end computation.
    expect(clamp(money(1000n), { floorMinor: 900n, capMinor: 500n }).amountMinor).toBe(500n);
  });
});

describe('parsing and display', () => {
  it('round-trips major-unit strings', () => {
    expect(fromMajorString('48200.00').amountMinor).toBe(4_820_000n);
    expect(toMajorString(money(4_820_000n))).toBe('48200.00');
  });

  it('accepts thousands separators and negatives', () => {
    expect(fromMajorString('1,250.50').amountMinor).toBe(125_050n);
    expect(fromMajorString('-10.05').amountMinor).toBe(-1005n);
  });

  it('rejects more decimal places than the currency has, instead of rounding silently', () => {
    // If someone types 10.005 they should be told, not quietly charged 10.01.
    expect(() => fromMajorString('10.005')).toThrow(RangeError);
  });

  it('rejects text that is not an amount', () => {
    expect(() => fromMajorString('ten naira')).toThrow(TypeError);
    expect(() => fromMajorString('')).toThrow(TypeError);
  });

  it('formats for display', () => {
    expect(formatMoney(money(4_820_000n, 'NGN'))).toContain('48,200.00');
  });
});
