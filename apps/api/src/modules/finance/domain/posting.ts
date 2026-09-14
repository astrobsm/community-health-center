/**
 * Turning what happened into double entry (doc 12 §5, criteria G, H and I).
 *
 * Every clinical or supply event that has a financial consequence arrives here
 * and leaves as balanced journal lines. One place, so the accounts cannot
 * disagree with the wards about what took place.
 *
 * Two rules the whole ledger rests on:
 *
 *  - Debits equal credits, to the kobo, in every entry this module produces.
 *    A deferred database trigger asserts it again at COMMIT, so an unbalanced
 *    entry cannot reach the ledger by any path.
 *
 *  - Nothing is netted. A dispensing posts revenue AND cost of goods, not the
 *    margin: a facility needs to know what it sold and what it cost, and a
 *    single net figure answers neither question.
 *
 * Pure: no I/O, no clock, money in integer minor units throughout.
 */

export interface JournalLineDraft {
  accountCode: string;
  debitMinor: number;
  creditMinor: number;
  description: string;
}

export interface JournalEntryDraft {
  description: string;
  sourceType: string;
  sourceId: string;
  lines: JournalLineDraft[];
}

export class UnbalancedEntryError extends Error {
  constructor(
    readonly debitMinor: number,
    readonly creditMinor: number,
    readonly description: string,
  ) {
    super(
      `"${description}" does not balance: debits ${debitMinor} against credits ${creditMinor}. ` +
        'An entry must balance to the kobo.',
    );
    this.name = 'UnbalancedEntryError';
  }
}

/**
 * The account codes this module posts to.
 *
 * Named here rather than scattered through the services, so the chart of
 * accounts and the postings can be read side by side. The codes themselves
 * are seeded reference data; if a facility renames an account, the code is
 * what travels.
 */
export const ACCOUNTS = {
  CASH: '1110',
  BANK: '1120',
  PATIENT_RECEIVABLES: '1130',
  INVENTORY: '1150',
  CONSULTATION_REVENUE: '4110',
  LABORATORY_REVENUE: '4120',
  PHARMACY_REVENUE: '4130',
  PROCEDURE_REVENUE: '4140',
  MATERNITY_REVENUE: '4150',
  IMMUNISATION_REVENUE: '4160',
  ADMISSION_REVENUE: '4170',
  OTHER_CLINICAL_REVENUE: '4180',
  COST_OF_MEDICINES: '5110',
  COST_OF_REAGENTS: '5120',
  COST_OF_CONSUMABLES: '5130',
  STOCK_WRITE_OFF: '5140',
} as const;

/** Which revenue account a charge belongs in. */
export const REVENUE_ACCOUNT_BY_KIND: Record<string, string> = {
  CONSULTATION: ACCOUNTS.CONSULTATION_REVENUE,
  LABORATORY: ACCOUNTS.LABORATORY_REVENUE,
  PHARMACY: ACCOUNTS.PHARMACY_REVENUE,
  PROCEDURE: ACCOUNTS.PROCEDURE_REVENUE,
  MATERNITY: ACCOUNTS.MATERNITY_REVENUE,
  IMMUNISATION: ACCOUNTS.IMMUNISATION_REVENUE,
  ADMISSION: ACCOUNTS.ADMISSION_REVENUE,
  OTHER: ACCOUNTS.OTHER_CLINICAL_REVENUE,
};

/** Which cost account an issue of stock belongs in. */
export const COST_ACCOUNT_BY_KIND: Record<string, string> = {
  MEDICINE: ACCOUNTS.COST_OF_MEDICINES,
  REAGENT: ACCOUNTS.COST_OF_REAGENTS,
  CONSUMABLE: ACCOUNTS.COST_OF_CONSUMABLES,
  EQUIPMENT: ACCOUNTS.COST_OF_CONSUMABLES,
  OTHER: ACCOUNTS.COST_OF_CONSUMABLES,
};

/**
 * Assert an entry balances, and hand it back.
 *
 * Every builder below ends here, so there is exactly one place where "this
 * balances" is decided.
 */
export function balanced(entry: JournalEntryDraft): JournalEntryDraft {
  const debits = entry.lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const credits = entry.lines.reduce((sum, line) => sum + line.creditMinor, 0);

  if (debits !== credits) throw new UnbalancedEntryError(debits, credits, entry.description);

  for (const line of entry.lines) {
    if (line.debitMinor > 0 && line.creditMinor > 0) {
      throw new Error(
        `A journal line cannot be both a debit and a credit ("${line.description}"). ` +
          'Split it into two lines, so each says one thing.',
      );
    }

    if (line.debitMinor < 0 || line.creditMinor < 0) {
      // A negative debit is a credit wearing a disguise, and it makes every
      // total that reads only one column wrong.
      throw new Error(
        `A journal line cannot carry a negative amount ("${line.description}"). ` +
          'Post it on the other side instead.',
      );
    }
  }

  if (entry.lines.length < 2) {
    throw new Error(`"${entry.description}" has fewer than two lines, so it is not an entry.`);
  }

  return entry;
}

