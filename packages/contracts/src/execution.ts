import { z } from 'zod';

import { isoDateSchema, uuidSchema } from './common.js';

/** Project execution, procurement and assets (spec §§21-22, 46). */

// -----------------------------------------------------------------------------
// Projects
// -----------------------------------------------------------------------------

export const createProjectSchema = z.object({
  id: uuidSchema.optional(),
  facilityId: uuidSchema,
  /** What this project exists to deliver. Its absence must be justified. */
  recommendationId: uuidSchema.optional(),
  capexLineId: uuidSchema.optional(),
  name: z.string().min(3).max(300),
  description: z.string().max(4000).optional(),
  /** The same categories CAPEX uses, so a project and its funding line agree. */
  category: z.enum([
    'BUILDING',
    'EQUIPMENT',
    'LABORATORY',
    'PHARMACY',
    'FURNITURE',
    'ICT',
    'POWER',
    'WATER',
    'SECURITY',
    'WASTE',
    'INITIAL_STOCK',
    'WORKING_CAPITAL',
    'TRAINING',
    'CONTINGENCY',
  ]),
  priorityClass: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
  plannedStart: isoDateSchema.optional(),
  plannedEnd: isoDateSchema.optional(),
  /** Required when the project traces to no recommendation. */
  unlinkedReason: z.string().min(10).max(1000).optional(),
});
export type CreateProject = z.infer<typeof createProjectSchema>;

export const createPhaseSchema = z.object({
  id: uuidSchema.optional(),
  projectId: uuidSchema,
  name: z.string().min(2).max(200),
  sequence: z.number().int().min(1).max(100),
  plannedStart: isoDateSchema.optional(),
  plannedEnd: isoDateSchema.optional(),
});
export type CreatePhase = z.infer<typeof createPhaseSchema>;

export const createTaskSchema = z.object({
  id: uuidSchema.optional(),
  phaseId: uuidSchema,
  name: z.string().min(2).max(300),
  description: z.string().max(2000).optional(),
  /** Relative contribution to completion. Equal weights make a slab equal a kettle. */
  weight: z.number().positive().max(1000).default(1),
  estimatedDays: z.number().nonnegative().max(3650).default(1),
  ownerUserId: uuidSchema.optional(),
  plannedStart: isoDateSchema.optional(),
  plannedEnd: isoDateSchema.optional(),
  /** Predecessors, by task id. A cycle is refused. */
  dependsOn: z
    .array(
      z.object({
        predecessorId: uuidSchema,
        dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
        lagDays: z.number().int().min(-365).max(365).default(0),
      }),
    )
    .default([]),
});
export type CreateTask = z.infer<typeof createTaskSchema>;

export const updateTaskProgressSchema = z.object({
  percentComplete: z.number().min(0).max(100),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']).optional(),
  /** Required to cancel or block: a stalled task with no stated cause cannot be unstuck. */
  note: z.string().max(2000).optional(),
});

// -----------------------------------------------------------------------------
// Procurement
// -----------------------------------------------------------------------------

export const createPurchaseRequestSchema = z.object({
  id: uuidSchema.optional(),
  facilityId: uuidSchema,
  projectId: uuidSchema.optional(),
  title: z.string().min(3).max(300),
  justification: z.string().max(2000).optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(2).max(500),
        quantity: z.number().positive(),
        unit: z.string().max(50).optional(),
        estimatedUnitCostMinor: z.number().int().nonnegative().optional(),
        /** Capital items become assets on receipt; consumables become stock. */
        isCapitalItem: z.boolean().default(false),
      }),
    )
    .min(1),
});
export type CreatePurchaseRequest = z.infer<typeof createPurchaseRequestSchema>;

export const decideRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(1000).optional(),
});

export const createQuotationSchema = z.object({
  purchaseRequestId: uuidSchema,
  supplierId: uuidSchema,
  reference: z.string().max(100).optional(),
  validUntil: isoDateSchema.optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(2).max(500),
        quantity: z.number().positive(),
        unitPriceMinor: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});
export type CreateQuotation = z.infer<typeof createQuotationSchema>;

