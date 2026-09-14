import { describe, expect, it } from 'vitest';

import {
  ACCOUNTS,
  balanced,
  postCharge,
  postPatientPayment,
  postStockIssue,
  postStockWriteOff,
  reconcileCash,
  reverse,
  UnbalancedEntryError,
} from './posting';

// -----------------------------------------------------------------------------
// Posting
// -----------------------------------------------------------------------------

describe('a charge becomes revenue (criterion G)', () => {
  const entry = postCharge({
    chargeId: 'c1',
    description: 'Consultation',
    amountMinor: 200_000,
    kind: 'CONSULTATION',
  });

  it('debits the patient and credits revenue', () => {
    expect(entry.lines).toEqual([
      expect.objectContaining({ accountCode: ACCOUNTS.PATIENT_RECEIVABLES, debitMinor: 200_000 }),
      expect.objectContaining({ accountCode: ACCOUNTS.CONSULTATION_REVENUE, creditMinor: 200_000 }),
    ]);
  });

  it('posts when the charge is raised, not when it is paid', () => {
    // A ledger that waits for payment cannot tell a good month from a month
    // nobody paid for.
    expect(entry.lines.some((line) => line.accountCode === ACCOUNTS.CASH)).toBe(false);
  });

  it('routes each kind of charge to its own revenue account', () => {
    expect(postCharge({ chargeId: 'c', description: 'x', amountMinor: 100, kind: 'PHARMACY' }).lines[1].accountCode).toBe(
      ACCOUNTS.PHARMACY_REVENUE,
    );
    expect(postCharge({ chargeId: 'c', description: 'x', amountMinor: 100, kind: 'LABORATORY' }).lines[1].accountCode).toBe(
      ACCOUNTS.LABORATORY_REVENUE,
    );
  });

  it('falls back to other clinical revenue rather than failing', () => {
    expect(
      postCharge({ chargeId: 'c', description: 'x', amountMinor: 100, kind: 'SOMETHING_NEW' }).lines[1].accountCode,
    ).toBe(ACCOUNTS.OTHER_CLINICAL_REVENUE);
  });
});

describe('a payment settles what was owed', () => {
  it('does not recognise the revenue twice', () => {
    const entry = postPatientPayment({
      paymentId: 'p1',
      amountMinor: 200_000,
      method: 'CASH',
      description: 'Consultation',
    });

    expect(entry.lines[0].accountCode).toBe(ACCOUNTS.CASH);
    expect(entry.lines[1].accountCode).toBe(ACCOUNTS.PATIENT_RECEIVABLES);
    expect(entry.lines.some((line) => line.accountCode.startsWith('4'))).toBe(false);
  });

  it('puts cash in the drawer and everything else in the bank', () => {
    expect(
      postPatientPayment({ paymentId: 'p', amountMinor: 1, method: 'BANK_TRANSFER', description: 'x' }).lines[0]
        .accountCode,
    ).toBe(ACCOUNTS.BANK);
  });
});

describe('stock leaving the shelf (criterion H)', () => {
  const entry = postStockIssue({
    sourceType: 'dispensing',
    sourceId: 'd1',
    description: 'Artemether-lumefantrine x 24',
    costMinor: 48_000,
    itemKind: 'MEDICINE',
  });

  it('moves the cost out of inventory', () => {
    expect(entry.lines[0]).toMatchObject({ accountCode: ACCOUNTS.COST_OF_MEDICINES, debitMinor: 48_000 });
    expect(entry.lines[1]).toMatchObject({ accountCode: ACCOUNTS.INVENTORY, creditMinor: 48_000 });
  });

  it('is a separate entry from the revenue, never netted against it', () => {
    // A facility needs to know both what it sold and what it cost. One net
    // figure answers neither question.
    expect(entry.lines.some((line) => line.accountCode.startsWith('4'))).toBe(false);
  });

  it('routes reagents to their own cost account', () => {
    expect(
      postStockIssue({ sourceType: 'lab_consumption', sourceId: 'l1', description: 'x', costMinor: 1, itemKind: 'REAGENT' })
        .lines[0].accountCode,
    ).toBe(ACCOUNTS.COST_OF_REAGENTS);
  });
});

describe('writing stock off', () => {
  it('makes the loss visible rather than shrinking inventory quietly', () => {
    const entry = postStockWriteOff({
      sourceId: 'w1',
      description: 'Amoxicillin B-114',
      costMinor: 12_000,
      reasonCode: 'EXPIRY',
    });

    expect(entry.lines[0].accountCode).toBe(ACCOUNTS.STOCK_WRITE_OFF);
    expect(entry.description).toContain('EXPIRY');
  });
});

