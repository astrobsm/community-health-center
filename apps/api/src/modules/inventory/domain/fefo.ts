/**
 * FEFO batch selection (doc 14 §4).
 *
 * First expiring, first out. The order matters for a reason that has nothing
 * to do with accounting: stock dispensed in the wrong order expires on the
 * shelf, and a facility that wastes its antimalarials runs out of them.
 *
 * Pure: the clock is injected, so "expired" means expired as at a stated
 * moment rather than whenever the test happened to run.
 */

export type BatchStatus = 'ACTIVE' | 'NEAR_EXPIRY' | 'EXPIRED' | 'QUARANTINED' | 'RECALLED' | 'DEPLETED';

export interface SelectableBatch {
  id: string;
  batchNumber: string;
  expiryDate: Date | null;
  quantityOnHand: number;
  unitCostMinor: number;
  status: BatchStatus;
  receivedAt: Date;
}

export interface Allocation {
  batchId: string;
  batchNumber: string;
  quantity: number;
  unitCostMinor: number;
  /** Quantity times unit cost, so the issue is valued at what it actually cost. */
  valueMinor: number;
  expiryDate: Date | null;
  /** Set when this batch expires soon enough that the pharmacist should know. */
  nearExpiryWarning?: string;
}

export interface FefoResult {
  allocations: Allocation[];
  allocatedQuantity: number;
  /** Requested less allocated. Positive means there was not enough stock. */
  shortfall: number;
  totalValueMinor: number;
  /** Batches passed over, and why — so a pharmacist can see the reasoning. */
  excluded: Array<{ batchNumber: string; reason: string }>;
}

export interface FefoOptions {
  /** Batches expiring within this many days are flagged, not withheld. */
  nearExpiryDays?: number;
}

const DEFAULT_NEAR_EXPIRY_DAYS = 90;

/**
 * Choose batches for an issue.
 *
 * Never allocates more than is on hand. A shortfall is reported rather than
 * rounded away: the caller decides whether to dispense a partial quantity,
 * and the alternative — a negative balance — is refused by the database
 * regardless.
 */
export function selectFefo(
  batches: readonly SelectableBatch[],
  requestedQuantity: number,
  now: Date,
  options: FefoOptions = {},
): FefoResult {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new RangeError('A quantity to dispense must be a positive number.');
  }

  const nearExpiryDays = options.nearExpiryDays ?? DEFAULT_NEAR_EXPIRY_DAYS;
  const excluded: FefoResult['excluded'] = [];
  const eligible: SelectableBatch[] = [];

  for (const batch of batches) {
    if (batch.quantityOnHand <= 0) {
      excluded.push({ batchNumber: batch.batchNumber, reason: 'No stock remains in this batch.' });
      continue;
    }

    if (batch.status === 'QUARANTINED') {
      excluded.push({ batchNumber: batch.batchNumber, reason: 'Quarantined, pending investigation.' });
      continue;
    }

    if (batch.status === 'RECALLED') {
      excluded.push({ batchNumber: batch.batchNumber, reason: 'Recalled by the supplier or a regulator.' });
      continue;
    }

    if (batch.status === 'EXPIRED' || (batch.expiryDate !== null && batch.expiryDate <= now)) {
      // Expired stock is never selectable. Not a warning, not an override:
      // giving a patient an expired medicine is the failure this prevents.
      excluded.push({
        batchNumber: batch.batchNumber,
        reason: `Expired${batch.expiryDate ? ` on ${batch.expiryDate.toISOString().slice(0, 10)}` : ''}.`,
      });
      continue;
    }

    eligible.push(batch);
  }

  // First expiring, first out. A batch with no expiry date goes last: it can
  // wait, and anything that does expire should move first.
  const ordered = [...eligible].sort((a, b) => {
    const left = a.expiryDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const right = b.expiryDate?.getTime() ?? Number.POSITIVE_INFINITY;

    if (left !== right) return left - right;

    // Same expiry: oldest receipt first, so stock does not sit behind newer
    // stock of the same date.
    if (a.receivedAt.getTime() !== b.receivedAt.getTime()) {
      return a.receivedAt.getTime() - b.receivedAt.getTime();
    }

    // Deterministic even when two batches are indistinguishable, so two runs
    // over the same stock produce the same allocation.
    return a.batchNumber.localeCompare(b.batchNumber);
  });

  const allocations: Allocation[] = [];
  let remaining = requestedQuantity;

  for (const batch of ordered) {
    if (remaining <= 0) break;

    const quantity = Math.min(remaining, batch.quantityOnHand);
    remaining = round(remaining - quantity, 3);

    const daysToExpiry = batch.expiryDate
      ? Math.ceil((batch.expiryDate.getTime() - now.getTime()) / 86_400_000)
      : null;

    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      quantity: round(quantity, 3),
      unitCostMinor: batch.unitCostMinor,
      // Valued at what this batch cost, not at an average. A recall or a
      // margin question needs the actual figure.
      valueMinor: Math.round(quantity * batch.unitCostMinor),
      expiryDate: batch.expiryDate,
      ...(daysToExpiry !== null && daysToExpiry <= nearExpiryDays
        ? {
            nearExpiryWarning:
              `Expires in ${daysToExpiry} day(s), on ${batch.expiryDate!.toISOString().slice(0, 10)}. ` +
              'Check it is suitable for the course being dispensed.',
          }
        : {}),
    });
  }

  const allocated = round(
    allocations.reduce((sum, allocation) => sum + allocation.quantity, 0),
    3,
  );

  return {
    allocations,
    allocatedQuantity: allocated,
    shortfall: round(Math.max(0, requestedQuantity - allocated), 3),
    totalValueMinor: allocations.reduce((sum, allocation) => sum + allocation.valueMinor, 0),
    excluded,
  };
}

