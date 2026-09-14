import { z } from 'zod';

import { isoDateSchema, uuidSchema } from './common.js';

/** Pharmacy, laboratory, inventory and the ledger (spec §§29-30, 45-46). */

// -----------------------------------------------------------------------------
// Inventory
// -----------------------------------------------------------------------------

export const receiveStockSchema = z.object({
  facilityId: uuidSchema,
  inventoryItemId: uuidSchema,
  batchNumber: z.string().min(1).max(100),
  quantity: z.number().positive(),
  unitCostMinor: z.number().int().nonnegative(),
  expiryDate: isoDateSchema.optional(),
  supplierId: uuidSchema.optional(),
  goodsReceiptLineId: uuidSchema.optional(),
  sourceNote: z.string().max(500).optional(),
});
export type ReceiveStock = z.infer<typeof receiveStockSchema>;

export const adjustStockSchema = z.object({
  batchId: uuidSchema,
  /** Signed: positive is a gain, negative a loss. Zero records nothing. */
  quantity: z.number().refine((value) => value !== 0, 'An adjustment of zero changes nothing.'),
  reasonCode: z.string().min(2).max(50),
  /** An adjustment nobody explained is indistinguishable from theft. */
  reasonNote: z.string().min(10).max(1000),
  countedBy: uuidSchema.optional(),
});
export type AdjustStock = z.infer<typeof adjustStockSchema>;

export const writeOffStockSchema = z.object({
  batchId: uuidSchema,
  quantity: z.number().positive(),
  reasonCode: z.enum(['EXPIRY', 'BREAKAGE', 'COLD_CHAIN', 'CONTAMINATION', 'RECALL', 'OTHER']),
  reasonNote: z.string().min(10).max(1000),
});
export type WriteOffStock = z.infer<typeof writeOffStockSchema>;

// -----------------------------------------------------------------------------
// Pharmacy
// -----------------------------------------------------------------------------

export const dispensePreviewSchema = z.object({
  facilityId: uuidSchema,
  inventoryItemId: uuidSchema,
  quantity: z.number().positive(),
});

export const dispenseSchema = z.object({
  prescriptionItemId: uuidSchema,
  quantity: z.number().positive(),
  unitPriceMinor: z.number().int().nonnegative(),
  /** Overriding FEFO. Permitted, but it must say why. */
  batchId: uuidSchema.optional(),
  fefoOverrideReason: z.string().max(1000).optional(),
});
export type Dispense = z.infer<typeof dispenseSchema>;

export const returnDispensingSchema = z.object({
  dispensingId: uuidSchema,
  quantity: z.number().positive(),
  reason: z.string().min(5).max(1000),
  /**
   * Whether it can go back on the shelf.
   *
   * Default false: medicine whose storage nobody can vouch for is not stock,
   * and putting it back to keep a number tidy is how a patient receives
   * something spoiled.
   */
  restockable: z.boolean().default(false),
});
export type ReturnDispensing = z.infer<typeof returnDispensingSchema>;

// -----------------------------------------------------------------------------
// Laboratory
// -----------------------------------------------------------------------------

export const orderLabTestsSchema = z.object({
  encounterId: uuidSchema,
  testIds: z.array(uuidSchema).min(1),
  clinicalIndication: z.string().max(2000).optional(),
  priority: z.enum(['ROUTINE', 'URGENT', 'STAT']).default('ROUTINE'),
  /**
   * Price per test, from the tariff in force on the service date.
   *
   * A lab test's price lives in the tariff, not on the test. A test left
   * unpriced is charged nothing and says so on the response, rather than
   * quietly appearing free.
   */
  pricesMinor: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export type OrderLabTests = z.infer<typeof orderLabTestsSchema>;

export const collectSampleSchema = z.object({
  labOrderItemId: uuidSchema,
  sampleType: z.string().min(2).max(100),
  container: z.string().max(100).optional(),
});
export type CollectSample = z.infer<typeof collectSampleSchema>;

export const rejectSampleSchema = z.object({
  /** The patient must be bled again, so the reason reaches the clinician. */
  reason: z.string().min(5).max(1000),
});

export const enterResultSchema = z
  .object({
    sampleId: uuidSchema,
    labTestId: uuidSchema,
    numericValue: z.number().optional(),
    textValue: z.string().max(2000).optional(),
    unit: z.string().max(50).optional(),
    comment: z.string().max(2000).optional(),
  })
  .superRefine((result, ctx) => {
    if (result.numericValue === undefined && !result.textValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['numericValue'],
        message: 'A result needs a value — a number or text.',
      });
    }
  });
