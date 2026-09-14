import { describe, expect, it } from 'vitest';

import { deriveStatus, reconcile, selectFefo, type SelectableBatch } from './fefo';

const NOW = new Date('2026-09-14T10:00:00.000Z');

const batch = (overrides: Partial<SelectableBatch> = {}): SelectableBatch => ({
  id: 'b1',
  batchNumber: 'B-001',
  expiryDate: new Date('2027-06-30T00:00:00.000Z'),
  quantityOnHand: 100,
  unitCostMinor: 5_000,
  status: 'ACTIVE',
  receivedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

// -----------------------------------------------------------------------------
// FEFO
// -----------------------------------------------------------------------------

describe('FEFO selection', () => {
  it('takes from the batch that expires first', () => {
    const result = selectFefo(
      [
        batch({ id: 'later', batchNumber: 'B-LATER', expiryDate: new Date('2027-12-31') }),
        batch({ id: 'sooner', batchNumber: 'B-SOONER', expiryDate: new Date('2027-01-31') }),
      ],
      30,
      NOW,
    );

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].batchId).toBe('sooner');
  });

  it('spreads across batches when one is not enough', () => {
    const result = selectFefo(
      [
        batch({ id: 'a', batchNumber: 'B-A', quantityOnHand: 20, expiryDate: new Date('2027-01-31') }),
        batch({ id: 'b', batchNumber: 'B-B', quantityOnHand: 50, expiryDate: new Date('2027-06-30') }),
      ],
      35,
      NOW,
    );

    expect(result.allocations.map((a) => [a.batchId, a.quantity])).toEqual([
      ['a', 20],
      ['b', 15],
    ]);
    expect(result.allocatedQuantity).toBe(35);
    expect(result.shortfall).toBe(0);
  });

  it('never dispenses an expired batch', () => {
    // Not a warning, not an override. This is the failure the rule prevents.
    const result = selectFefo(
      [batch({ id: 'expired', batchNumber: 'B-OLD', expiryDate: new Date('2026-08-31') })],
      10,
      NOW,
    );

    expect(result.allocations).toEqual([]);
    expect(result.shortfall).toBe(10);
    expect(result.excluded[0].reason).toContain('Expired on 2026-08-31');
  });

  it('treats a batch expiring today as expired', () => {
    const result = selectFefo([batch({ expiryDate: new Date('2026-09-14T09:00:00.000Z') })], 10, NOW);

    expect(result.allocations).toEqual([]);
  });

  it('never dispenses quarantined or recalled stock', () => {
    const result = selectFefo(
      [
        batch({ id: 'q', batchNumber: 'B-Q', status: 'QUARANTINED' }),
        batch({ id: 'r', batchNumber: 'B-R', status: 'RECALLED' }),
      ],
      10,
      NOW,
    );

    expect(result.allocations).toEqual([]);
    expect(result.excluded.map((e) => e.reason)).toEqual([
      'Quarantined, pending investigation.',
      'Recalled by the supplier or a regulator.',
    ]);
  });

  it('reports a shortfall rather than rounding it away', () => {
    const result = selectFefo([batch({ quantityOnHand: 5 })], 30, NOW);

    expect(result.allocatedQuantity).toBe(5);
    expect(result.shortfall).toBe(25);
  });

  it('warns when a batch is near expiry, but still dispenses it', () => {
    // Near-expiry stock is usable; the pharmacist needs to know whether it
    // covers the course being dispensed.
    const result = selectFefo([batch({ expiryDate: new Date('2026-10-20') })], 10, NOW);

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].nearExpiryWarning).toContain('Expires in 36 day(s)');
  });

  it('values each allocation at what that batch actually cost', () => {
    // Not an average: a recall or a margin question needs the real figure.
    const result = selectFefo(
      [
        batch({ id: 'cheap', batchNumber: 'B-1', quantityOnHand: 10, unitCostMinor: 1_000, expiryDate: new Date('2027-01-31') }),
        batch({ id: 'dear', batchNumber: 'B-2', quantityOnHand: 10, unitCostMinor: 3_000, expiryDate: new Date('2027-06-30') }),
      ],
      15,
      NOW,
    );

    expect(result.allocations[0].valueMinor).toBe(10_000);
    expect(result.allocations[1].valueMinor).toBe(15_000);
    expect(result.totalValueMinor).toBe(25_000);
  });

  it('breaks an expiry tie by which arrived first', () => {
    const result = selectFefo(
      [
        batch({ id: 'newer', batchNumber: 'B-NEW', receivedAt: new Date('2026-05-01') }),
        batch({ id: 'older', batchNumber: 'B-OLD', receivedAt: new Date('2026-02-01') }),
      ],
      10,
      NOW,
    );

    expect(result.allocations[0].batchId).toBe('older');
  });

  it('puts a batch with no expiry date last', () => {
    const result = selectFefo(
      [
        batch({ id: 'none', batchNumber: 'B-NONE', expiryDate: null, quantityOnHand: 10 }),
        batch({ id: 'dated', batchNumber: 'B-DATED', quantityOnHand: 10 }),
      ],
      15,
      NOW,
    );

    expect(result.allocations[0].batchId).toBe('dated');
  });

  it('skips a batch with nothing in it', () => {
    const result = selectFefo([batch({ quantityOnHand: 0 })], 10, NOW);

    expect(result.excluded[0].reason).toContain('No stock remains');
  });

  it('is deterministic when two batches are indistinguishable', () => {
    const batches = [
      batch({ id: 'x', batchNumber: 'B-X', quantityOnHand: 5 }),
      batch({ id: 'y', batchNumber: 'B-Y', quantityOnHand: 5 }),
    ];

    expect(selectFefo(batches, 10, NOW).allocations.map((a) => a.batchId)).toEqual(
      selectFefo([...batches].reverse(), 10, NOW).allocations.map((a) => a.batchId),
    );
  });

  it('refuses a quantity that is not a quantity', () => {
    expect(() => selectFefo([batch()], 0, NOW)).toThrow(RangeError);
    expect(() => selectFefo([batch()], -5, NOW)).toThrow(RangeError);
  });

  it('handles fractional quantities without drifting', () => {
    const result = selectFefo([batch({ quantityOnHand: 2.5 }), batch({ id: 'b2', batchNumber: 'B-2' })], 3.7, NOW);

    expect(result.allocatedQuantity).toBe(3.7);
    expect(result.shortfall).toBe(0);
  });
});