/**
 * The status a batch should hold as at a moment.
 *
 * Derived from the expiry date rather than stored and hoped for: a batch does
 * not expire because a nightly job ran, it expires because the date passed
 * (§10). The job exists to post the wastage, not to make the fact true.
 */
export function deriveStatus(
  batch: { expiryDate: Date | null; quantityOnHand: number; status: BatchStatus },
  now: Date,
  nearExpiryDays = DEFAULT_NEAR_EXPIRY_DAYS,
): BatchStatus {
  // Quarantine and recall are decisions somebody made; they outrank the clock.
  if (batch.status === 'QUARANTINED' || batch.status === 'RECALLED') return batch.status;

  if (batch.expiryDate !== null && batch.expiryDate <= now) return 'EXPIRED';
  if (batch.quantityOnHand <= 0) return 'DEPLETED';

  if (batch.expiryDate !== null) {
    const days = Math.ceil((batch.expiryDate.getTime() - now.getTime()) / 86_400_000);
    if (days <= nearExpiryDays) return 'NEAR_EXPIRY';
  }

  return 'ACTIVE';
}

/**
 * The stock identity (spec §45, doc 14 §5).
 *
 *     opening + receipts − issues − wastage ± adjustments = closing
 *
 * Computed from the ledger, and compared with the cached quantity. When they
 * disagree, the LEDGER is right: the cache is a convenience, the transactions
 * are what happened.
 */
export function reconcile(
  openingQuantity: number,
  transactions: ReadonlyArray<{ transactionType: string; quantity: number }>,
): {
  opening: number;
  receipts: number;
  issues: number;
  wastage: number;
  adjustments: number;
  returns: number;
  transfers: number;
  closing: number;
} {
  let receipts = 0;
  let issues = 0;
  let wastage = 0;
  let adjustments = 0;
  let returns = 0;
  let transfers = 0;

  for (const transaction of transactions) {
    switch (transaction.transactionType) {
      case 'RECEIPT':
        receipts += transaction.quantity;
        break;
      case 'ISSUE':
        // Issues are stored negative; reported as a positive magnitude.
        issues += Math.abs(transaction.quantity);
        break;
      case 'WASTAGE':
        wastage += Math.abs(transaction.quantity);
        break;
      case 'ADJUSTMENT':
        adjustments += transaction.quantity;
        break;
      case 'RETURN':
        returns += transaction.quantity;
        break;
      case 'TRANSFER':
        transfers += transaction.quantity;
        break;
      default:
        break;
    }
  }

  return {
    opening: round(openingQuantity, 3),
    receipts: round(receipts, 3),
    issues: round(issues, 3),
    wastage: round(wastage, 3),
    adjustments: round(adjustments, 3),
    returns: round(returns, 3),
    transfers: round(transfers, 3),
    closing: round(
      openingQuantity + receipts - issues - wastage + adjustments + returns + transfers,
      3,
    ),
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
