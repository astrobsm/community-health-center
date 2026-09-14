import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CommissioningCheckInput, RecordMaintenance } from '@chc/contracts';

import { ReasonRequiredError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import {
  assessReadiness,
  canAdvanceTo,
  readinessSummary,
  type CommissioningStatus,
} from './domain/commissioning';

/**
 * The asset register and commissioning (spec §22, acceptance criterion F).
 *
 * An asset becomes a resource the facility can actually offer only when every
 * commissioning check passes. Until then it is equipment the facility owns and
 * cannot use, and it is reported that way — because a government report
 * claiming a functioning theatre lamp that nobody is trained to use is a
 * promise the facility cannot keep.
 */
@Injectable()
export class AssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date();
  }

  async list(facilityId: string) {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const assets = await this.prisma.equipmentAsset.findMany({
      where: { facilityId, deletedAt: null },
      orderBy: { assetTag: 'asc' },
      select: {
        id: true,
        assetTag: true,
        name: true,
        category: true,
        serialNumber: true,
        costMinor: true,
        condition: true,
        commissioningStatus: true,
        purchaseDate: true,
        classification: true,
        goodsReceiptLine: {
          select: {
            goodsReceipt: {
              select: { reference: true, purchaseOrder: { select: { reference: true } } },
            },
          },
        },
        commissioning: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            reference: true,
            functionalTestPassed: true,
            safetyCheckPassed: true,
            staffTrained: true,
            consumablesAvailable: true,
            utilitiesConnected: true,
            commissionedAt: true,
          },
        },
      },
    });

    return {
      assets: assets.map((asset) => {
        const record = asset.commissioning[0];

        return {
          ...asset,
          costMinor: asset.costMinor?.toString() ?? null,
          commissioning: undefined,
          // The chain from the purchase that created it, so "why do we own
          // this?" is always answerable.
          provenance: asset.goodsReceiptLine
            ? {
                goodsReceipt: asset.goodsReceiptLine.goodsReceipt.reference,
                purchaseOrder: asset.goodsReceiptLine.goodsReceipt.purchaseOrder.reference,
              }
            : null,
          goodsReceiptLine: undefined,
          readiness: record
            ? assessReadiness(record)
            : {
                ready: false,
                passed: 0,
                total: 5,
                outstanding: [],
                summary: 'No commissioning record exists for this asset, so none of the checks have been done.',
              },
        };
      }),
      // Only commissioned assets count as capacity.
      serviceReadiness: readinessSummary(assets),
    };
  }

  /**
   * Record the commissioning checks.
   *
   * Each is a statement that somebody did something and it worked. The record
   * is kept whether or not everything passes, because a half-commissioned
   * asset with three checks done is a different situation from one nobody has
   * touched, and the difference is what a project manager needs to see.
   */
  async recordChecks(assetId: string, input: CommissioningCheckInput) {
    const asset = await this.load(assetId);
    const { organisationId } = getTenantScope();
    const context = tryGetContext();

    const readiness = assessReadiness(input);
    const count = await this.prisma.commissioningRecord.count({ where: { organisationId } });
    const reference = `COM-${String(count + 1).padStart(5, '0')}`;

    const record = await this.prisma.commissioningRecord.create({
      data: {
        organisationId,
        facilityId: asset.facilityId,
        assetId: asset.id,
        reference,
        functionalTestPassed: input.functionalTestPassed,
        safetyCheckPassed: input.safetyCheckPassed,
        staffTrained: input.staffTrained,
        consumablesAvailable: input.consumablesAvailable,
        utilitiesConnected: input.utilitiesConnected,
        witnessedBy: input.witnessedBy,
        notes: input.notes,
        createdBy: context?.userId,
      },
      select: { id: true, reference: true, createdAt: true },
    });

    await this.audit.record({
      action: 'asset.commissioning.record',
      entityType: 'commissioning_record',
      entityId: record.id,
      facilityId: asset.facilityId,
      newValue: {
        assetTag: asset.assetTag,
        passed: readiness.passed,
        outstanding: readiness.outstanding.map((check) => check.key),
      },
    });

    return {
      ...record,
      assetTag: asset.assetTag,
      readiness,
      // Said at the point of recording, so nobody has to go looking.
      nextStep: readiness.ready
        ? 'Every check passes. This asset may now be advanced to COMMISSIONED.'
        : `This asset cannot be commissioned until the outstanding checks pass: ${readiness.outstanding
            .map((check) => check.label.toLowerCase())
            .join(', ')}.`,
    };
  }

  /**
   * Move an asset along its commissioning progression.
   *
   * COMMISSIONED requires every check to pass — acceptance criterion F. The
   * database refuses it too, so this is not a matter of the application being
   * the only caller.
   */
  async advance(assetId: string, input: { status: string; reason?: string; roomId?: string }) {
    const asset = await this.load(assetId);
    const context = tryGetContext();

    const latest = await this.prisma.commissioningRecord.findFirst({
      where: { assetId: asset.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        functionalTestPassed: true,
        safetyCheckPassed: true,
        staffTrained: true,
        consumablesAvailable: true,
        utilitiesConnected: true,
      },
    });

    const checks = latest ?? {
      functionalTestPassed: false,
      safetyCheckPassed: false,
      staffTrained: false,
      consumablesAvailable: false,
      utilitiesConnected: false,
    };

    const decision = canAdvanceTo(
      input.status as CommissioningStatus,
      asset.commissioningStatus as CommissioningStatus,
      checks,
    );

    if (!decision.allowed) {
      await this.audit.record({
        action: 'asset.advance',
        entityType: 'equipment_asset',
        entityId: asset.id,
        facilityId: asset.facilityId,
        outcome: 'DENIED',
        newValue: { attempted: input.status, current: asset.commissioningStatus },
      });

      throw new BadRequestException(decision.reason);
    }

    if (input.status === 'DECOMMISSIONED' && (input.reason ?? '').trim().length < 10) {
      // An asset withdrawn from service without a stated cause cannot be
      // planned around, replaced, or claimed under warranty.
      throw new ReasonRequiredError(`Decommissioning ${asset.assetTag}`);
    }

    const commissionedAt = input.status === 'COMMISSIONED' ? this.now() : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.equipmentAsset.update({
        where: { id: asset.id },
        data: {
          commissioningStatus: input.status as never,
          roomId: input.roomId ?? undefined,
          notes: input.reason ?? undefined,
          updatedBy: context?.userId,
        },
        select: { id: true, assetTag: true, name: true, commissioningStatus: true, roomId: true },
      });

      if (commissionedAt && latest) {
        await tx.commissioningRecord.update({
          where: { id: latest.id },
          data: { commissionedAt, commissionedBy: context?.userId },
        });
      }

      return result;
    });

    await this.audit.record({
      action: 'asset.advance',
      entityType: 'equipment_asset',
      entityId: asset.id,
      facilityId: asset.facilityId,
      oldValue: { commissioningStatus: asset.commissioningStatus },
      newValue: { commissioningStatus: input.status },
      reason: input.reason,
      severity: input.status === 'COMMISSIONED' || input.status === 'DECOMMISSIONED' ? 'NOTICE' : 'INFO',
    });

    return {
      ...updated,
      ...(input.status === 'COMMISSIONED'
        ? { note: 'This asset now counts toward the facility service readiness.' }
        : {}),
    };
  }

  async recordMaintenance(input: RecordMaintenance) {
    const asset = await this.load(input.assetId);
    const { organisationId } = getTenantScope();
    const context = tryGetContext();

    const maintenance = await this.prisma.assetMaintenance.create({
      data: {
        assetId: asset.id,
        organisationId,
        facilityId: asset.facilityId,
        maintenanceType: input.maintenanceType,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
        performedOn: input.performedOn ? new Date(input.performedOn) : undefined,
        performedBy: input.performedBy,
        description: input.description,
        costMinor: input.costMinor !== undefined ? BigInt(input.costMinor) : undefined,
        outcome: input.outcome,
        nextDueOn: input.nextDueOn ? new Date(input.nextDueOn) : undefined,
        createdBy: context?.userId,
      },
      select: { id: true, maintenanceType: true, scheduledFor: true, performedOn: true, nextDueOn: true },
    });

    await this.audit.record({
      action: 'asset.maintenance.record',
      entityType: 'asset_maintenance',
      entityId: maintenance.id,
      facilityId: asset.facilityId,
      newValue: { assetTag: asset.assetTag, maintenanceType: input.maintenanceType },
    });

    return { ...maintenance, assetTag: asset.assetTag };
  }

  /** Maintenance that is due or overdue, derived on read from the dates (§10). */
  async maintenanceDue(facilityId: string) {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const rows = await this.prisma.assetMaintenance.findMany({
      where: { facilityId, nextDueOn: { not: null } },
      orderBy: { nextDueOn: 'asc' },
      select: {
        id: true,
        maintenanceType: true,
        nextDueOn: true,
        asset: { select: { assetTag: true, name: true, commissioningStatus: true } },
      },
    });

    const today = this.now();

    return rows.map((row) => ({
      ...row,
      overdue: Boolean(row.nextDueOn && row.nextDueOn < today),
      daysUntilDue: row.nextDueOn
        ? Math.ceil((row.nextDueOn.getTime() - today.getTime()) / 86_400_000)
        : null,
    }));
  }

  private async load(assetId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const asset = await this.prisma.equipmentAsset.findFirst({
      where: { id: assetId, organisationId, deletedAt: null },
      select: { id: true, facilityId: true, assetTag: true, name: true, commissioningStatus: true },
    });

    if (!asset || !facilityIds.includes(asset.facilityId)) {
      throw new NotFoundException('No such asset, or it is not visible to you.');
    }

    return asset;
  }
}