// -----------------------------------------------------------------------------
// Criterion G — a clinical encounter creates revenue
// -----------------------------------------------------------------------------

export interface ChargeInput {
  chargeId: string;
  description: string;
  amountMinor: number;
  /** CONSULTATION, LABORATORY, PHARMACY, PROCEDURE... */
  kind: string;
}

/**
 * A charge raised against a patient.
 *
 * Posted when the charge is RAISED, not when it is paid: the facility has
 * earned the revenue and is owed the money, and a ledger that waits for
 * payment cannot tell the difference between a good month and a month nobody
 * paid for.
 */
export function postCharge(charge: ChargeInput): JournalEntryDraft {
  const revenueAccount = REVENUE_ACCOUNT_BY_KIND[charge.kind] ?? ACCOUNTS.OTHER_CLINICAL_REVENUE;

  return balanced({
    description: `Charge: ${charge.description}`,
    sourceType: 'charge',
    sourceId: charge.chargeId,
    lines: [
      {
        accountCode: ACCOUNTS.PATIENT_RECEIVABLES,
        debitMinor: charge.amountMinor,
        creditMinor: 0,
        description: `Owed by the patient for ${charge.description}`,
      },
      {
        accountCode: revenueAccount,
        debitMinor: 0,
        creditMinor: charge.amountMinor,
        description: charge.description,
      },
    ],
  });
}

export interface PaymentInput {
  paymentId: string;
  amountMinor: number;
  method: string;
  description: string;
}

/** A patient pays. The receivable is settled; no revenue is recognised twice. */
export function postPatientPayment(payment: PaymentInput): JournalEntryDraft {
  const asset = payment.method === 'CASH' ? ACCOUNTS.CASH : ACCOUNTS.BANK;

  return balanced({
    description: `Payment received: ${payment.description}`,
    sourceType: 'payment',
    sourceId: payment.paymentId,
    lines: [
      {
        accountCode: asset,
        debitMinor: payment.amountMinor,
        creditMinor: 0,
        description: `${payment.method} received`,
      },
      {
        accountCode: ACCOUNTS.PATIENT_RECEIVABLES,
        debitMinor: 0,
        creditMinor: payment.amountMinor,
        // Settling what was owed. The revenue was recognised when the charge
        // was raised; recognising it again here would double the month.
        description: 'Settlement of patient receivable',
      },
    ],
  });
}

// -----------------------------------------------------------------------------
// Criterion H — dispensing updates stock, charges and the ledger
// -----------------------------------------------------------------------------

export interface StockIssueInput {
  sourceType: 'dispensing' | 'lab_consumption' | 'department_issue';
  sourceId: string;
  description: string;
  /** What the stock cost, from the batches actually issued. */
  costMinor: number;
  /** MEDICINE, REAGENT, CONSUMABLE... */
  itemKind: string;
}

/**
 * Stock leaving the shelf.
 *
 * Inventory falls and cost of goods rises, valued at what those specific
 * batches cost — never at an average, because a recall or a margin question
 * needs the actual figure.
 *
 * Posted separately from the revenue, not netted against it. A facility needs
 * to know both what it sold and what it cost; one net number answers neither.
 */
export function postStockIssue(issue: StockIssueInput): JournalEntryDraft {
  const costAccount = COST_ACCOUNT_BY_KIND[issue.itemKind] ?? ACCOUNTS.COST_OF_CONSUMABLES;

  return balanced({
    description: `Stock issued: ${issue.description}`,
    sourceType: issue.sourceType,
    sourceId: issue.sourceId,
    lines: [
      {
        accountCode: costAccount,
        debitMinor: issue.costMinor,
        creditMinor: 0,
        description: `Cost of ${issue.description}`,
      },
      {
        accountCode: ACCOUNTS.INVENTORY,
        debitMinor: 0,
        creditMinor: issue.costMinor,
        description: 'Stock reduced',
      },
    ],
  });
}

