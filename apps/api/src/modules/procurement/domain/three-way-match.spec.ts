import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOLERANCE,
  matchInvoice,
  type MatchOrderLine,
  type MatchReceiptLine,
} from './three-way-match';

/**
 * A simple order, so every figure below is checkable by hand:
 *
 *   10 hospital beds at 50,000 kobo   =   500,000
 *    4 drip stands at 12,500 kobo     =    50,000
 *                                       ---------
 *                                         550,000 kobo ordered
 */
const orderLines: MatchOrderLine[] = [
  { id: 'line-beds', description: 'Hospital bed', quantityOrdered: 10, unitPriceMinor: 50_000 },
  { id: 'line-stands', description: 'Drip stand', quantityOrdered: 4, unitPriceMinor: 12_500 },
];

const fullReceipt: MatchReceiptLine[] = [
  { purchaseOrderLineId: 'line-beds', description: 'Hospital bed', quantityAccepted: 10, quantityRejected: 0, unitCostMinor: 50_000 },
  { purchaseOrderLineId: 'line-stands', description: 'Drip stand', quantityAccepted: 4, quantityRejected: 0, unitCostMinor: 12_500 },
];

const invoice = (overrides: Partial<Parameters<typeof matchInvoice>[0]['invoice']> = {}) => ({
  invoiceNumber: 'INV-001',
  amountMinor: 550_000,
  taxMinor: 41_250,
  totalMinor: 591_250,
  ...overrides,
});

const codes = (result: ReturnType<typeof matchInvoice>) => result.findings.map((finding) => finding.code);

describe('a clean match', () => {
  const result = matchInvoice({ orderLines, receiptLines: fullReceipt, invoice: invoice() });

  it('matches', () => {
    expect(result.status).toBe('MATCHED');
    expect(result.findings).toEqual([]);
  });

  it('values what was received at the prices that were ordered', () => {
    expect(result.receivedValueMinor).toBe(550_000);
    expect(result.varianceMinor).toBe(0);
  });

  it('makes the full invoice payable, tax included', () => {
    expect(result.payableMinor).toBe(591_250);
    expect(result.requiresApproval).toBe(false);
  });
});

describe('invoiced without a receipt', () => {
  const result = matchInvoice({ orderLines, receiptLines: [], invoice: invoice() });

  it('is blocked, not merely flagged', () => {
    // The discrepancy this whole control exists for.
    expect(result.status).toBe('BLOCKED');
    expect(codes(result)).toContain('no-goods-receipt');
  });

  it('makes nothing payable', () => {
    expect(result.payableMinor).toBe(0);
  });

  it('says what to do about it', () => {
    expect(result.findings[0].remedy).toContain('Record the goods receipt');
  });
});

describe('a duplicate invoice number', () => {
  const result = matchInvoice({
    orderLines,
    receiptLines: fullReceipt,
    invoice: invoice(),
    existingInvoiceNumbers: ['INV-001'],
  });

  it('is blocked', () => {
    expect(result.status).toBe('BLOCKED');
    expect(codes(result)).toContain('duplicate-invoice');
    expect(result.payableMinor).toBe(0);
  });

  it('does not block a genuinely different number', () => {
    const other = matchInvoice({
      orderLines,
      receiptLines: fullReceipt,
      invoice: invoice({ invoiceNumber: 'INV-002' }),
      existingInvoiceNumbers: ['INV-001'],
    });

    expect(other.status).toBe('MATCHED');
  });
});

describe('price variance', () => {
  it('blocks an invoice materially above the value received', () => {
    // 620,000 against 550,000 received: 70,000 more, well beyond 2%.
    const result = matchInvoice({
      orderLines,
      receiptLines: fullReceipt,
      invoice: invoice({ amountMinor: 620_000, totalMinor: 661_250 }),
    });

    expect(result.status).toBe('BLOCKED');
    expect(codes(result)).toContain('invoice-exceeds-received');
    expect(result.varianceMinor).toBe(70_000);
    expect(result.payableMinor).toBe(0);
  });

  it('tolerates a variance inside the absolute allowance', () => {
    // 5,000 kobo on a 550,000 order. Chasing it costs more than it is worth.
    const result = matchInvoice({
      orderLines,
      receiptLines: fullReceipt,
      invoice: invoice({ amountMinor: 555_000, totalMinor: 596_250 }),
    });

    expect(result.status).toBe('MATCHED');
  });

  it('flags a variance above the absolute allowance but inside the percentage', () => {
    const result = matchInvoice({
      orderLines,
      receiptLines: fullReceipt,
      invoice: invoice({ amountMinor: 561_000, totalMinor: 602_250 }),
      tolerance: { quantityPercent: 0.02, pricePercent: 0.05, absoluteMinor: 10_000 },
    });

    expect(result.status).toBe('VARIANCE');
    expect(codes(result)).toContain('price-variance');
    expect(result.requiresApproval).toBe(true);
  });

  it('never complains about an invoice below the value received', () => {
    // A supplier undercharging is not a control failure.
    const result = matchInvoice({
      orderLines,
      receiptLines: fullReceipt,
      invoice: invoice({ amountMinor: 500_000, totalMinor: 537_500 }),
    });

    expect(codes(result)).not.toContain('invoice-exceeds-received');
    expect(codes(result)).not.toContain('price-variance');
  });

  it('values the goods at the ordered price, not the price on the delivery note', () => {
    // The supplier wrote a higher unit cost on their own paperwork. What a
    // supplier writes on their own paperwork is not an agreement.
    const inflated: MatchReceiptLine[] = [
      { purchaseOrderLineId: 'line-beds', description: 'Hospital bed', quantityAccepted: 10, quantityRejected: 0, unitCostMinor: 80_000 },
      { purchaseOrderLineId: 'line-stands', description: 'Drip stand', quantityAccepted: 4, quantityRejected: 0, unitCostMinor: 12_500 },
    ];

    const result = matchInvoice({ orderLines, receiptLines: inflated, invoice: invoice() });

    expect(result.receivedValueMinor).toBe(550_000);
    expect(result.status).toBe('MATCHED');
  });
});

