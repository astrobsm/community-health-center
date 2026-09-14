/**
 * Three-way match: PO ↔ GRN ↔ invoice (spec §46, doc 14 §7).
 *
 * The control that stops a facility paying for goods it never received, twice,
 * or at a price nobody agreed. Every discrepancy in doc 14 §7 is detected here
 * and either BLOCKS payment or is FLAGGED for an approver — never silently
 * tolerated.
 *
 * Pure: no I/O, no clock. Tolerances arrive as configuration, because the
 * acceptable variance on a bag of cement is not the acceptable variance on a
 * theatre lamp, and neither belongs in code (§89).
 */

export interface MatchOrderLine {
  id: string;
  description: string;
  quantityOrdered: number;
  unitPriceMinor: number;
}

export interface MatchReceiptLine {
  /** Null when goods arrived against no order line — an emergency purchase. */
  purchaseOrderLineId: string | null;
  description: string;
  quantityAccepted: number;
  quantityRejected: number;
  unitCostMinor: number;
}

export interface MatchInvoice {
  invoiceNumber: string;
  /** Net of tax. Tax is not matched against goods; it is matched against itself. */
  amountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface MatchTolerance {
  /** Permitted over-receipt, as a proportion of the ordered quantity. */
  quantityPercent: number;
  /** Permitted price variance, as a proportion of the ordered value. */
  pricePercent: number;
  /** Variances below this are never worth anybody's time, whatever the percentage. */
  absoluteMinor: number;
}

export const DEFAULT_TOLERANCE: MatchTolerance = {
  quantityPercent: 0.02,
  pricePercent: 0.02,
  absoluteMinor: 10_000,
};

export type FindingSeverity = 'BLOCK' | 'FLAG';

export interface MatchFinding {
  code:
    | 'no-goods-receipt'
    | 'duplicate-invoice'
    | 'price-variance'
    | 'quantity-over-receipt'
    | 'quantity-short-receipt'
    | 'receipt-without-order'
    | 'payment-exceeds-invoice'
    | 'invoice-exceeds-received'
    | 'nothing-accepted';
  severity: FindingSeverity;
  detail: string;
  /** What to do about it, because a blocked payment with no route forward stalls a facility. */
  remedy: string;
  line?: string;
}

export interface MatchResult {
  status: 'MATCHED' | 'VARIANCE' | 'BLOCKED';
  findings: MatchFinding[];
  /** Value of what was actually accepted, at the prices that were ordered. */
  receivedValueMinor: number;
  /** Net invoiced against that. Positive means invoiced for more than received. */
  varianceMinor: number;
  /** What may be paid now. Zero whenever payment is blocked. */
  payableMinor: number;
  /** True when a flagged variance is present and an approver must accept it. */
  requiresApproval: boolean;
}

export function matchInvoice(params: {
  orderLines: readonly MatchOrderLine[];
  receiptLines: readonly MatchReceiptLine[];
  invoice: MatchInvoice;
  /** Invoice numbers already recorded for this supplier. */
  existingInvoiceNumbers?: readonly string[];
  /** Already paid against this invoice, so an overpayment is caught. */
  paidToDateMinor?: number;
  tolerance?: MatchTolerance;
}): MatchResult {
  const tolerance = params.tolerance ?? DEFAULT_TOLERANCE;
  const paidToDate = params.paidToDateMinor ?? 0;
  const findings: MatchFinding[] = [];

  const orderById = new Map(params.orderLines.map((line) => [line.id, line]));

  // ---------------------------------------------------------------------------
  // Invoiced without a receipt — the discrepancy this control exists for.
  // ---------------------------------------------------------------------------
  if (params.receiptLines.length === 0) {
    findings.push({
      code: 'no-goods-receipt',
      severity: 'BLOCK',
      detail: `Invoice ${params.invoice.invoiceNumber} has no goods receipt against it.`,
      remedy: 'Record the goods receipt, with what was actually accepted and what was rejected, before paying.',
    });
  }

  if ((params.existingInvoiceNumbers ?? []).includes(params.invoice.invoiceNumber)) {
    findings.push({
      code: 'duplicate-invoice',
      severity: 'BLOCK',
      detail: `Invoice number ${params.invoice.invoiceNumber} has already been recorded for this supplier.`,
      remedy: 'Check whether this is a re-sent copy of an invoice already in the system. If it is genuinely a second invoice, ask the supplier to re-issue it with a distinct number.',
    });
  }

  // ---------------------------------------------------------------------------
  // Quantities, per line
  // ---------------------------------------------------------------------------
  const acceptedByOrderLine = new Map<string, number>();
  let receivedValue = 0;
  let acceptedAnything = false;

  for (const receipt of params.receiptLines) {
    if (receipt.quantityAccepted > 0) acceptedAnything = true;

    if (receipt.purchaseOrderLineId === null) {
      // Goods that arrived against no order. Legitimate in an emergency, but
      // it must be somebody's decision rather than an accounting accident.
      findings.push({
        code: 'receipt-without-order',
        severity: 'FLAG',
        detail: `"${receipt.description}" was received against no order line.`,
        remedy: 'Record retrospective approval for the emergency purchase, or reject the delivery.',
        line: receipt.description,
      });

      receivedValue += Math.round(receipt.quantityAccepted * receipt.unitCostMinor);
      continue;
    }

    const order = orderById.get(receipt.purchaseOrderLineId);
    if (!order) {
      findings.push({
        code: 'receipt-without-order',
        severity: 'FLAG',
        detail: `"${receipt.description}" cites an order line that is not on this purchase order.`,
        remedy: 'Correct the goods receipt to cite the right order line, or record it as an emergency purchase.',
        line: receipt.description,
      });

      receivedValue += Math.round(receipt.quantityAccepted * receipt.unitCostMinor);
      continue;
    }

    acceptedByOrderLine.set(
      order.id,
      (acceptedByOrderLine.get(order.id) ?? 0) + receipt.quantityAccepted,
    );

    // Valued at the ORDERED price, not the price on the delivery note. What a
    // supplier writes on their own paperwork is not an agreement.
    receivedValue += Math.round(receipt.quantityAccepted * order.unitPriceMinor);
  }

  for (const order of params.orderLines) {
    const accepted = acceptedByOrderLine.get(order.id) ?? 0;
    const excess = accepted - order.quantityOrdered;
    const allowance = order.quantityOrdered * tolerance.quantityPercent;

    if (excess > allowance) {
      findings.push({
        code: 'quantity-over-receipt',
        severity: 'FLAG',
        detail:
          `${order.quantityOrdered} of "${order.description}" was ordered and ${accepted} accepted, ` +
          `which is ${round(excess, 3)} more than ordered.`,
        remedy: 'Approve the over-receipt explicitly, or return the excess to the supplier.',
        line: order.description,
      });
    } else if (accepted < order.quantityOrdered) {
      // Not a block: part deliveries are normal. It is reported so nobody
      // pays the full invoice for a part delivery without noticing.
      findings.push({
        code: 'quantity-short-receipt',
        severity: 'FLAG',
        detail:
          `${order.quantityOrdered} of "${order.description}" was ordered and ${accepted} accepted.`,
        remedy: 'Pay for what was received, or wait for the balance before invoicing.',
        line: order.description,
      });
    }
  }

  if (params.receiptLines.length > 0 && !acceptedAnything) {
    findings.push({
      code: 'nothing-accepted',
      severity: 'BLOCK',
      detail: 'Goods were received but none were accepted; the whole delivery was rejected.',
      remedy: 'Nothing is payable on a rejected delivery. Agree a credit note or a replacement with the supplier.',
    });
  }

  // ---------------------------------------------------------------------------
  // Price
  // ---------------------------------------------------------------------------
  const variance = params.invoice.amountMinor - receivedValue;
  const priceAllowance = Math.max(
    tolerance.absoluteMinor,
    Math.round(receivedValue * tolerance.pricePercent),
  );

  if (variance > priceAllowance) {
    findings.push({
      code: 'invoice-exceeds-received',
      severity: 'BLOCK',
      detail:
        `The invoice is for ${format(params.invoice.amountMinor)} net, but the goods accepted are worth ` +
        `${format(receivedValue)} at the prices ordered — ${format(variance)} more than was received.`,
      remedy:
        'Check the invoice against the order and the delivery. If the supplier has raised the price, that is a ' +
        'variation and needs approval before it is paid.',
    });
  } else if (variance > 0 && variance > tolerance.absoluteMinor) {
    findings.push({
      code: 'price-variance',
      severity: 'FLAG',
      detail: `The invoice is ${format(variance)} more than the value of what was accepted.`,
      remedy: 'Approve the variance explicitly, or ask the supplier for a corrected invoice.',
    });
  }

  // ---------------------------------------------------------------------------
  // Payment already made
  // ---------------------------------------------------------------------------
  if (paidToDate > params.invoice.totalMinor) {
    findings.push({
      code: 'payment-exceeds-invoice',
      severity: 'BLOCK',
      detail:
        `${format(paidToDate)} has already been paid against an invoice totalling ` +
        `${format(params.invoice.totalMinor)}.`,
      remedy: 'Recover the overpayment or apply it against another invoice from this supplier. Do not pay more.',
    });
  }

  const blocked = findings.some((finding) => finding.severity === 'BLOCK');
  const flagged = findings.some((finding) => finding.severity === 'FLAG');

  return {
    status: blocked ? 'BLOCKED' : flagged ? 'VARIANCE' : 'MATCHED',
    findings,
    receivedValueMinor: receivedValue,
    varianceMinor: variance,
    // Nothing is payable while a block stands. A partial payment "on account"
    // against a blocked invoice is how the control gets quietly bypassed.
    payableMinor: blocked ? 0 : Math.max(0, params.invoice.totalMinor - paidToDate),
    requiresApproval: !blocked && flagged,
  };
}

function format(minor: number): string {
  return `NGN ${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
