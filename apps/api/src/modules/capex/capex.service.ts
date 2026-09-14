import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateCapexLine } from '@chc/contracts';

import { ReasonRequiredError, SegregationOfDutiesError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Capital planning (spec §19).
 *
 * Where a recommendation becomes money. Two properties matter more than any
 * feature here:
 *
 *  - Nothing stores a total. A plan's value is the sum of its lines, read from
 *    the lines (§10), and the database constrains each line's estimate to
 *    agree with its own quantity and rate.
 *  - An estimate is never quietly promoted to a price. It stays ESTIMATED
 *    until somebody other than its author approves it, with a reason if the
 *    figure changed (§82).
 */
@Injectable()
export class CapexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

  // ---------------------------------------------------------------------------
  // CAPEX
  // ---------------------------------------------------------------------------

  async createCapexPlan(input: { facilityId: string; name: string; notes?: string }) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const previous = await this.prisma.capexPlan.findFirst({
      where: { facilityId: input.facilityId, name: input.name },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const context = tryGetContext();

    // A new version rather than an edit: an approved plan is what a government
    // partner was shown, and it must remain readable afterwards.
    const plan = await this.prisma.capexPlan.create({
      data: {
        facilityId: input.facilityId,
        organisationId,
        name: input.name,
        versionNumber: (previous?.versionNumber ?? 0) + 1,
        notes: input.notes,
        createdBy: context?.userId,
      },
      select: { id: true, name: true, versionNumber: true, status: true, currency: true },
    });

    await this.audit.record({
      action: 'planning.capex_plan.create',
      entityType: 'capex_plan',
      entityId: plan.id,
      facilityId: input.facilityId,
      newValue: { name: plan.name, versionNumber: plan.versionNumber },
    });

    return plan;
  }

  async addCapexLine(input: CreateCapexLine) {
    const { organisationId } = getTenantScope();

    const plan = await this.prisma.capexPlan.findFirst({
      where: { id: input.capexPlanId, organisationId },
      select: { id: true, facilityId: true, status: true, name: true },
    });

    if (!plan) throw new NotFoundException('No such CAPEX plan, or it is not visible to you.');
    this.assertFacilityVisible(plan.facilityId);

    if (plan.status === 'APPROVED') {
      throw new BadRequestException(
        `"${plan.name}" is approved. Create a new version of the plan rather than adding to the approved one.`,
      );
    }

    if (input.recommendationId) {
      const recommendation = await this.prisma.recommendation.findFirst({
        where: { id: input.recommendationId, organisationId },
        select: { id: true, facilityId: true },
      });

      if (!recommendation || recommendation.facilityId !== plan.facilityId) {
        throw new NotFoundException('No such recommendation at this facility.');
      }
    }

    const unitCost = BigInt(input.unitCostMinor);
    // Matches the database CHECK exactly, so the two can never disagree about
    // what this line costs.
    const estimated = BigInt(Math.round(input.quantity * Number(unitCost)));

    const context = tryGetContext();

    const line = await this.prisma.capexLine.create({
      data: {
        id: input.id ?? randomUUID(),
        capexPlanId: plan.id,
        recommendationId: input.recommendationId,
        organisationId,
        facilityId: plan.facilityId,
        category: input.category,
        description: input.description,
        quantity: input.quantity,
        unit: input.unit,
        unitCostMinor: unitCost,
        estimatedCostMinor: estimated,
        priorityClass: input.priorityClass,
        costBasis: input.costBasis,
        // An estimate is an estimate until an approval says otherwise. It is
        // never presented as a price anyone has agreed to (§82).
        classification: 'ESTIMATED',
        createdBy: context?.userId,
      },
      select: {
        id: true,
        category: true,
        description: true,
        estimatedCostMinor: true,
        priorityClass: true,
        status: true,
        classification: true,
      },
    });

    await this.audit.record({
      action: 'planning.capex_line.create',
      entityType: 'capex_line',
      entityId: line.id,
      facilityId: plan.facilityId,
      newValue: {
        category: line.category,
        estimatedCostMinor: line.estimatedCostMinor.toString(),
        costBasis: input.costBasis ?? null,
      },
    });

    return { ...line, estimatedCostMinor: line.estimatedCostMinor.toString() };
  }

  /**
   * Approve one line.
   *
   * Two things this refuses: approving your own estimate, and approving a
   * different figure without saying why. Both are how a plan quietly stops
   * meaning what it says.
   */
  async approveCapexLine(lineId: string, input: { approvedCostMinor: bigint | number; reason?: string }) {
    const { organisationId } = getTenantScope();
    const context = tryGetContext();

    const line = await this.prisma.capexLine.findFirst({
      where: { id: lineId, organisationId },
      select: {
        id: true,
        facilityId: true,
        description: true,
        estimatedCostMinor: true,
        approvedCostMinor: true,
        status: true,
        createdBy: true,
        capexPlan: { select: { id: true, name: true, status: true } },
      },
    });

    if (!line) throw new NotFoundException('No such CAPEX line, or it is not visible to you.');
    this.assertFacilityVisible(line.facilityId);

    if (line.status === 'APPROVED') {
      throw new BadRequestException(
        `"${line.description}" is already approved at ${line.approvedCostMinor}. ` +
          'Record an adjustment rather than approving it twice.',
      );
    }

    if (line.createdBy && context?.userId && line.createdBy === context.userId) {
      throw new SegregationOfDutiesError(
        'The person who estimated a capital item may not approve it. Ask a second approver.',
      );
    }

    const approved = BigInt(input.approvedCostMinor);

    if (approved !== line.estimatedCostMinor && (!input.reason || input.reason.trim().length < 10)) {
      throw new ReasonRequiredError('Approving a capital item at a figure other than the estimate');
    }

    const updated = await this.prisma.capexLine.update({
      where: { id: line.id },
      data: {
        approvedCostMinor: approved,
        status: 'APPROVED',
        approvedBy: context?.userId,
        approvedAt: this.now(),
        // The approved figure is a decision somebody made and stands behind,
        // so it is no longer merely an estimate.
        classification: 'VERIFIED',
        updatedBy: context?.userId,
      },
      select: { id: true, approvedCostMinor: true, status: true, classification: true, approvedAt: true },
    });

    await this.prisma.approval.create({
      data: {
        organisationId,
        facilityId: line.facilityId,
        entityType: 'capex_line',
        entityId: line.id,
        approverUserId: context?.userId,
        decision: 'APPROVED',
        reason: input.reason,
        decidedAt: this.now(),
        createdBy: context?.userId,
      },
    });

    await this.audit.record({
      action: 'planning.capex_line.approve',
      entityType: 'capex_line',
      entityId: line.id,
      facilityId: line.facilityId,
      oldValue: { estimatedCostMinor: line.estimatedCostMinor.toString(), status: line.status },
      newValue: { approvedCostMinor: approved.toString(), status: 'APPROVED' },
      reason: input.reason,
      severity: 'NOTICE',
    });

    return { ...updated, approvedCostMinor: updated.approvedCostMinor?.toString() ?? null };
  }

  /**
   * A plan with its lines, totalled on read.
   *
   * Totals are computed here, never stored (§10). The estimated and approved
   * totals are reported separately, because a plan where half the lines are
   * approved is neither one figure nor the other, and averaging them would
   * invent a number that is true of nothing.
   */
  async getCapexPlan(planId: string) {
    const { organisationId } = getTenantScope();

    const plan = await this.prisma.capexPlan.findFirst({
      where: { id: planId, organisationId },
      select: {
        id: true,
        name: true,
        versionNumber: true,
        status: true,
        currency: true,
        notes: true,
        facilityId: true,
        approvedAt: true,
        createdAt: true,
        lines: {
          orderBy: [{ priorityClass: 'asc' }, { category: 'asc' }],
          select: {
            id: true,
            category: true,
            description: true,
            quantity: true,
            unit: true,
            unitCostMinor: true,
            estimatedCostMinor: true,
            approvedCostMinor: true,
            priorityClass: true,
            status: true,
            classification: true,
            costBasis: true,
            recommendation: {
              select: {
                id: true,
                reference: true,
                title: true,
                need: { select: { reference: true, finding: { select: { reference: true } } } },
              },
            },
          },
        },
      },
    });

    if (!plan) throw new NotFoundException('No such CAPEX plan, or it is not visible to you.');
    this.assertFacilityVisible(plan.facilityId);

    let estimatedTotal = 0n;
    let approvedTotal = 0n;
    const byCategory = new Map<string, bigint>();
    const byPriority = new Map<string, bigint>();

    for (const line of plan.lines) {
      estimatedTotal += line.estimatedCostMinor;
      if (line.approvedCostMinor !== null) approvedTotal += line.approvedCostMinor;

      byCategory.set(line.category, (byCategory.get(line.category) ?? 0n) + line.estimatedCostMinor);
      byPriority.set(line.priorityClass, (byPriority.get(line.priorityClass) ?? 0n) + line.estimatedCostMinor);
    }

    const unlinked = plan.lines.filter((line) => !line.recommendation).length;

    return {
      ...plan,
      lines: plan.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitCostMinor: line.unitCostMinor.toString(),
        estimatedCostMinor: line.estimatedCostMinor.toString(),
        approvedCostMinor: line.approvedCostMinor?.toString() ?? null,
        // The full chain back to what was observed, so a reader never has to
        // take a line item on trust.
        traceability: line.recommendation
          ? {
              recommendation: line.recommendation.reference,
              need: line.recommendation.need.reference,
              finding: line.recommendation.need.finding?.reference ?? null,
            }
          : null,
      })),
      totals: {
        estimatedMinor: estimatedTotal.toString(),
        approvedMinor: approvedTotal.toString(),
        lineCount: plan.lines.length,
        approvedLineCount: plan.lines.filter((line) => line.status === 'APPROVED').length,
        classification: 'ESTIMATED' as const,
        byCategory: Object.fromEntries([...byCategory].map(([key, value]) => [key, value.toString()])),
        byPriority: Object.fromEntries([...byPriority].map(([key, value]) => [key, value.toString()])),
      },
      // Stated plainly rather than left for someone to notice: these are the
      // lines with no observed problem behind them.
      traceability: {
        linkedLines: plan.lines.length - unlinked,
        unlinkedLines: unlinked,
        fullyTraced: unlinked === 0,
      },
    };
  }

  async listCapexPlans(facilityId: string) {
    this.assertFacilityVisible(facilityId);

    const plans = await this.prisma.capexPlan.findMany({
      where: { facilityId },
      orderBy: [{ name: 'asc' }, { versionNumber: 'desc' }],
      select: {
        id: true,
        name: true,
        versionNumber: true,
        status: true,
        currency: true,
        createdAt: true,
        approvedAt: true,
        _count: { select: { lines: true } },
      },
    });

    return plans.map((plan) => ({ ...plan, lineCount: plan._count.lines, _count: undefined }));
  }

  /**
   * Working capital, from the model rather than from a habit.
   *
   * The components are entered; the total is their sum. What the total is NOT
   * is a percentage of CAPEX — that convention is how a facility opens with
   * enough equipment and no money to run it.
   */
  async setWorkingCapital(
    capexPlanId: string,
    input: {
      monthsOfCover: number;
      openingStockMinor: bigint | number;
      staffCostsMinor: bigint | number;
      utilitiesMinor: bigint | number;
      contingencyMinor: bigint | number;
      assumptionsNote?: string;
    },
  ) {
    const { organisationId } = getTenantScope();

    const plan = await this.prisma.capexPlan.findFirst({
      where: { id: capexPlanId, organisationId },
      select: { id: true, facilityId: true, status: true, name: true },
    });

    if (!plan) throw new NotFoundException('No such CAPEX plan, or it is not visible to you.');
    this.assertFacilityVisible(plan.facilityId);

    const openingStock = BigInt(input.openingStockMinor);
    const staffCosts = BigInt(input.staffCostsMinor);
    const utilities = BigInt(input.utilitiesMinor);
    const contingency = BigInt(input.contingencyMinor);
    const total = openingStock + staffCosts + utilities + contingency;

    const context = tryGetContext();

    const data = {
      organisationId,
      facilityId: plan.facilityId,
      monthsOfCover: input.monthsOfCover,
      openingStockMinor: openingStock,
      staffCostsMinor: staffCosts,
      utilitiesMinor: utilities,
      contingencyMinor: contingency,
      totalMinor: total,
      assumptionsNote: input.assumptionsNote,
      classification: 'ESTIMATED' as const,
    };

    const saved = await this.prisma.workingCapitalPlan.upsert({
      where: { capexPlanId: plan.id },
      create: { ...data, capexPlanId: plan.id, createdBy: context?.userId },
      update: data,
      select: { id: true, monthsOfCover: true, totalMinor: true, classification: true },
    });

    await this.audit.record({
      action: 'planning.working_capital.set',
      entityType: 'working_capital_plan',
      entityId: saved.id,
      facilityId: plan.facilityId,
      newValue: { totalMinor: total.toString(), monthsOfCover: input.monthsOfCover },
    });

    return { ...saved, totalMinor: saved.totalMinor.toString() };
  }
}