describe('quantity discrepancies', () => {
  it('flags an over-receipt beyond tolerance', () => {
    const over: MatchReceiptLine[] = [
      { purchaseOrderLineId: 'line-beds', description: 'Hospital bed', quantityAccepted: 12, quantityRejected: 0, unitCostMinor: 50_000 },
      ...fullReceipt.slice(1),
    ];

    const result = matchInvoice({
      orderLines,
      receiptLines: over,
      invoice: invoice({ amountMinor: 650_000, totalMinor: 698_750 }),
    });

    expect(codes(result)).toContain('quantity-over-receipt');
    expect(result.findings.find((f) => f.code === 'quantity-over-receipt')?.severity).toBe('FLAG');
  });

  it('tolerates a small over-receipt', () => {
    const slightlyOver: MatchReceiptLine[] = [
      { purchaseOrderLineId: 'line-beds', description: 'Hospital bed', quantityAccepted: 10.1, quantityRejected: 0, unitCostMinor: 50_000 },
      ...fullReceipt.slice(1),
    ];

    const result = matchInvoice({ orderLines, receiptLines: slightlyOver, invoice: invoice() });

    expect(codes(result)).not.toContain('quantity-over-receipt');
  });

  it('flags a part delivery so the full invoice is not paid without noticing', () => {
    const partial: MatchReceiptLine[] = [
      { purchaseOrderLineId: 'line-beds', description: 'Hospital bed', quantityAccepted: 6, quantityRejected: 0, unitCostMinor: 50_000 },
      ...fullReceipt.slice(1),
    ];

    const result = matchInvoice({
      orderLines,
      receiptLines: partial,
      invoice: invoice({ amountMinor: 350_000, totalMinor: 376_250 }),
    });

    expect(codes(result)).toContain('quantity-short-receipt');
    expect(result.receivedValueMinor).toBe(350_000);
    expect(result.status).toBe('VARIANCE');
  });

  it('blocks payment when the whole delivery was rejected', () => {
    const rejected: MatchReceiptLine[] = [
      { purchaseOrderLineId: 'line-beds', description: 'Hospital bed', quantityAccepted: 0, quantityRejected: 10, unitCostMinor: 50_000 },
      { purchaseOrderLineId: 'line-stands', description: 'Drip stand', quantityAccepted: 0, quantityRejected: 4, unitCostMinor: 12_500 },
    ];

    const result = matchInvoice({ orderLines, receiptLines: rejected, invoice: invoice() });

    expect(result.status).toBe('BLOCKED');
    expect(codes(result)).toContain('nothing-accepted');
    expect(result.payableMinor).toBe(0);
  });

  it('counts only accepted goods, never rejected ones', () => {
    const partlyRejected: MatchReceiptLine[] = [
      { purchaseOrderLineId: 'line-beds', description: 'Hospital bed', quantityAccepted: 8, quantityRejected: 2, unitCostMinor: 50_000 },
      ...fullReceipt.slice(1),
    ];

    const result = matchInvoice({
      orderLines,
      receiptLines: partlyRejected,
      invoice: invoice({ amountMinor: 450_000, totalMinor: 483_750 }),
    });

    expect(result.receivedValueMinor).toBe(450_000);
  });
});

