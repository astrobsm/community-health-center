import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { InsufficientStockError, ReasonRequiredError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { FinanceService } from '../finance/finance.service';
import { postCharge, postStockIssue } from '../finance/domain/posting';

import { selectFefo, type SelectableBatch } from './domain/fefo';

/**
 * Dispensing (spec §30, acceptance criterion H).
 *
 * One database transaction writes: the stock movements, the dispensing
 * records, the charge, and the journal entries for revenue and cost of goods.
 * All of it, or none of it.
 *
 * That is not tidiness. A dispensing that reduced stock but failed to raise a
 * charge is a medicine given away; one that charged but failed to move stock
 * is a shelf that disagrees with the ledger. Both are discovered weeks later,
 * by which time nobody can reconstruct what happened.
 */
@Injectable()
export class PharmacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly finance: FinanceService,
    private readonly config: ConfigService,
  ) {}

  private now(): Date {
    return new Date();
  }

  /** What FEFO would choose, before anything is dispensed. */
  async preview(input: { facilityId: string; inventoryItemId: string; quantity: number }) {
    const { facilityIds } = getTenantScope();

    if (!facilityIds.includes(input.facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const batches = await this.batchesFor(input.facilityId, input.inventoryItemId);
    const nearExpiryDays = await this.config.get<number>('inventory.nearExpiryDays', 90, input.facilityId);

    return selectFefo(batches, input.quantity, this.now(), { nearExpiryDays });
  }

  /**
   * Dispense against a prescription item.
   *
   * FEFO chooses the batches. A pharmacist may override, but must say why —
   * the honest reasons (a shorter course, a damaged strip) are easy to give at
   * the counter and impossible to reconstruct afterwards.
   */
  async dispense(input: {
    prescriptionItemId: string;
    quantity: number;
    unitPriceMinor: number;
    batchId?: string;
    fefoOverrideReason?: string;
  }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const item = await this.prisma.prescriptionItem.findFirst({
      where: { id: input.prescriptionItemId, organisationId },
      select: {
        id: true,
        facilityId: true,
        quantityPrescribed: true,
        medicationName: true,
        medication: { select: { id: true, inventoryItemId: true } },
        prescription: {
          select: {
            id: true,
            status: true,
            encounterId: true,
            encounter: { select: { id: true, patientId: true, facilityId: true } },
          },
        },
        dispensings: { select: { quantity: true, isReturned: true } },
      },
    });

    if (!item || !facilityIds.includes(item.facilityId)) {
      throw new NotFoundException('No such prescription item, or it is not visible to you.');
    }

    const inventoryItemId = item.medication?.inventoryItemId ?? null;

    if (!inventoryItemId) {
      throw new BadRequestException(
        `"${item.medicationName}" is not linked to a stock item, so dispensing it cannot move stock. ` +
          'Link the medication to its inventory item first.',
      );
    }

    const alreadyDispensed = item.dispensings
      .filter((dispensing) => !dispensing.isReturned)
      .reduce((sum, dispensing) => sum + Number(dispensing.quantity), 0);

    const outstanding = Number(item.quantityPrescribed) - alreadyDispensed;

    if (input.quantity > outstanding) {
      throw new BadRequestException(
        `${Number(item.quantityPrescribed)} were prescribed and ${alreadyDispensed} already dispensed; ` +
          `${input.quantity} would exceed the prescription by ${input.quantity - outstanding}.`,
      );
    }

    const batches = await this.batchesFor(item.facilityId, inventoryItemId);
    const nearExpiryDays = await this.config.get<number>('inventory.nearExpiryDays', 90, item.facilityId);

    // An override still runs through FEFO, so the pharmacist sees what they
    // are passing over and the record shows what was chosen instead.
    const selection = input.batchId
      ? selectFefo(
          batches.filter((batch) => batch.id === input.batchId),
          input.quantity,
          this.now(),
          { nearExpiryDays },
        )
      : selectFefo(batches, input.quantity, this.now(), { nearExpiryDays });

    if (input.batchId && (input.fefoOverrideReason ?? '').trim().length < 5) {
      const wouldHaveChosen = selectFefo(batches, input.quantity, this.now(), { nearExpiryDays });

      if (wouldHaveChosen.allocations[0]?.batchId !== input.batchId) {
        throw new ReasonRequiredError(
          `Dispensing from batch ${input.batchId} when FEFO would have chosen ` +
            `${wouldHaveChosen.allocations[0]?.batchNumber ?? 'another batch'}`,
        );
      }
    }

    if (selection.shortfall > 0) {
      throw new InsufficientStockError(
        item.medicationName,
        selection.allocatedQuantity,
        input.quantity,
      );
    }

    const serviceDate = this.now();
    const amountMinor = Math.round(input.quantity * input.unitPriceMinor);

    // One transaction. Stock, charge and ledger move together or not at all.
    const result = await this.prisma.$transaction(async (tx) => {
      const charge = await tx.charge.create({
        data: {
          organisationId,
          facilityId: item.facilityId,
          encounterId: item.prescription.encounterId,
          description: `${item.medicationName} x ${input.quantity}`,
          quantity: input.quantity,
          unitPriceMinor: BigInt(input.unitPriceMinor),
          amountMinor: BigInt(amountMinor),
          serviceDate,
          status: 'RAISED',
          classification: 'ACTUAL',
          createdBy: context?.userId,
        },
        select: { id: true, amountMinor: true, description: true },
      });

      const dispensings: Array<{ id: string; batchNumber: string; quantity: number }> = [];

      for (const allocation of selection.allocations) {
        // The stock ledger is the only thing that can change stock, and the
        // trigger on it maintains quantity_on_hand and refuses to let a batch
        // go negative.
        await tx.stockTransaction.create({
          data: {
            inventoryBatchId: allocation.batchId,
            organisationId,
            facilityId: item.facilityId,
            transactionType: 'ISSUE',
            quantity: -allocation.quantity,
            unitCostMinor: BigInt(allocation.unitCostMinor),
            sourceType: 'dispensing',
            sourceId: item.id,
            occurredAt: serviceDate,
            createdBy: context?.userId,
          },
        });

        const dispensing = await tx.dispensing.create({
          data: {
            id: randomUUID(),
            prescriptionItemId: item.id,
            inventoryBatchId: allocation.batchId,
            organisationId,
            facilityId: item.facilityId,
            quantity: allocation.quantity,
            unitPriceMinor: BigInt(input.unitPriceMinor),
            dispensedBy: context?.userId,
            dispensedAt: serviceDate,
            chargeId: charge.id,
            stockCertainty: 'ACTUAL',
            fefoOverrideReason: input.fefoOverrideReason,
            createdBy: context?.userId,
          },
          select: { id: true },
        });

        dispensings.push({
          id: dispensing.id,
          batchNumber: allocation.batchNumber,
          quantity: allocation.quantity,
        });
      }

      // Revenue, and separately the cost of what left the shelf. Never netted:
      // a facility needs to know both, and one figure answers neither.
      const revenueEntry = await this.finance.post(
        postCharge({
          chargeId: charge.id,
          description: charge.description,
          amountMinor: Number(charge.amountMinor),
          kind: 'PHARMACY',
        }),
        { facilityId: item.facilityId, entryDate: serviceDate },
        tx,
      );

      const costEntry = await this.finance.post(
        postStockIssue({
          sourceType: 'dispensing',
          sourceId: item.id,
          description: charge.description,
          costMinor: selection.totalValueMinor,
          itemKind: 'MEDICINE',
        }),
        { facilityId: item.facilityId, entryDate: serviceDate },
        tx,
      );

      const totalDispensed = alreadyDispensed + input.quantity;

      await tx.prescription.update({
        where: { id: item.prescription.id },
        data: {
          status: totalDispensed >= Number(item.quantityPrescribed) ? 'DISPENSED' : 'PARTIALLY_DISPENSED',
        },
      });

      return { charge, dispensings, revenueEntry, costEntry };
    });

    await this.audit.record({
      action: 'pharmacy.dispense',
      entityType: 'dispensing',
      entityId: result.dispensings[0]?.id,
      facilityId: item.facilityId,
      newValue: {
        medication: item.medicationName,
        quantity: input.quantity,
        batches: result.dispensings.map((dispensing) => dispensing.batchNumber),
        chargeMinor: amountMinor,
        costMinor: selection.totalValueMinor,
        fefoOverridden: Boolean(input.batchId),
      },
      reason: input.fefoOverrideReason,
      severity: 'NOTICE',
    });

    return {
      dispensings: result.dispensings,
      charge: { id: result.charge.id, amountMinor: amountMinor.toString() },
      costMinor: selection.totalValueMinor.toString(),
      marginMinor: (amountMinor - selection.totalValueMinor).toString(),
      journalEntries: [result.revenueEntry.reference, result.costEntry.reference],
      warnings: selection.allocations
        .filter((allocation) => allocation.nearExpiryWarning)
        .map((allocation) => `${allocation.batchNumber}: ${allocation.nearExpiryWarning}`),
      note: 'Stock, charge and ledger were written in one transaction. Either all of it happened or none of it did.',
    };
  }

  /**
   * A patient returns medicine.
   *
   * The stock goes back only if it can be trusted — a strip that left the
   * counter and came back cannot be re-dispensed on the word of the person
   * returning it, so the default is to take it back into quarantine rather
   * than into saleable stock.
   */
  async recordReturn(input: { dispensingId: string; quantity: number; reason: string; restockable: boolean }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const dispensing = await this.prisma.dispensing.findFirst({
      where: { id: input.dispensingId, organisationId },
      select: {
        id: true,
        facilityId: true,
        quantity: true,
        inventoryBatchId: true,
        isReturned: true,
        chargeId: true,
        prescriptionItem: { select: { medicationName: true } },
      },
    });

    if (!dispensing || !facilityIds.includes(dispensing.facilityId)) {
      throw new NotFoundException('No such dispensing record, or it is not visible to you.');
    }

    if (dispensing.isReturned) {
      throw new BadRequestException('This dispensing has already been returned.');
    }

    if ((input.reason ?? '').trim().length < 5) {
      throw new ReasonRequiredError('Recording a returned medicine');
    }

    if (input.quantity > Number(dispensing.quantity)) {
      throw new BadRequestException(
        `${Number(dispensing.quantity)} were dispensed; ${input.quantity} cannot be returned.`,
      );
    }

    if (!dispensing.inventoryBatchId) {
      throw new BadRequestException('This dispensing has no batch recorded, so a return cannot be placed anywhere.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          inventoryBatchId: dispensing.inventoryBatchId!,
          organisationId,
          facilityId: dispensing.facilityId,
          transactionType: 'RETURN',
          quantity: input.quantity,
          sourceType: 'dispensing',
          sourceId: dispensing.id,
          reasonCode: 'PATIENT_RETURN',
          reasonNote: input.reason,
          approvedBy: context?.userId,
          occurredAt: this.now(),
          createdBy: context?.userId,
        },
      });

      if (!input.restockable) {
        // Straight back out again as wastage. Returned medicine whose storage
        // nobody can vouch for is not stock, and putting it back on the shelf
        // to keep a number tidy is how a patient receives something spoiled.
        await tx.stockTransaction.create({
          data: {
            inventoryBatchId: dispensing.inventoryBatchId!,
            organisationId,
            facilityId: dispensing.facilityId,
            transactionType: 'WASTAGE',
            quantity: -input.quantity,
            sourceType: 'dispensing',
            sourceId: dispensing.id,
            reasonCode: 'RETURNED_NOT_RESTOCKABLE',
            reasonNote: `Returned by the patient and not fit to re-dispense. ${input.reason}`,
            approvedBy: context?.userId,
            occurredAt: this.now(),
            createdBy: context?.userId,
          },
        });
      }

      await tx.dispensing.update({ where: { id: dispensing.id }, data: { isReturned: true } });
    });

    await this.audit.record({
      action: 'pharmacy.return',
      entityType: 'dispensing',
      entityId: dispensing.id,
      facilityId: dispensing.facilityId,
      newValue: {
        medication: dispensing.prescriptionItem.medicationName,
        quantity: input.quantity,
        restocked: input.restockable,
      },
      reason: input.reason,
      severity: 'NOTICE',
    });

    return {
      dispensingId: dispensing.id,
      quantity: input.quantity,
      restocked: input.restockable,
      note: input.restockable
        ? 'Returned to saleable stock.'
        : 'Taken back and written off. It is not on the shelf, and the loss is visible in the accounts.',
    };
  }

  private async batchesFor(facilityId: string, inventoryItemId: string): Promise<SelectableBatch[]> {
    const batches = await this.prisma.inventoryBatch.findMany({
      where: { facilityId, inventoryItemId },
      orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
      select: {
        id: true,
        batchNumber: true,
        expiryDate: true,
        quantityOnHand: true,
        unitCostMinor: true,
        status: true,
        receivedAt: true,
      },
    });

    return batches.map((batch) => ({
      id: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantityOnHand: Number(batch.quantityOnHand),
      unitCostMinor: Number(batch.unitCostMinor),
      status: batch.status,
      receivedAt: batch.receivedAt,
    }));
  }
}
