import { describe, expect, it } from 'vitest';

import {
  DataClassification,
  IllegalPromotionError,
  assertPromotion,
  canPromote,
  isAtLeastAsStrongAs,
  isAuthoritative,
  weakest,
} from './classification.js';

describe('weakest — aggregation takes the weakest input', () => {
  it('keeps ACTUAL when every input is ACTUAL', () => {
    expect(weakest(['ACTUAL', 'ACTUAL', 'ACTUAL'])).toBe('ACTUAL');
  });

  it('demotes a total when a single estimate is mixed in', () => {
    // The rule that stops an estimate laundering itself into a fact by being
    // added to enough real numbers (spec section 82).
    const inputs = Array<DataClassification>(100).fill('ACTUAL');
    inputs.push('ESTIMATED');
    expect(weakest(inputs)).toBe('ESTIMATED');
  });

  it('returns the weakest across the whole ordering', () => {
    expect(weakest(['ACTUAL', 'VERIFIED'])).toBe('VERIFIED');
    expect(weakest(['VERIFIED', 'REPORTED'])).toBe('REPORTED');
    expect(weakest(['ACTUAL', 'PROJECTED', 'ESTIMATED'])).toBe('PROJECTED');
    expect(weakest(['ACTUAL', 'AI_GENERATED'])).toBe('AI_GENERATED');
  });

  it('treats an empty aggregate as ESTIMATED, never ACTUAL', () => {
    // No inputs means no provenance. Callers should render "no data" instead,
    // but it must never claim to be a measured fact.
    expect(weakest([])).toBe('ESTIMATED');
  });

  it('is order-independent', () => {
    expect(weakest(['ESTIMATED', 'ACTUAL'])).toBe(weakest(['ACTUAL', 'ESTIMATED']));
  });
});

describe('promotion rules', () => {
  it('allows REPORTED and ESTIMATED to become VERIFIED', () => {
    expect(canPromote('REPORTED', 'VERIFIED')).toBe(true);
    expect(canPromote('ESTIMATED', 'VERIFIED')).toBe(true);
  });

  it('never promotes an assumption, a projection, or AI output', () => {
    for (const from of ['ASSUMPTION', 'PROJECTED', 'AI_GENERATED'] as DataClassification[]) {
      for (const to of ['ACTUAL', 'VERIFIED', 'REPORTED'] as DataClassification[]) {
        expect(canPromote(from, to)).toBe(false);
        expect(() => assertPromotion(from, to)).toThrow(IllegalPromotionError);
      }
    }
  });

  it('never promotes anything to ACTUAL — only a transaction produces that', () => {
    for (const from of ['VERIFIED', 'REPORTED', 'ESTIMATED'] as DataClassification[]) {
      expect(canPromote(from, 'ACTUAL')).toBe(false);
    }
  });

  it('treats a no-op reclassification as permitted', () => {
    expect(() => assertPromotion('ASSUMPTION', 'ASSUMPTION')).not.toThrow();
  });

  it('explains why an assumption cannot become a fact', () => {
    expect(() => assertPromotion('ASSUMPTION', 'ACTUAL')).toThrow(/never promoted/i);
  });
});

describe('strength ordering', () => {
  it('ranks ACTUAL above every other classification', () => {
    for (const other of ['VERIFIED', 'REPORTED', 'ESTIMATED', 'ASSUMPTION', 'PROJECTED', 'AI_GENERATED'] as DataClassification[]) {
      expect(isAtLeastAsStrongAs('ACTUAL', other)).toBe(true);
      expect(isAtLeastAsStrongAs(other, 'ACTUAL')).toBe(false);
    }
  });
});

describe('authoritative inputs', () => {
  it('bars modelled and generated values from financial, clinical and approval inputs', () => {
    expect(isAuthoritative('ACTUAL')).toBe(true);
    expect(isAuthoritative('VERIFIED')).toBe(true);
    expect(isAuthoritative('REPORTED')).toBe(true);
    expect(isAuthoritative('ESTIMATED')).toBe(true);
    expect(isAuthoritative('ASSUMPTION')).toBe(false);
    expect(isAuthoritative('PROJECTED')).toBe(false);
    expect(isAuthoritative('AI_GENERATED')).toBe(false);
  });
});