describe('batch status', () => {
  it('is derived from the date, not from when a job last ran', () => {
    expect(deriveStatus({ expiryDate: new Date('2026-08-01'), quantityOnHand: 10, status: 'ACTIVE' }, NOW)).toBe(
      'EXPIRED',
    );
  });

  it('flags near expiry', () => {
    expect(deriveStatus({ expiryDate: new Date('2026-10-01'), quantityOnHand: 10, status: 'ACTIVE' }, NOW)).toBe(
      'NEAR_EXPIRY',
    );
  });

  it('reports an empty batch as depleted', () => {
    expect(deriveStatus({ expiryDate: new Date('2027-06-30'), quantityOnHand: 0, status: 'ACTIVE' }, NOW)).toBe(
      'DEPLETED',
    );
  });

  it('lets a human decision outrank the clock', () => {
    // Somebody quarantined this for a reason; the calendar does not undo that.
    expect(
      deriveStatus({ expiryDate: new Date('2027-06-30'), quantityOnHand: 10, status: 'QUARANTINED' }, NOW),
    ).toBe('QUARANTINED');
  });
});

describe('the stock identity', () => {
  it('holds across every movement type', () => {
    const result = reconcile(100, [
      { transactionType: 'RECEIPT', quantity: 50 },
      { transactionType: 'ISSUE', quantity: -30 },
      { transactionType: 'WASTAGE', quantity: -5 },
      { transactionType: 'ADJUSTMENT', quantity: -2 },
      { transactionType: 'RETURN', quantity: 3 },
    ]);

    // 100 + 50 − 30 − 5 − 2 + 3
    expect(result.closing).toBe(116);
    expect(result.issues).toBe(30);
    expect(result.wastage).toBe(5);
  });

  it('reports issues as a magnitude, however they are stored', () => {
    expect(reconcile(10, [{ transactionType: 'ISSUE', quantity: -4 }]).issues).toBe(4);
  });

  it('lets an adjustment go either way', () => {
    expect(reconcile(10, [{ transactionType: 'ADJUSTMENT', quantity: 3 }]).closing).toBe(13);
    expect(reconcile(10, [{ transactionType: 'ADJUSTMENT', quantity: -3 }]).closing).toBe(7);
  });

  it('returns the opening balance when nothing moved', () => {
    expect(reconcile(42, []).closing).toBe(42);
  });
});