/** Stock arriving. Inventory rises against the payable already raised. */
export function postStockReceipt(receipt: {
  sourceId: string;
  description: string;
  costMinor: number;
  payableAccountCode: string;
}): JournalEntryDraft {
  return balanced({
    description: `Stock received: ${receipt.description}`,
    sourceType: 'goods_receipt',
    sourceId: receipt.sourceId,
    lines: [
      {
        accountCode: ACCOUNTS.INVENTORY,
        debitMinor: receipt.costMinor,
        creditMinor: 0,
        description: receipt.description,
      },
      {
        accountCode: receipt.payableAccountCode,
        debitMinor: 0,
        creditMinor: receipt.costMinor,
        description: 'Owed to the supplier',
      },
    ],
  });
}

/**
 * Stock written off.
 *
 * Expiry, breakage, a cold-chain failure. Posted so expired stock never
 * silently inflates either the inventory figure or the balance sheet — the
 * loss is visible, which is the only way anyone acts on it.
 */
export function postStockWriteOff(writeOff: {
  sourceId: string;
  description: string;
  costMinor: number;
  reasonCode: string;
}): JournalEntryDraft {
  return balanced({
    description: `Stock written off (${writeOff.reasonCode}): ${writeOff.description}`,
    sourceType: 'expiry',
    sourceId: writeOff.sourceId,
    lines: [
      {
        accountCode: ACCOUNTS.STOCK_WRITE_OFF,
        debitMinor: writeOff.costMinor,
        creditMinor: 0,
        description: `${writeOff.reasonCode}: ${writeOff.description}`,
      },
      {
        accountCode: ACCOUNTS.INVENTORY,
        debitMinor: 0,
        creditMinor: writeOff.costMinor,
        description: 'Stock removed',
      },
    ],
  });
}

// -----------------------------------------------------------------------------
// Reversal (spec §44)
// -----------------------------------------------------------------------------

/**
 * Reverse an entry.
 *
 * A financial record is never edited or deleted. A correction is a new,
 * linked, opposite entry, so the original and the correction both stand in
 * the record and anyone can see what was thought and what was decided.
 */
export function reverse(
  original: JournalEntryDraft,
  reason: string,
  reversalOf: string,
): JournalEntryDraft {
  if (reason.trim().length < 10) {
    throw new Error('A reversal must say why. An entry that reverses for no stated reason cannot be audited.');
  }

  return balanced({
    description: `Reversal of ${original.description}: ${reason}`,
    sourceType: original.sourceType,
    sourceId: reversalOf,
    lines: original.lines.map((line) => ({
      accountCode: line.accountCode,
      // Swapped, never negated: a negative debit would make every column
      // total wrong for anyone reading one side only.
      debitMinor: line.creditMinor,
      creditMinor: line.debitMinor,
      description: `Reversal: ${line.description}`,
    })),
  });
}

// -----------------------------------------------------------------------------
// Daily cash reconciliation (spec §45)
// -----------------------------------------------------------------------------

export interface CashReconciliation {
  openingMinor: number;
  receiptsMinor: number;
  paymentsOutMinor: number;
  bankedMinor: number;
  expectedClosingMinor: number;
  countedClosingMinor: number;
  /** Counted less expected. Negative is a shortage. */
  varianceMinor: number;
  balances: boolean;
  /** Stated in words, because a bare number does not tell anyone what to do. */
  summary: string;
}

/**
 * The daily cash identity.
 *
 *     opening + receipts − payments out − banked = expected closing
 *
 * Compared against what was actually counted. A variance is never absorbed
 * silently: a drawer that is short by ₦200 every day is a pattern somebody
 * needs to see, and one that balances to the kobo every single day is its own
 * kind of warning.
 */
export function reconcileCash(input: {
  openingMinor: number;
  receiptsMinor: number;
  paymentsOutMinor: number;
  bankedMinor: number;
  countedClosingMinor: number;
}): CashReconciliation {
  const expected =
    input.openingMinor + input.receiptsMinor - input.paymentsOutMinor - input.bankedMinor;

  const variance = input.countedClosingMinor - expected;
  const balances = variance === 0;

  return {
    openingMinor: input.openingMinor,
    receiptsMinor: input.receiptsMinor,
    paymentsOutMinor: input.paymentsOutMinor,
    bankedMinor: input.bankedMinor,
    expectedClosingMinor: expected,
    countedClosingMinor: input.countedClosingMinor,
    varianceMinor: variance,
    balances,
    summary: balances
      ? `The drawer balances: ${format(expected)} expected and counted.`
      : variance > 0
        ? `There is ${format(variance)} more in the drawer than the day accounts for. ` +
          'Find the receipt that was not recorded before closing the day.'
        : `The drawer is ${format(Math.abs(variance))} short of what the day accounts for. ` +
          'Recount, then record the shortage with an explanation; it is not written off silently.',
  };
}

function format(minor: number): string {
  return `NGN ${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}
