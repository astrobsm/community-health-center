import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateObligation,
  CreatePartnership,
  CreateParty,
  CreateRecoveryEvent,
  CreateRevenueShareModel,
} from '@chc/contracts';

import { ReasonRequiredError, SegregationOfDutiesError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import {
  capitalPosition,
  computeWaterfall,
  summariseByParty,
  WaterfallConfigurationError,
  type LedgerTotals,
  type WaterfallStepConfig,
} from './domain/waterfall';

/**
 * Partnership, revenue sharing and capital recovery (spec §§35-37, 73-74).
 *
 * The settlement for a period is NOT stored. It is computed from the posted
 * ledger and the revenue share model in force on that period (§10), which is
 * what makes "changing the model version does not alter a previously computed
 * period" true by construction rather than by care: the inputs are a closed
 * period's entries, which cannot change, and a version selected by date, which
 * does not move when a later version is agreed.
 *
 * No percentage appears anywhere in this file.
 */
@Injectable()
export class PartnershipService {
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
  // The partnership and its parties
  // ---------------------------------------------------------------------------

  async create(input: CreatePartnership) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    if (input.financialModelId) {
      const model = await this.prisma.financialModel.findFirst({
        where: { id: input.financialModelId, organisationId },
        select: { id: true, facilityId: true, status: true, name: true, versionNumber: true },
      });

      if (!model || model.facilityId !== input.facilityId) {
        throw new NotFoundException('No such financial model at this facility.');
      }

      // Negotiating against a draft is legitimate; recording it as the basis of
      // an agreement without saying so is not. The status travels with the link.
      if (model.status === 'SUPERSEDED') {
        throw new BadRequestException(
          `"${model.name}" v${model.versionNumber} has been superseded. Link the version that is actually in force.`,
        );
      }
    }

    const context = tryGetContext();

    const partnership = await this.prisma.partnership.create({
      data: {
        id: input.id ?? randomUUID(),
        facilityId: input.facilityId,
        organisationId,
        financialModelId: input.financialModelId,
        name: input.name,
        commencementDate: input.commencementDate ? new Date(input.commencementDate) : undefined,
        termMonths: input.termMonths,
        notes: input.notes,
        createdBy: context?.userId,
      },
      select: { id: true, name: true, status: true, commencementDate: true, termMonths: true },
    });

    await this.audit.record({
      action: 'partnership.create',
      entityType: 'partnership',
      entityId: partnership.id,
      facilityId: input.facilityId,
      newValue: { name: partnership.name, financialModelId: input.financialModelId ?? null },
    });

    return partnership;
  }

  async addParty(input: CreateParty) {
    const { organisationId } = getTenantScope();
    const partnership = await this.load(input.partnershipId);

    const party = await this.prisma.partnershipParty.create({
      data: {
        id: input.id ?? randomUUID(),
        partnershipId: partnership.id,
        organisationId,
        partyRole: input.partyRole,
        legalName: input.legalName,
        representative: input.representative,
        title: input.title,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        address: input.address,
      },
      select: { id: true, partyRole: true, legalName: true, representative: true },
    });

    await this.audit.record({
      action: 'partnership.party.add',
      entityType: 'partnership_party',
      entityId: party.id,
      facilityId: partnership.facilityId,
      newValue: { partyRole: party.partyRole, legalName: party.legalName },
    });

    return party;
  }

  async get(partnershipId: string) {
    const partnership = await this.load(partnershipId);

    const [parties, models, obligations] = await Promise.all([
      this.prisma.partnershipParty.findMany({
        where: { partnershipId },
        orderBy: { partyRole: 'asc' },
        select: { id: true, partyRole: true, legalName: true, representative: true, title: true },
      }),
      this.prisma.revenueShareModel.findMany({
        where: { partnershipId },
        orderBy: { versionNumber: 'desc' },
        select: {
          id: true,
          name: true,
          shareType: true,
          versionNumber: true,
          effectiveFrom: true,
          effectiveTo: true,
          approvedAt: true,
          _count: { select: { steps: true } },
        },
      }),
      this.prisma.partnershipObligation.findMany({
        where: { partnershipId },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
        select: {
          id: true,
          reference: true,
          description: true,
          dueDate: true,
          status: true,
          partyId: true,
          evidenceNote: true,
        },
      }),
    ]);

    const today = this.now();

    return {
      ...partnership,
      parties,
      revenueShareModels: models.map((model) => ({
        ...model,
        stepCount: model._count.steps,
        _count: undefined,
        /** Whether this is the version a settlement computed today would use. */
        inForceToday: model.effectiveFrom <= today && (!model.effectiveTo || model.effectiveTo >= today),
      })),
      obligations: obligations.map((obligation) => ({
        ...obligation,
        // Derived on read: an obligation becomes overdue because time passed,
        // not because a job ran (§10).
        overdue: Boolean(
          obligation.dueDate &&
            obligation.dueDate < today &&
            obligation.status !== 'MET' &&
            obligation.status !== 'WAIVED',
        ),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Revenue share models (spec §35)
  // ---------------------------------------------------------------------------

  /**
   * Agree a new version of the sharing arrangement.
   *
   * The previous version is closed the day before this one starts rather than
   * deleted. A settlement for last quarter must still find the terms that were
   * actually in force then — that is the whole reason these are versioned
   * (doc 12 §9).
   */
  async createRevenueShareModel(input: CreateRevenueShareModel) {
    const { organisationId } = getTenantScope();
    const partnership = await this.load(input.partnershipId);

    const effectiveFrom = new Date(input.effectiveFrom);

    // Steps may name a party, and that party must belong to this partnership.
    // A waterfall paying a party from another agreement would be very hard to
    // notice and impossible to defend.
    const partyIds = new Set(
      (
        await this.prisma.partnershipParty.findMany({
          where: { partnershipId: partnership.id },
          select: { id: true },
        })
      ).map((party) => party.id),
    );

    for (const step of input.steps) {
      if (step.beneficiaryPartyId && !partyIds.has(step.beneficiaryPartyId)) {
        throw new BadRequestException(
          `Step ${step.sequence} ("${step.label}") pays a party that is not part of this partnership.`,
        );
      }
    }

    // Run the configuration once before storing it. A waterfall that throws on
    // the first settlement of the quarter is a waterfall nobody can be paid from.
    try {
      computeWaterfall(
        { grossRevenueMinor: 1_000_000, directCostMinor: 0, operatingExpenseMinor: 0 },
        input.steps as WaterfallStepConfig[],
        this.now(),
        { outstandingRecoveryMinor: 0 },
      );
    } catch (error) {
      if (error instanceof WaterfallConfigurationError) throw new BadRequestException(error.message);
      throw error;
    }

    const previous = await this.prisma.revenueShareModel.findFirst({
      where: { partnershipId: partnership.id },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true, effectiveFrom: true, effectiveTo: true, name: true },
    });

    if (previous && effectiveFrom <= previous.effectiveFrom) {
      throw new BadRequestException(
        `Version ${previous.versionNumber} takes effect on ${previous.effectiveFrom.toISOString().slice(0, 10)}. ` +
          'A new version must start after it, so there is never a day with two sets of terms in force.',
      );
    }

    const context = tryGetContext();
    const dayBefore = new Date(effectiveFrom);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

    const model = await this.prisma.$transaction(async (tx) => {
      if (previous && previous.effectiveTo === null) {
        await tx.revenueShareModel.update({
          where: { id: previous.id },
          data: { effectiveTo: dayBefore, updatedAt: this.now() },
        });
      }

      return tx.revenueShareModel.create({
        data: {
          id: input.id ?? randomUUID(),
          partnershipId: partnership.id,
          organisationId,
          name: input.name,
          shareType: input.shareType,
          versionNumber: (previous?.versionNumber ?? 0) + 1,
          effectiveFrom,
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : undefined,
          notes: input.notes,
          createdBy: context?.userId,
          steps: {
            create: input.steps.map((step) => ({
              organisationId,
              sequence: step.sequence,
              label: step.label,
              basis: step.basis,
              rate: step.rate ?? undefined,
              fixedAmountMinor: step.fixedAmountMinor !== null && step.fixedAmountMinor !== undefined
                ? BigInt(step.fixedAmountMinor)
                : undefined,
              capMinor: step.capMinor !== null && step.capMinor !== undefined ? BigInt(step.capMinor) : undefined,
              floorMinor:
                step.floorMinor !== null && step.floorMinor !== undefined ? BigInt(step.floorMinor) : undefined,
              isCapitalRecovery: step.isCapitalRecovery,
              beneficiaryPartyId: step.beneficiaryPartyId ?? undefined,
              accountCode: step.accountCode ?? undefined,
              notes: step.notes,
            })),
          },
        },
        select: { id: true, name: true, shareType: true, versionNumber: true, effectiveFrom: true, effectiveTo: true },
      });
    });

    await this.audit.record({
      action: 'partnership.revenue_share.create',
      entityType: 'revenue_share_model',
      entityId: model.id,
      facilityId: partnership.facilityId,
      oldValue: previous ? { version: previous.versionNumber, closedOn: dayBefore.toISOString().slice(0, 10) } : undefined,
      newValue: {
        version: model.versionNumber,
        shareType: model.shareType,
        steps: input.steps.length,
        effectiveFrom: input.effectiveFrom,
      },
      severity: 'NOTICE',
    });

    return { ...model, stepCount: input.steps.length };
  }

  /** The version in force on a given day, which is the only one that may be used. */
  async modelInForceOn(partnershipId: string, on: Date) {
    return this.prisma.revenueShareModel.findFirst({
      where: {
        partnershipId,
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
      },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        name: true,
        shareType: true,
        versionNumber: true,
        effectiveFrom: true,
        effectiveTo: true,
        steps: {
          orderBy: { sequence: 'asc' },
          select: {
            sequence: true,
            label: true,
            basis: true,
            rate: true,
            fixedAmountMinor: true,
            capMinor: true,
            floorMinor: true,
            isCapitalRecovery: true,
            beneficiaryPartyId: true,
            accountCode: true,
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Settlement
  // ---------------------------------------------------------------------------

  /**
   * What each party is entitled to for one financial period.
   *
   * Computed, never stored. Recomputing next year produces the same answer,
   * because the period's entries cannot change once it is closed and the model
   * version is chosen by date rather than by recency.
   */
  async settlement(partnershipId: string, financialPeriodId: string) {
    const partnership = await this.load(partnershipId);

    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: financialPeriodId, facilityId: partnership.facilityId },
      select: { id: true, name: true, startDate: true, endDate: true, status: true },
    });

    if (!period) {
      throw new NotFoundException('No such financial period at this facility.');
    }

    // The terms in force when the period BEGAN. Using the latest version would
    // let a renegotiation agreed in December change what the government was
    // owed in March.
    const model = await this.modelInForceOn(partnershipId, period.startDate);

    if (!model) {
      throw new BadRequestException(
        `No revenue share model was in force on ${period.startDate.toISOString().slice(0, 10)}. ` +
          'Agree the terms for that period before computing a settlement.',
      );
    }

    // A version that took effect part-way through the period would make the
    // answer depend on a choice nobody made explicitly. Say so rather than pick.
    const overlapping = await this.prisma.revenueShareModel.count({
      where: {
        partnershipId,
        effectiveFrom: { gt: period.startDate, lte: period.endDate },
      },
    });

    const totals = await this.ledgerTotals(partnership.facilityId, financialPeriodId);
    const position = capitalPosition(await this.recoveryEvents(partnershipId));

    const steps: WaterfallStepConfig[] = model.steps.map((step) => ({
      sequence: step.sequence,
      label: step.label,
      basis: step.basis,
      rate: step.rate === null ? null : Number(step.rate),
      fixedAmountMinor: step.fixedAmountMinor === null ? null : Number(step.fixedAmountMinor),
      capMinor: step.capMinor === null ? null : Number(step.capMinor),
      floorMinor: step.floorMinor === null ? null : Number(step.floorMinor),
      isCapitalRecovery: step.isCapitalRecovery,
      beneficiaryPartyId: step.beneficiaryPartyId,
      accountCode: step.accountCode,
    }));

    let result;
    try {
      result = computeWaterfall(totals, steps, this.now(), {
        outstandingRecoveryMinor: position.outstandingMinor,
        revenueShareModelId: model.id,
        revenueShareModelVersion: model.versionNumber,
      });
    } catch (error) {
      if (error instanceof WaterfallConfigurationError) throw new BadRequestException(error.message);
      throw error;
    }

    const parties = await this.prisma.partnershipParty.findMany({
      where: { partnershipId },
      select: { id: true, legalName: true, partyRole: true },
    });
    const partyById = new Map(parties.map((party) => [party.id, party]));

    return {
      period: { id: period.id, name: period.name, startDate: period.startDate, endDate: period.endDate, status: period.status },
      revenueShareModel: {
        id: model.id,
        name: model.name,
        shareType: model.shareType,
        versionNumber: model.versionNumber,
        effectiveFrom: model.effectiveFrom,
      },
      ...result,
      byParty: summariseByParty(result).map((entry) => ({
        ...entry,
        legalName: entry.partyId ? (partyById.get(entry.partyId)?.legalName ?? null) : null,
        partyRole: entry.partyId ? (partyById.get(entry.partyId)?.partyRole ?? null) : null,
      })),
      capitalPosition: { ...position, classification: 'ACTUAL' as const },
      /**
       * An open period is still receiving entries, so this is an indication of
       * where things stand rather than a figure anyone can be paid on.
       */
      isProvisional: period.status !== 'CLOSED',
      ...(period.status !== 'CLOSED'
        ? {
            provisionalNote:
              `Period "${period.name}" is ${period.status}. These figures will change as entries are posted; ` +
              'close the period before settling on them.',
          }
        : {}),
      ...(overlapping > 0
        ? {
            warning:
              'Another revenue share version takes effect part-way through this period. These figures use the ' +
              'version in force on the first day; split the period if both sets of terms must apply.',
          }
        : {}),
    };
  }

  /**
   * Revenue and cost totals for a period, from the posted ledger.
   *
   * Reversed entries and their contra entries are BOTH included, because they
   * net to zero. Excluding the reversed original while keeping its contra would
   * subtract the same money twice (spec §44).
   */
  private async ledgerTotals(facilityId: string, financialPeriodId: string): Promise<LedgerTotals> {
    const lines = await this.prisma.journalLine.findMany({
      where: { facilityId, journalEntry: { financialPeriodId } },
      select: {
        debitMinor: true,
        creditMinor: true,
        financialAccount: { select: { accountType: true } },
      },
    });

    let revenue = 0n;
    let directCost = 0n;
    let expense = 0n;

    for (const line of lines) {
      const net = line.debitMinor - line.creditMinor;

      switch (line.financialAccount.accountType) {
        case 'REVENUE':
          // Revenue accounts carry a credit balance, so a credit increases it.
          revenue -= net;
          break;
        case 'DIRECT_COST':
          directCost += net;
          break;
        case 'EXPENSE':
          expense += net;
          break;
        default:
          break;
      }
    }

    // Net negatives can only come from more credit notes than sales in a
    // period, which the waterfall refuses rather than silently inverting.
    return {
      grossRevenueMinor: Number(revenue > 0n ? revenue : 0n),
      directCostMinor: Number(directCost > 0n ? directCost : 0n),
      operatingExpenseMinor: Number(expense > 0n ? expense : 0n),
    };
  }

  // ---------------------------------------------------------------------------
  // Capital recovery (spec §74)
  // ---------------------------------------------------------------------------

  async recordRecoveryEvent(input: CreateRecoveryEvent) {
    const { organisationId } = getTenantScope();
    const partnership = await this.load(input.partnershipId);
    const context = tryGetContext();

    // A partner cannot claim recovery of money that was never spent. The
    // foreign key is what makes that true; this check is what makes the
    // refusal comprehensible.
    if (input.eventType === 'INVESTMENT' && !input.sourcePaymentId) {
      throw new BadRequestException(
        'Recording capital as invested requires the payment that funded it. ' +
          'Without it, a partner could claim recovery of money nobody ever spent.',
      );
    }

    if (input.sourcePaymentId) {
      const payment = await this.prisma.payment.findFirst({
        where: { id: input.sourcePaymentId, organisationId },
        select: { id: true, amountMinor: true, facilityId: true },
      });

      if (!payment || payment.facilityId !== partnership.facilityId) {
        throw new NotFoundException('No such payment at this facility.');
      }

      if (BigInt(input.amountMinor) > payment.amountMinor) {
        throw new BadRequestException(
          `The payment was ${payment.amountMinor} kobo; ${input.amountMinor} cannot be claimed against it.`,
        );
      }
    }

    if (input.eventType === 'RECOVERY') {
      const position = capitalPosition(await this.recoveryEvents(partnership.id));

      if (Number(input.amountMinor) > position.outstandingMinor) {
        throw new BadRequestException(
          `Only ${position.outstandingMinor} kobo of capital is outstanding; ${input.amountMinor} cannot be recovered. ` +
            'A partner recovering more than they invested is being paid twice.',
        );
      }
    }

    const event = await this.prisma.capitalRecoveryEvent.create({
      data: {
        id: input.id ?? randomUUID(),
        partnershipId: partnership.id,
        partyId: input.partyId,
        organisationId,
        facilityId: partnership.facilityId,
        eventType: input.eventType,
        amountMinor: BigInt(input.amountMinor),
        occurredOn: new Date(input.occurredOn),
        sourcePaymentId: input.sourcePaymentId,
        description: input.description,
        classification: 'ACTUAL',
        createdBy: context?.userId,
      },
      select: { id: true, eventType: true, amountMinor: true, occurredOn: true, classification: true },
    });

    await this.audit.record({
      action: 'partnership.recovery.record',
      entityType: 'capital_recovery_event',
      entityId: event.id,
      facilityId: partnership.facilityId,
      newValue: {
        eventType: event.eventType,
        amountMinor: event.amountMinor.toString(),
        sourcePaymentId: input.sourcePaymentId ?? null,
      },
      severity: 'NOTICE',
    });

    return { ...event, amountMinor: event.amountMinor.toString() };
  }

  async capitalRecovery(partnershipId: string) {
    const partnership = await this.load(partnershipId);
    const events = await this.recoveryEvents(partnershipId);
    const position = capitalPosition(events);

    const rows = await this.prisma.capitalRecoveryEvent.findMany({
      where: { partnershipId },
      orderBy: { occurredOn: 'asc' },
      select: {
        id: true,
        eventType: true,
        amountMinor: true,
        occurredOn: true,
        description: true,
        sourcePaymentId: true,
        partyId: true,
        classification: true,
      },
    });

    return {
      partnershipId,
      facilityId: partnership.facilityId,
      position: { ...position, classification: 'ACTUAL' as const },
      events: rows.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() })),
      /**
       * No projected recovery date is offered here.
       *
       * It would be a projection off a run rate, and presenting one beside
       * actual figures invites it to be read as a commitment. The financial
       * model is where projections belong, labelled as such (§82).
       */
    };
  }

  private async recoveryEvents(partnershipId: string) {
    const events = await this.prisma.capitalRecoveryEvent.findMany({
      where: { partnershipId },
      select: { eventType: true, amountMinor: true },
    });

    return events.map((event) => ({ eventType: event.eventType, amountMinor: Number(event.amountMinor) }));
  }

  // ---------------------------------------------------------------------------
  // Obligations (spec §36)
  // ---------------------------------------------------------------------------

  async createObligation(input: CreateObligation) {
    const { organisationId } = getTenantScope();
    const partnership = await this.load(input.partnershipId);
    const context = tryGetContext();

    const count = await this.prisma.partnershipObligation.count({ where: { partnershipId: partnership.id } });

    const obligation = await this.prisma.partnershipObligation.create({
      data: {
        id: input.id ?? randomUUID(),
        partnershipId: partnership.id,
        partyId: input.partyId,
        organisationId,
        reference: `OB-${String(count + 1).padStart(3, '0')}`,
        description: input.description,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        createdBy: context?.userId,
      },
      select: { id: true, reference: true, description: true, dueDate: true, status: true },
    });

    await this.audit.record({
      action: 'partnership.obligation.create',
      entityType: 'partnership_obligation',
      entityId: obligation.id,
      facilityId: partnership.facilityId,
      newValue: { reference: obligation.reference, dueDate: input.dueDate ?? null },
    });

    return obligation;
  }

  /**
   * Record that an obligation was met, breached or waived.
   *
   * Met and waived both require evidence. An obligation marked met on nothing
   * is a claim, and a waiver with no reason is how a commitment quietly
   * disappears between one report and the next.
   */
  async settleObligation(
    obligationId: string,
    input: { status: 'IN_PROGRESS' | 'MET' | 'BREACHED' | 'WAIVED'; evidenceNote?: string },
  ) {
    const { organisationId } = getTenantScope();

    const obligation = await this.prisma.partnershipObligation.findFirst({
      where: { id: obligationId, organisationId },
      select: {
        id: true,
        reference: true,
        description: true,
        status: true,
        createdBy: true,
        partnership: { select: { id: true, facilityId: true } },
      },
    });

    if (!obligation) throw new NotFoundException('No such obligation, or it is not visible to you.');
    this.assertFacilityVisible(obligation.partnership.facilityId);

    if ((input.status === 'MET' || input.status === 'WAIVED') && (input.evidenceNote ?? '').trim().length < 10) {
      throw new ReasonRequiredError(
        input.status === 'MET'
          ? `Recording "${obligation.reference}" as met`
          : `Waiving "${obligation.reference}"`,
      );
    }

    const context = tryGetContext();

    if (input.status === 'WAIVED' && obligation.createdBy && obligation.createdBy === context?.userId) {
      throw new SegregationOfDutiesError(
        'The person who recorded an obligation may not waive it. Ask a second approver.',
      );
    }

    const updated = await this.prisma.partnershipObligation.update({
      where: { id: obligation.id },
      data: {
        status: input.status,
        evidenceNote: input.evidenceNote,
        metAt: input.status === 'MET' ? this.now() : null,
        verifiedBy: input.status === 'MET' ? context?.userId : undefined,
      },
      select: { id: true, reference: true, status: true, metAt: true, evidenceNote: true },
    });

    await this.audit.record({
      action: 'partnership.obligation.settle',
      entityType: 'partnership_obligation',
      entityId: obligation.id,
      facilityId: obligation.partnership.facilityId,
      oldValue: { status: obligation.status },
      newValue: { status: input.status },
      reason: input.evidenceNote,
      severity: input.status === 'WAIVED' || input.status === 'BREACHED' ? 'NOTICE' : 'INFO',
    });

    return updated;
  }

  // ---------------------------------------------------------------------------

  private async load(partnershipId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const partnership = await this.prisma.partnership.findFirst({
      where: { id: partnershipId, organisationId },
      select: {
        id: true,
        facilityId: true,
        organisationId: true,
        name: true,
        status: true,
        commencementDate: true,
        termMonths: true,
        financialModelId: true,
        notes: true,
        createdAt: true,
      },
    });

    if (!partnership || !facilityIds.includes(partnership.facilityId)) {
      throw new NotFoundException('No such partnership, or it is not visible to you.');
    }

    return partnership;
  }
}