describe('goods received against no order', () => {
  it('is flagged as an emergency purchase needing retrospective approval', () => {
    const emergency: MatchReceiptLine[] = [
      ...fullReceipt,
      { purchaseOrderLineId: null, description: 'Emergency oxygen cylinder', quantityAccepted: 2, quantityRejected: 0, unitCostMinor: 100_000 },
    ];

    const result = matchInvoice({
      orderLines,
      receiptLines: emergency,
      invoice: invoice({ amountMinor: 750_000, totalMinor: 806_250 }),
    });

    expect(codes(result)).toContain('receipt-without-order');
    expect(result.findings.find((f) => f.code === 'receipt-without-order')?.severity).toBe('FLAG');
  });

  it('still counts its value, so the invoice is not blocked for goods that did arrive', () => {
    const emergency: MatchReceiptLine[] = [
      ...fullReceipt,
      { purchaseOrderLineId: null, description: 'Emergency oxygen cylinder', quantityAccepted: 2, quantityRejected: 0, unitCostMinor: 100_000 },
    ];

    const result = matchInvoice({
      orderLines,
      receiptLines: emergency,
      invoice: invoice({ amountMinor: 750_000, totalMinor: 806_250 }),
    });

    expect(result.receivedValueMinor).toBe(750_000);
  });

  it('flags a receipt citing an order line from another order', () => {
    const wrongLine: MatchReceiptLine[] = [
      { purchaseOrderLineId: 'line-from-another-po', description: 'Hospital bed', quantityAccepted: 10, quantityRejected: 0, unitCostMinor: 50_000 },
    ];

    expect(codes(matchInvoice({ orderLines, receiptLines: wrongLine, invoice: invoice() }))).toContain(
      'receipt-without-order',
    );
  });
});

describe('payment already made', () => {
  it('blocks a payment that would exceed the invoice', () => {
    const result = matchInvoice({
      orderLines,
      receiptLines: fullReceipt,
      invoice: invoice(),
      paidToDateMinor: 600_000,
    });

    expect(result.status).toBe('BLOCKED');
    expect(codes(result)).toContain('payment-exceeds-invoice');
    expect(result.payableMinor).toBe(0);
  });

  it('reduces what remains payable by what has been paid', () => {
    const result = matchInvoice({
      orderLines,
      receiptLines: fullReceipt,
      invoice: invoice(),
      paidToDateMinor: 291_250,
    });

    expect(result.status).toBe('MATCHED');
    expect(result.payableMinor).toBe(300_000);
  });

  it('leaves nothing payable on a fully paid invoice', () => {
    const result = matchInvoice({
      orderLines,
      receiptLines: fullReceipt,
      invoice: invoice(),
      paidToDateMinor: 591_250,
    });

    expect(result.payableMinor).toBe(0);
  });
});

describe('across every discrepancy', () => {
  it('never makes anything payable while a block stands', () => {
    // A partial payment "on account" against a blocked invoice is how this
    // control gets quietly bypassed.
    const blocked = [
      matchInvoice({ orderLines, receiptLines: [], invoice: invoice() }),
      matchInvoice({ orderLines, receiptLines: fullReceipt, invoice: invoice(), existingInvoiceNumbers: ['INV-001'] }),
      matchInvoice({ orderLines, receiptLines: fullReceipt, invoice: invoice({ amountMinor: 900_000, totalMinor: 967_500 }) }),
      matchInvoice({ orderLines, receiptLines: fullReceipt, invoice: invoice(), paidToDateMinor: 999_999 }),
    ];

    for (const result of blocked) {
      expect(result.status).toBe('BLOCKED');
      expect(result.payableMinor).toBe(0);
      expect(result.requiresApproval).toBe(false);
    }
  });

  it('gives every finding a remedy', () => {
    // A blocked payment with no route forward stalls a facility.
    const result = matchInvoice({
      orderLines,
      receiptLines: [
        { purchaseOrderLineId: 'line-beds', description: 'Hospital bed', quantityAccepted: 14, quantityRejected: 0, unitCostMinor: 50_000 },
        { purchaseOrderLineId: null, description: 'Something unordered', quantityAccepted: 1, quantityRejected: 0, unitCostMinor: 5_000 },
      ],
      invoice: invoice({ amountMinor: 900_000, totalMinor: 967_500 }),
      existingInvoiceNumbers: ['INV-001'],
    });

    expect(result.findings.length).toBeGreaterThan(3);
    for (const finding of result.findings) {
      expect(finding.remedy.length, finding.code).toBeGreaterThan(20);
      expect(finding.detail.length, finding.code).toBeGreaterThan(20);
    }
  });

  it('is deterministic', () => {
    const args = { orderLines, receiptLines: fullReceipt, invoice: invoice() };

    expect(matchInvoice(args)).toEqual(matchInvoice(args));
  });

  it('takes its tolerances from configuration, never from code', () => {
    const slightlyOver = { ...invoice(), amountMinor: 560_000, totalMinor: 601_250 };

    const strict = matchInvoice({
      orderLines,
      receiptLines: fullReceipt,
      invoice: slightlyOver,
      tolerance: { quantityPercent: 0, pricePercent: 0, absoluteMinor: 0 },
    });

    const relaxed = matchInvoice({
      orderLines,
      receiptLines: fullReceipt,
      invoice: slightlyOver,
      tolerance: { quantityPercent: 0.5, pricePercent: 0.5, absoluteMinor: 100_000 },
    });

    expect(strict.status).toBe('BLOCKED');
    expect(relaxed.status).toBe('MATCHED');
  });

  it('has a default tolerance that is stated, not hidden', () => {
    expect(DEFAULT_TOLERANCE.quantityPercent).toBeGreaterThan(0);
    expect(DEFAULT_TOLERANCE.pricePercent).toBeGreaterThan(0);
    expect(DEFAULT_TOLERANCE.absoluteMinor).toBeGreaterThan(0);
  });
});