describe('every entry balances', () => {
  it('refuses one that does not', () => {
    expect(() =>
      balanced({
        description: 'Wrong',
        sourceType: 'test',
        sourceId: 't',
        lines: [
          { accountCode: '1110', debitMinor: 100, creditMinor: 0, description: 'a' },
          { accountCode: '4110', debitMinor: 0, creditMinor: 90, description: 'b' },
        ],
      }),
    ).toThrow(UnbalancedEntryError);
  });

  it('refuses a line that is both a debit and a credit', () => {
    expect(() =>
      balanced({
        description: 'Both',
        sourceType: 'test',
        sourceId: 't',
        lines: [
          { accountCode: '1110', debitMinor: 100, creditMinor: 100, description: 'a' },
          { accountCode: '4110', debitMinor: 100, creditMinor: 100, description: 'b' },
        ],
      }),
    ).toThrow(/both a debit and a credit/);
  });

  it('refuses a negative amount', () => {
    // A negative debit is a credit in disguise, and it makes every total that
    // reads one column wrong.
    expect(() =>
      balanced({
        description: 'Negative',
        sourceType: 'test',
        sourceId: 't',
        lines: [
          { accountCode: '1110', debitMinor: -100, creditMinor: 0, description: 'a' },
          { accountCode: '4110', debitMinor: 0, creditMinor: -100, description: 'b' },
        ],
      }),
    ).toThrow(/negative amount/);
  });

  it('refuses an entry with a single line', () => {
    expect(() =>
      balanced({
        description: 'Lonely',
        sourceType: 'test',
        sourceId: 't',
        lines: [{ accountCode: '1110', debitMinor: 0, creditMinor: 0, description: 'a' }],
      }),
    ).toThrow(/not an entry/);
  });
});

describe('reversal (spec section 44)', () => {
  const original = postCharge({ chargeId: 'c1', description: 'Consultation', amountMinor: 200_000, kind: 'CONSULTATION' });

  it('swaps the sides rather than negating them', () => {
    const reversal = reverse(original, 'Charged to the wrong patient.', 'c1-rev');

    expect(reversal.lines[0]).toMatchObject({ accountCode: ACCOUNTS.PATIENT_RECEIVABLES, creditMinor: 200_000, debitMinor: 0 });
    expect(reversal.lines[1]).toMatchObject({ accountCode: ACCOUNTS.CONSULTATION_REVENUE, debitMinor: 200_000 });
  });

  it('balances', () => {
    expect(() => reverse(original, 'Charged to the wrong patient.', 'x')).not.toThrow();
  });

  it('requires a reason', () => {
    expect(() => reverse(original, 'oops', 'x')).toThrow(/must say why/);
  });

  it('carries the reason into the description', () => {
    expect(reverse(original, 'Charged to the wrong patient.', 'x').description).toContain('wrong patient');
  });
});

describe('the daily cash identity', () => {
  it('balances when the drawer matches the day', () => {
    const result = reconcileCash({
      openingMinor: 500_000,
      receiptsMinor: 1_200_000,
      paymentsOutMinor: 150_000,
      bankedMinor: 1_000_000,
      countedClosingMinor: 550_000,
    });

    expect(result.expectedClosingMinor).toBe(550_000);
    expect(result.balances).toBe(true);
    expect(result.varianceMinor).toBe(0);
  });

  it('reports a shortage and says what to do', () => {
    const result = reconcileCash({
      openingMinor: 500_000,
      receiptsMinor: 1_200_000,
      paymentsOutMinor: 150_000,
      bankedMinor: 1_000_000,
      countedClosingMinor: 530_000,
    });

    expect(result.varianceMinor).toBe(-20_000);
    expect(result.summary).toContain('short');
    expect(result.summary).toContain('not written off silently');
  });

  it('reports a surplus as a problem too', () => {
    // More money than the day accounts for means a receipt was not recorded.
    const result = reconcileCash({
      openingMinor: 0,
      receiptsMinor: 100_000,
      paymentsOutMinor: 0,
      bankedMinor: 0,
      countedClosingMinor: 120_000,
    });

    expect(result.varianceMinor).toBe(20_000);
    expect(result.summary).toContain('more in the drawer');
  });
});

