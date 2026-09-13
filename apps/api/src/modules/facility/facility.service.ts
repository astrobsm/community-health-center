import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { canTransition, type FacilityLifecycleStage } from '@chc/contracts';

import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class FacilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const { organisationId, facilityIds } = getTenantScope();

    const facilities = await this.prisma.facility.findMany({
      where: { organisationId, id: { in: [...facilityIds] }, deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        lifecycleStage: true,
        baselineDate: true,
        goLiveDate: true,
        facilityType: { select: { code: true, name: true } },
        location: { select: { state: true, lga: true, ward: true, town: true } },
      },
    });

    return facilities.map((facility) => ({
      ...facility,
      baselineDate: facility.baselineDate?.toISOString().slice(0, 10) ?? null,
      goLiveDate: facility.goLiveDate?.toISOString().slice(0, 10) ?? null,
    }));
  }

  async get(facilityId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const facility = await this.prisma.facility.findFirst({
      where: { id: facilityId, organisationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        code: true,
        lifecycleStage: true,
        baselineDate: true,
        goLiveDate: true,
        facilityType: { select: { code: true, name: true } },
        location: true,
        departments: { select: { id: true, code: true, name: true }, where: { deletedAt: null } },
        _count: { select: { assessments: true, baselineSnapshots: true } },
      },
    });

    // Out of scope and not found answer identically, so the existence of
    // another facility's record is never disclosed (doc 06 §5).
    if (!facility || !facilityIds.includes(facility.id)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    return facility;
  }

  /**
   * Advance the facility lifecycle.
   *
   * Forward-only, gated by preconditions, and recorded as an append-only
   * transition with a reason. Going "backwards" is a new row, never a deletion:
   * the history of how a facility got where it is IS the institutional memory
   * (doc 00 §4).
   */
  async transitionStage(facilityId: string, toStage: FacilityLifecycleStage, reason?: string) {
    const facility = await this.get(facilityId);
    const fromStage = facility.lifecycleStage as FacilityLifecycleStage;

    if (fromStage === toStage) {
      throw new BadRequestException(`This facility is already at stage ${toStage}.`);
    }

    if (!canTransition(fromStage, toStage)) {
      throw new BadRequestException(
        `A facility cannot move from ${fromStage} to ${toStage}. ` +
          'The lifecycle is forward-only; see docs/architecture/00-product-architecture.md §4.',
      );
    }

    await this.assertPreconditions(facilityId, toStage);

    const context = tryGetContext();

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.facility.update({
        where: { id: facilityId },
        data: { lifecycleStage: toStage },
        select: { id: true, lifecycleStage: true },
      });

      await tx.facilityStageTransition.create({
        data: {
          facilityId,
          organisationId: getTenantScope().organisationId,
          fromStage,
          toStage,
          reason,
          performedBy: context?.userId,
        },
      });

      return result;
    });

    await this.audit.record({
      action: 'facility.transition_stage',
      entityType: 'facility',
      entityId: facilityId,
      oldValue: { lifecycleStage: fromStage },
      newValue: { lifecycleStage: toStage },
      reason,
      severity: 'NOTICE',
    });

    return updated;
  }

  /**
   * Preconditions for entering a stage.
   *
   * These are deliberately about EVIDENCE rather than intent: a facility enters
   * BASELINE_ESTABLISHED because a baseline was sealed, not because someone
   * decided it had.
   */
  private async assertPreconditions(facilityId: string, toStage: FacilityLifecycleStage): Promise<void> {
    switch (toStage) {
      case 'DUE_DILIGENCE': {
        const submitted = await this.prisma.facilityAssessment.count({
          where: { facilityId, assessmentType: 'PRE_ASSESSMENT', status: { in: ['SUBMITTED', 'VERIFIED'] } },
        });
        if (submitted === 0) {
          throw new BadRequestException(
            'A submitted pre-assessment is required before due diligence can begin.',
          );
        }
        return;
      }

      case 'BASELINE_ESTABLISHED': {
        const sealed = await this.prisma.baselineSnapshot.count({ where: { facilityId } });
        if (sealed === 0) {
          throw new BadRequestException(
            'A sealed baseline is required. Complete and submit a field assessment, then seal the baseline from it.',
          );
        }
        return;
      }

      case 'PLANNING': {
        const sealed = await this.prisma.baselineSnapshot.count({ where: { facilityId } });
        if (sealed === 0) {
          throw new BadRequestException('Planning requires a sealed baseline to plan against.');
        }
        return;
      }

      default:
        // Later stages gain their preconditions as the releases that own them
        // land. Left explicit rather than silently permissive.
        return;
    }
  }

  async stageHistory(facilityId: string) {
    await this.get(facilityId); // scope check

    return this.prisma.facilityStageTransition.findMany({
      where: { facilityId },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, fromStage: true, toStage: true, reason: true, occurredAt: true, performedBy: true },
    });
  }
}
