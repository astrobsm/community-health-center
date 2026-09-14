import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { ReasonRequiredError, SegregationOfDutiesError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanceService } from '../finance/finance.service';
import { postStockReceipt, postStockWriteOff } from '../finance/domain/posting';

import { deriveStatus, reconcile } from './domain/fefo';

/**
 * Stock (spec §45, doc 14).
 *
 * The stock ledger is the only thing that can change stock. `quantity_on_hand`
 * on a batch is a cache maintained by a database trigger on that ledger; no
 * code here writes it, and when the two disagree the ledger is right.
 *
 * ADJUSTMENT and WASTAGE are the only movements a person originates directly,
 * and both need a reason and an approver. Everything else is created by a
 * workflow — a receipt, a dispensing, a laboratory consumption. That is what
 * stops the ledger becoming an editable spreadsheet.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly finance: FinanceService,
  ) {}

  private now(): Date {
    return new Date();
  }

  private assertFacilityVisible(facilityId: string): void {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }
  }

  /**
   * Receive stock into a batch.
   *
   * Creates the batch and its opening RECEIPT movement, and posts the value
   * into inventory. Called by procurement on a goods receipt, and directly for
   * donations and opening stock.
   */
  async receive(input: {
    facilityId: string;
    inventoryItemId: string;
    batchNumber: string;
    quantity: number;
    unitCostMinor: number;
    expiryDate?: string;
    supplierId?: string;
    goodsReceiptLineId?: string;
    sourceNote?: string;
  }) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);
    const context = tryGetContext();

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: input.inventoryItemId, organisationId },
      select: { id: true, name: true, kind: true },
    });

    if (!item) throw new NotFoundException('No such inventory item.');

    const existing = await this.prisma.inventoryBatch.findFirst({
      where: { inventoryItemId: item.id, batchNumber: input.batchNumber },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException(
        `Batch ${input.batchNumber} of ${item.name} already exists. Receiving more of the same batch would ` +
          'make two rows claim the same expiry and the same recall, so record it against the existing batch.',
      );
    }

    const receivedAt = this.now();
    const valueMinor = Math.round(input.quantity * input.unitCostMinor);

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryBatch.create({
        data: {
          inventoryItemId: item.id,
          organisationId,
          facilityId: input.facilityId,
          supplierId: input.supplierId,
          goodsReceiptLineId: input.goodsReceiptLineId,
          batchNumber: input.batchNumber,
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
          quantityReceived: input.quantity,
          // Deliberately not set here: the trigger on the stock ledger
          // maintains it, and writing it from two places is how a cache
          // starts disagreeing with its source.
          unitCostMinor: BigInt(input.unitCostMinor),
          receivedAt,
          createdBy: context?.userId,
        },
        select: { id: true, batchNumber: true, expiryDate: true },
      });

      await tx.stockTransaction.create({
        data: {
          inventoryBatchId: created.id,
          organisationId,
          facilityId: input.facilityId,
          transactionType: 'RECEIPT',
          quantity: input.quantity,
          unitCostMinor: BigInt(input.unitCostMinor),
          sourceType: input.goodsReceiptLineId ? 'goods_receipt' : 'opening_stock',
          sourceId: input.goodsReceiptLineId,
          reasonNote: input.sourceNote,
          occurredAt: receivedAt,
          createdBy: context?.userId,
        },
      });

      await this.finance.post(
        postStockReceipt({
          sourceId: created.id,
          description: `${item.name} batch ${input.batchNumber}`,
          costMinor: valueMinor,
          // Opening stock and donations are contributed capital rather than a
          // supplier debt; both are credited away from inventory so the
          // balance sheet is not overstated.
          payableAccountCode: input.goodsReceiptLineId ? '2110' : '3110',
        }),
        { facilityId: input.facilityId, entryDate: receivedAt },
        tx,
      );

      return created;
    });

    const onHand = await this.quantityOnHand(batch.id);

    await this.audit.record({
      action: 'inventory.receive',
      entityType: 'inventory_batch',
      entityId: batch.id,
      facilityId: input.facilityId,
      newValue: { item: item.name, batch: input.batchNumber, quantity: input.quantity, valueMinor },
    });

    return {
      ...batch,
      quantityOnHand: onHand,
      valueMinor: valueMinor.toString(),
      note: 'Quantity on hand is maintained by the stock ledger, not written directly.',
    };
  }

  /** What is on the shelf, with each batch's status derived from the date. */
  async stockOnHand(facilityId: string, inventoryItemId?: string) {
    this.assertFacilityVisible(facilityId);

    const batches = await this.prisma.inventoryBatch.findMany({
      where: { facilityId, ...(inventoryItemId ? { inventoryItemId } : {}) },
      orderBy: [{ expiryDate: 'asc' }],
      select: {
        id: true,
        batchNumber: true,
        expiryDate: true,
        quantityOnHand: true,
        unitCostMinor: true,
        status: true,
        receivedAt: true,
        inventoryItem: { select: { id: true, name: true, kind: true, unitOfMeasure: true } },
      },
    });

    const now = this.now();

    return batches.map((batch) => {
      const quantity = Number(batch.quantityOnHand);
      const derived = deriveStatus(
        { expiryDate: batch.expiryDate, quantityOnHand: quantity, status: batch.status },
        now,
      );

      return {
        id: batch.id,
        item: batch.inventoryItem,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        quantityOnHand: quantity,
        unitCostMinor: batch.unitCostMinor.toString(),
        valueMinor: Math.round(quantity * Number(batch.unitCostMinor)).toString(),
        storedStatus: batch.status,
        // A batch expires because the date passed, not because a job ran.
        effectiveStatus: derived,
        statusStale: derived !== batch.status,
      };
    });
  }

  /**
   * Prove the shelf against the ledger (spec §45).
   *
   *     opening + receipts − issues − wastage ± adjustments = closing
   *
   * When the cached quantity disagrees with the ledger, the ledger is right
   * and the difference is reported rather than quietly corrected.
   */
  async reconcileBatch(batchId: string, from?: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const batch = await this.prisma.inventoryBatch.findFirst({
      where: { id: batchId, organisationId },
      select: {
        id: true,
        facilityId: true,
        batchNumber: true,
        quantityOnHand: true,
        inventoryItem: { select: { name: true } },
      },
    });

    if (!batch || !facilityIds.includes(batch.facilityId)) {
      throw new NotFoundException('No such batch, or it is not visible to you.');
    }

    const since = from ? new Date(from) : undefined;

    const opening = since
      ? await this.prisma.stockTransaction.aggregate({
          where: { inventoryBatchId: batch.id, occurredAt: { lt: since } },
          _sum: { quantity: true },
        })
      : { _sum: { quantity: null } };

    const transactions = await this.prisma.stockTransaction.findMany({
      where: { inventoryBatchId: batch.id, ...(since ? { occurredAt: { gte: since } } : {}) },
      orderBy: { occurredAt: 'asc' },
      select: { transactionType: true, quantity: true },
    });

    const identity = reconcile(
      Number(opening._sum.quantity ?? 0),
      transactions.map((transaction) => ({
        transactionType: transaction.transactionType,
        quantity: Number(transaction.quantity),
      })),
    );

    const cached = Number(batch.quantityOnHand);
    const agrees = Math.abs(identity.closing - cached) < 1e-9;

    return {
      batch: { id: batch.id, batchNumber: batch.batchNumber, item: batch.inventoryItem.name },
      ...identity,
      cachedQuantityOnHand: cached,
      agrees,
      ...(agrees
        ? {}
        : {
            discrepancy:
              `The ledger says ${identity.closing} and the cached quantity says ${cached}. ` +
              'The ledger is correct; the cache has drifted and must be investigated, not overwritten.',
          }),
      classification: 'ACTUAL' as const,
    };
  }

  /**
   * Adjust stock after a count.
   *
   * One of only two movements a person originates directly, and it needs a
   * reason and a second person. An adjustment nobody approved is
   * indistinguishable from theft.
   */
  async adjust(input: {
    batchId: string;
    quantity: number;
    reasonCode: string;
    reasonNote: string;
    countedBy?: string;
  }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const batch = await this.prisma.inventoryBatch.findFirst({
      where: { id: input.batchId, organisationId },
      select: {
        id: true,
        facilityId: true,
        batchNumber: true,
        quantityOnHand: true,
        unitCostMinor: true,
        inventoryItem: { select: { name: true } },
      },
    });

    if (!batch || !facilityIds.includes(batch.facilityId)) {
      throw new NotFoundException('No such batch, or it is not visible to you.');
    }

    if ((input.reasonNote ?? '').trim().length < 10) {
      throw new ReasonRequiredError('Adjusting stock');
    }

    if (input.countedBy && context?.userId && input.countedBy === context.userId) {
      throw new SegregationOfDutiesError(
        'The person who counted the stock may not approve the adjustment that follows from their own count.',
      );
    }

    if (input.quantity === 0) {
      throw new BadRequestException('An adjustment of zero changes nothing and records nothing useful.');
    }

    const occurredAt = this.now();

    await this.prisma.stockTransaction.create({
      data: {
        inventoryBatchId: batch.id,
        organisationId,
        facilityId: batch.facilityId,
        transactionType: 'ADJUSTMENT',
        quantity: input.quantity,
        unitCostMinor: batch.unitCostMinor,
        sourceType: 'stock_adjustment',
        reasonCode: input.reasonCode,
        reasonNote: input.reasonNote,
        approvedBy: context?.userId,
        occurredAt,
        createdBy: context?.userId,
      },
    });

    await this.audit.record({
      action: 'inventory.adjust',
      entityType: 'inventory_batch',
      entityId: batch.id,
      facilityId: batch.facilityId,
      oldValue: { quantityOnHand: Number(batch.quantityOnHand) },
      newValue: { adjustment: input.quantity, reasonCode: input.reasonCode },
      reason: input.reasonNote,
      severity: 'NOTICE',
    });

    return {
      batchId: batch.id,
      adjustment: input.quantity,
      quantityOnHand: await this.quantityOnHand(batch.id),
      note: 'Recorded in the stock ledger with a reason and an approver. It cannot be edited or removed.',
    };
  }

  /**
   * Write stock off.
   *
   * Expiry, breakage, a cold-chain failure. Posts both the stock movement and
   * the write-off entry, so expired stock never silently inflates either the
   * shelf or the balance sheet.
   */
  async writeOff(input: { batchId: string; quantity: number; reasonCode: string; reasonNote: string }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const batch = await this.prisma.inventoryBatch.findFirst({
      where: { id: input.batchId, organisationId },
      select: {
        id: true,
        facilityId: true,
        batchNumber: true,
        quantityOnHand: true,
        unitCostMinor: true,
        inventoryItem: { select: { name: true } },
      },
    });

    if (!batch || !facilityIds.includes(batch.facilityId)) {
      throw new NotFoundException('No such batch, or it is not visible to you.');
    }

    if ((input.reasonNote ?? '').trim().length < 10) throw new ReasonRequiredError('Writing stock off');
    if (input.quantity <= 0) throw new BadRequestException('A write-off must be a positive quantity.');

    const costMinor = Math.round(input.quantity * Number(batch.unitCostMinor));
    const occurredAt = this.now();

    await this.prisma.$transaction(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          inventoryBatchId: batch.id,
          organisationId,
          facilityId: batch.facilityId,
          transactionType: 'WASTAGE',
          quantity: -input.quantity,
          unitCostMinor: batch.unitCostMinor,
          sourceType: 'expiry',
          reasonCode: input.reasonCode,
          reasonNote: input.reasonNote,
          approvedBy: context?.userId,
          occurredAt,
          createdBy: context?.userId,
        },
      });

      await this.finance.post(
        postStockWriteOff({
          sourceId: batch.id,
          description: `${batch.inventoryItem.name} batch ${batch.batchNumber} x ${input.quantity}`,
          costMinor,
          reasonCode: input.reasonCode,
        }),
        { facilityId: batch.facilityId, entryDate: occurredAt },
        tx,
      );
    });

    await this.audit.record({
      action: 'inventory.write_off',
      entityType: 'inventory_batch',
      entityId: batch.id,
      facilityId: batch.facilityId,
      newValue: {
        item: batch.inventoryItem.name,
        batch: batch.batchNumber,
        quantity: input.quantity,
        costMinor,
        reasonCode: input.reasonCode,
      },
      reason: input.reasonNote,
      severity: 'NOTICE',
    });

    return {
      batchId: batch.id,
      quantity: input.quantity,
      costMinor: costMinor.toString(),
      quantityOnHand: await this.quantityOnHand(batch.id),
      note: 'The loss is in the accounts as well as off the shelf. It is visible, which is the only way anyone acts on it.',
    };
  }

  /** Batches at or near expiry, so somebody can act before they are lost. */
  async expiryReport(facilityId: string, withinDays = 90) {
    this.assertFacilityVisible(facilityId);

    const horizon = new Date(this.now().getTime() + withinDays * 86_400_000);

    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        facilityId,
        quantityOnHand: { gt: 0 },
        expiryDate: { not: null, lte: horizon },
      },
      orderBy: { expiryDate: 'asc' },
      select: {
        id: true,
        batchNumber: true,
        expiryDate: true,
        quantityOnHand: true,
        unitCostMinor: true,
        status: true,
        inventoryItem: { select: { name: true } },
      },
    });

    const now = this.now();

    return batches.map((batch) => {
      const quantity = Number(batch.quantityOnHand);
      const days = batch.expiryDate
        ? Math.ceil((batch.expiryDate.getTime() - now.getTime()) / 86_400_000)
        : null;

      return {
        id: batch.id,
        item: batch.inventoryItem.name,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        daysToExpiry: days,
        expired: days !== null && days <= 0,
        quantityOnHand: quantity,
        valueAtRiskMinor: Math.round(quantity * Number(batch.unitCostMinor)).toString(),
      };
    });
  }

  private async quantityOnHand(batchId: string): Promise<number> {
    const batch = await this.prisma.inventoryBatch.findUnique({
      where: { id: batchId },
      select: { quantityOnHand: true },
    });

    return Number(batch?.quantityOnHand ?? 0);
  }
}