export const selectQuotationSchema = z.object({
  /**
   * Required when the chosen quotation is not the cheapest.
   *
   * Selecting other than the lowest without a reason is exactly what a
   * procurement audit looks for (doc 14 §7).
   */
  selectionReason: z.string().max(1000).optional(),
});

export const createPurchaseOrderSchema = z.object({
  purchaseRequestId: uuidSchema,
  quotationId: uuidSchema,
  orderedOn: isoDateSchema,
  expectedDelivery: isoDateSchema.optional(),
  terms: z.string().max(2000).optional(),
});
export type CreatePurchaseOrder = z.infer<typeof createPurchaseOrderSchema>;

export const createGoodsReceiptSchema = z.object({
  id: uuidSchema.optional(),
  purchaseOrderId: uuidSchema,
  receivedOn: isoDateSchema,
  deliveryNoteRef: z.string().max(100).optional(),
  inspectionNote: z.string().max(2000).optional(),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: uuidSchema.optional(),
        description: z.string().min(2).max(500),
        quantityReceived: z.number().positive(),
        quantityAccepted: z.number().nonnegative(),
        quantityRejected: z.number().nonnegative().default(0),
        /** Required whenever anything is rejected. */
        rejectionReason: z.string().max(1000).optional(),
        unitCostMinor: z.number().int().nonnegative(),
        batchNumber: z.string().max(100).optional(),
        expiryDate: isoDateSchema.optional(),
        isCapitalItem: z.boolean().default(false),
        /** Serial numbers for capital items, one per unit received. */
        serialNumbers: z.array(z.string().max(100)).default([]),
      }),
    )
    .min(1),
});
export type CreateGoodsReceipt = z.infer<typeof createGoodsReceiptSchema>;

export const createSupplierInvoiceSchema = z.object({
  supplierId: uuidSchema,
  purchaseOrderId: uuidSchema,
  invoiceNumber: z.string().min(1).max(100),
  invoiceDate: isoDateSchema,
  dueDate: isoDateSchema.optional(),
  amountMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative().default(0),
  totalMinor: z.number().int().nonnegative(),
});
export type CreateSupplierInvoice = z.infer<typeof createSupplierInvoiceSchema>;

export const paySupplierInvoiceSchema = z.object({
  amountMinor: z.number().int().positive(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'MOBILE_MONEY', 'POS', 'INSURANCE', 'OTHER']),
  paidOn: isoDateSchema.optional(),
  externalReference: z.string().max(200).optional(),
  /** Required when a flagged variance has to be accepted to release payment. */
  varianceApprovalReason: z.string().max(1000).optional(),
});

// -----------------------------------------------------------------------------
// Assets and commissioning
// -----------------------------------------------------------------------------

export const createSupplierSchema = z.object({
  name: z.string().min(2).max(300),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().max(200).optional(),
  contactPhone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  taxIdentifier: z.string().max(100).optional(),
});
export type CreateSupplier = z.infer<typeof createSupplierSchema>;

export const commissioningCheckSchema = z.object({
  functionalTestPassed: z.boolean().default(false),
  safetyCheckPassed: z.boolean().default(false),
  staffTrained: z.boolean().default(false),
  consumablesAvailable: z.boolean().default(false),
  utilitiesConnected: z.boolean().default(false),
  witnessedBy: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type CommissioningCheckInput = z.infer<typeof commissioningCheckSchema>;

export const advanceAssetSchema = z.object({
  status: z.enum(['RECEIVED', 'INSTALLED', 'TESTED', 'COMMISSIONED', 'DECOMMISSIONED']),
  /** Required to decommission: an asset withdrawn from service without a stated cause cannot be planned around. */
  reason: z.string().max(1000).optional(),
  roomId: uuidSchema.optional(),
});

export const recordMaintenanceSchema = z.object({
  assetId: uuidSchema,
  maintenanceType: z.enum(['PREVENTIVE', 'CORRECTIVE', 'CALIBRATION', 'INSPECTION']),
  scheduledFor: isoDateSchema.optional(),
  performedOn: isoDateSchema.optional(),
  performedBy: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  costMinor: z.number().int().nonnegative().optional(),
  outcome: z.string().max(1000).optional(),
  nextDueOn: isoDateSchema.optional(),
});
export type RecordMaintenance = z.infer<typeof recordMaintenanceSchema>;