export type EnterResult = z.infer<typeof enterResultSchema>;

export const verifyResultSchema = z.object({
  comment: z.string().max(2000).optional(),
});

export const acknowledgeResultSchema = z.object({
  /**
   * What was done about it.
   *
   * An acknowledgement with no action is a button press; the point is that
   * somebody saw the number and did something.
   */
  actionTaken: z.string().min(5).max(2000),
});

// -----------------------------------------------------------------------------
// Finance
// -----------------------------------------------------------------------------

export const openPeriodSchema = z.object({
  facilityId: uuidSchema,
  name: z.string().min(2).max(100),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
});
export type OpenPeriod = z.infer<typeof openPeriodSchema>;

export const closePeriodSchema = z.object({
  note: z.string().max(2000).optional(),
});

export const dailyCashSchema = z.object({
  facilityId: uuidSchema,
  date: isoDateSchema,
  countedClosingMinor: z.number().int().nonnegative(),
  /** Required when the drawer does not agree with the day. */
  note: z.string().max(2000).optional(),
});
export type DailyCash = z.infer<typeof dailyCashSchema>;

export const recordPatientPaymentSchema = z.object({
  facilityId: uuidSchema,
  patientId: uuidSchema.optional(),
  encounterId: uuidSchema.optional(),
  amountMinor: z.number().int().positive(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'MOBILE_MONEY', 'POS', 'INSURANCE', 'OTHER']),
  externalReference: z.string().max(200).optional(),
});
export type RecordPatientPayment = z.infer<typeof recordPatientPaymentSchema>;

// -----------------------------------------------------------------------------
// Billing (spec §§31-32)
//
// Charges are raised by the clinical and pharmacy paths as care happens. These
// are the three acts a cashier performs on them: bill for them, take the money,
// or decide the patient will not be asked for it.
// -----------------------------------------------------------------------------

export const raiseChargeSchema = z.object({
  facilityId: uuidSchema,
  encounterId: uuidSchema.optional(),
  description: z.string().min(2).max(200),
  quantity: z.number().positive().default(1),
  unitPriceMinor: z.number().int().nonnegative(),
  /** Which revenue account it belongs in. */
  kind: z
    .enum([
      'CONSULTATION',
      'LABORATORY',
      'PHARMACY',
      'PROCEDURE',
      'MATERNITY',
      'IMMUNISATION',
      'ADMISSION',
      'OTHER',
    ])
    .default('CONSULTATION'),
  serviceDate: isoDateSchema,
});
export type RaiseCharge = z.infer<typeof raiseChargeSchema>;

export const issueInvoiceSchema = z.object({
  facilityId: uuidSchema,
  patientId: uuidSchema.optional(),
  payerType: z.enum(['SELF_PAY', 'NHIS', 'HMO', 'EMPLOYER', 'GOVERNMENT', 'WAIVER']).default('SELF_PAY'),
  payerName: z.string().max(200).optional(),
  /** The charges this invoice bills for. An invoice with no charge bills nothing. */
  chargeIds: z.array(uuidSchema).min(1),
  dueDate: isoDateSchema.optional(),
  discountMinor: z.number().int().nonnegative().default(0),
});
export type IssueInvoice = z.infer<typeof issueInvoiceSchema>;

export const receivePaymentSchema = z.object({
  facilityId: uuidSchema,
  amountMinor: z.number().int().positive(),
  method: z.enum(['CASH', 'POS', 'BANK_TRANSFER', 'NHIS', 'HMO', 'WAIVER', 'OTHER']),
  externalReference: z.string().max(100).optional(),
  /**
   * Which invoices this money settles, and by how much.
   *
   * Explicit rather than inferred: money applied to whichever invoice happened
   * to be oldest is money a patient cannot reconcile against what they were
   * told they owed.
   */
  allocations: z
    .array(z.object({ invoiceId: uuidSchema, amountMinor: z.number().int().positive() }))
    .min(1),
  notes: z.string().max(1000).optional(),
});
export type ReceivePayment = z.infer<typeof receivePaymentSchema>;

export const waiveChargeSchema = z.object({
  chargeId: uuidSchema,
  /** Who decided, and why. A waiver with no reason is indistinguishable from a loss. */
  reason: z.string().min(10).max(1000),
});
export type WaiveCharge = z.infer<typeof waiveChargeSchema>;
