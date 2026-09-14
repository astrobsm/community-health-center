import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ModelAssumptions, ScenarioType } from '@chc/contracts';

import { ModelLockedError, ReasonRequiredError, SegregationOfDutiesError } from '../../common/errors';
import { getTenantScope, hasPermission, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import {
  AssumptionDecodeError,
  decodeAssumptions,
  dependencyKeyFor,
  encodeAssumptions,
  isKnownAssumptionCode,
  withAssumption,
  type AssumptionRow,
} from './domain/assumption-codec';
import { project, requiredWorkingCapitalMinor } from './domain/projection';
import { analyseSensitivity, previewChange } from './domain/sensitivity';

/**
 * The five-year financial model (spec §34, §72).
 *
 * Three rules this service exists to hold:
 *
 *  1. A projection is OUTPUT. It is recomputed from assumptions and never
 *     edited. The database refuses an update to a projected period.
 *
 *  2. An approved model's assumptions are LOCKED. Changing one requires an
 *     explicit unlock, which produces a new version rather than quietly
 *     altering the model a government partner was shown.
 *
 *  3. Nothing here is ever a fact. Every figure leaves this service labelled
 *     PROJECTED or ASSUMPTION, and neither can be promoted (§82).
 */
@Injectable()
export class FinancialModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date();
  }

  async create(input: {
    facilityId: string;
    name: string;
    startDate: string;
    horizonMonths?: number;
    assumptions: ModelAssumptions;
  }) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(input.facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const previous = await this.prisma.financialModel.findFirst({
      where: { facilityId: input.facilityId, name: input.name },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const context = tryGetContext();
    const rows = encodeAssumptions(input.assumptions);

    const model = await this.prisma.financialModel.create({
      data: {
        facilityId: input.facilityId,
        organisationId,
        name: input.name,
        versionNumber: (previous?.versionNumber ?? 0) + 1,
        horizonMonths: input.horizonMonths ?? 60,
        startDate: new Date(input.startDate),
        createdBy: context?.userId,
        assumptions: {
          create: rows.map((row) => ({
            organisationId,
            code: row.code,
            label: row.label,
            numericValue: row.numericValue,
            unit: row.unit,
            classification: 'ASSUMPTION',
            createdBy: context?.userId,
          })),
        },
      },
      select: { id: true, name: true, versionNumber: true, status: true, horizonMonths: true, startDate: true },
    });

    await this.audit.record({
      action: 'financial_model.create',
      entityType: 'financial_model',
      entityId: model.id,
      facilityId: input.facilityId,
      newValue: { name: model.name, versionNumber: model.versionNumber, assumptionCount: rows.length },
    });

    return model;
  }

  async get(modelId: string) {
    const model = await this.load(modelId);

    const scenarios = await this.prisma.modelScenario.findMany({
      where: { modelId },
      orderBy: { scenarioType: 'asc' },
      select: {
        id: true,
        scenarioType: true,
        name: true,
        breakEvenMonth: true,
        paybackMonth: true,
        computedAt: true,
        _count: { select: { projections: true } },
      },
    });

    return {
      ...model,
      assumptions: model.assumptions.map((row) => ({
        code: row.code,
        label: row.label,
        value: Number(row.numericValue),
        unit: row.unit,
        rationale: row.rationale,
        // An assumption with no rationale is a guess nobody can later
        // evaluate. Said out loud rather than left as an empty field.
        rationaleMissing: !row.rationale,
        isLocked: row.isLocked,
        classification: row.classification,
      })),
      scenarios: scenarios.map((scenario) => ({
        ...scenario,
        periodCount: scenario._count.projections,
        _count: undefined,
      })),
      /** Projections and break-even are never facts about the world. */
      classification: 'PROJECTED' as const,
    };
  }

  /**
   * Recompute one scenario and replace its projected periods.
   *
   * Deleting and re-inserting rather than updating in place, because a
   * projected period is output: the database refuses to amend one, precisely
   * so a printed model can never disagree with the assumptions it cites.
   */
  async computeScenario(
    modelId: string,
    scenarioType: ScenarioType,
    input: { name?: string; description?: string; overrides?: Record<string, number> } = {},
  ) {
    const model = await this.load(modelId);
    const overrides = input.overrides ?? {};

    for (const code of Object.keys(overrides)) {
      if (!isKnownAssumptionCode(code)) {
        throw new BadRequestException(
          `"${code}" is not an assumption this model recognises, so a scenario cannot override it.`,
        );
      }
    }

    const rows = this.rowsOf(model);
    const resolvedRows = rows.map((row) =>
      overrideFor(overrides, row.code) !== undefined ? { ...row, numericValue: overrides[row.code] } : row,
    );

    const assumptions = this.decode(resolvedRows);
    const result = project(assumptions, { horizonMonths: model.horizonMonths });

    const resolved = Object.fromEntries(resolvedRows.map((row) => [row.code, row.numericValue]));
    const computedAt = this.now();

    const scenario = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.modelScenario.upsert({
        where: { modelId_scenarioType: { modelId, scenarioType } },
        create: {
          modelId,
          organisationId: model.organisationId,
          scenarioType,
          name: input.name ?? defaultScenarioName(scenarioType),
          description: input.description,
          // Stored resolved as well as as overrides, so the scenario stays
          // reproducible: a reader can see exactly which numbers produced
          // these periods, even after the base assumptions move on.
          assumptionOverrides: { overrides, resolved } as never,
          breakEvenMonth: result.breakEvenPeriod,
          paybackMonth: result.paybackPeriod,
          computedAt,
        },
        update: {
          name: input.name ?? undefined,
          description: input.description ?? undefined,
          assumptionOverrides: { overrides, resolved } as never,
          // Null when it never breaks even. Never a fabricated month.
          breakEvenMonth: result.breakEvenPeriod,
          paybackMonth: result.paybackPeriod,
          computedAt,
        },
        select: { id: true, scenarioType: true, name: true, breakEvenMonth: true, paybackMonth: true },
      });

      await tx.modelProjection.deleteMany({ where: { scenarioId: saved.id } });

      await tx.modelProjection.createMany({
        data: result.periods.map((period) => ({
          scenarioId: saved.id,
          organisationId: model.organisationId,
          periodIndex: period.periodIndex,
          periodStart: addMonths(model.startDate, period.periodIndex),
          patientCount: period.patients,
          revenueMinor: BigInt(period.revenueMinor),
          collectionsMinor: BigInt(period.collectionsMinor),
          badDebtMinor: BigInt(period.badDebtMinor),
          directCostMinor: BigInt(period.directCostMinor),
          opexMinor: BigInt(period.opexMinor),
          staffCostMinor: BigInt(period.staffCostMinor),
          incentiveMinor: BigInt(period.incentiveMinor),
          depreciationMinor: BigInt(period.depreciationMinor),
          surplusMinor: BigInt(period.surplusMinor),
          capexMinor: BigInt(period.capexMinor),
          cashBalanceMinor: BigInt(period.cashBalanceMinor),
          cumulativeSurplusMinor: BigInt(period.cumulativeSurplusMinor),
          classification: 'PROJECTED' as const,
        })),
      });

      return saved;
    });

    await this.audit.record({
      action: 'financial_model.scenario.compute',
      entityType: 'model_scenario',
      entityId: scenario.id,
      facilityId: model.facilityId,
      newValue: {
        scenarioType,
        periods: result.periods.length,
        breakEvenPeriod: result.breakEvenPeriod,
        paybackPeriod: result.paybackPeriod,
        overrideCount: Object.keys(overrides).length,
      },
    });

    return {
      scenario,
      summary: this.summarise(result),
    };
  }

  /** The stored periods of one scenario, with the summary recomputed from them. */
  async getScenario(modelId: string, scenarioType: ScenarioType) {
    const model = await this.load(modelId);

    const scenario = await this.prisma.modelScenario.findUnique({
      where: { modelId_scenarioType: { modelId, scenarioType } },
      select: {
        id: true,
        scenarioType: true,
        name: true,
        description: true,
        breakEvenMonth: true,
        paybackMonth: true,
        computedAt: true,
        assumptionOverrides: true,
        projections: {
          orderBy: { periodIndex: 'asc' },
          select: {
            periodIndex: true,
            periodStart: true,
            patientCount: true,
            revenueMinor: true,
            collectionsMinor: true,
            badDebtMinor: true,
            directCostMinor: true,
            opexMinor: true,
            staffCostMinor: true,
            incentiveMinor: true,
            depreciationMinor: true,
            surplusMinor: true,
            capexMinor: true,
            cashBalanceMinor: true,
            cumulativeSurplusMinor: true,
            classification: true,
          },
        },
      },
    });

    if (!scenario) {
      throw new NotFoundException(
        `The ${scenarioType} scenario has not been computed for this model. Compute it first.`,
      );
    }

    const stored = (scenario.assumptionOverrides as { overrides?: Record<string, number> } | null) ?? {};
    const currentRows = this.rowsOf(model);
    const wouldBe = currentRows.map((row) =>
      stored.overrides?.[row.code] !== undefined ? { ...row, numericValue: stored.overrides[row.code] } : row,
    );

    const resolvedNow = Object.fromEntries(wouldBe.map((row) => [row.code, row.numericValue]));
    const resolvedThen =
      ((scenario.assumptionOverrides as { resolved?: Record<string, number> } | null)?.resolved) ?? {};

    const changedSince = Object.keys(resolvedNow).filter((code) => resolvedNow[code] !== resolvedThen[code]);

    return {
      ...scenario,
      periods: scenario.projections.map((period) => ({
        ...period,
        patientCount: Number(period.patientCount),
        revenueMinor: period.revenueMinor.toString(),
        collectionsMinor: period.collectionsMinor.toString(),
        badDebtMinor: period.badDebtMinor.toString(),
        directCostMinor: period.directCostMinor.toString(),
        opexMinor: period.opexMinor.toString(),
        staffCostMinor: period.staffCostMinor.toString(),
        incentiveMinor: period.incentiveMinor.toString(),
        depreciationMinor: period.depreciationMinor.toString(),
        surplusMinor: period.surplusMinor.toString(),
        capexMinor: period.capexMinor.toString(),
        cashBalanceMinor: period.cashBalanceMinor.toString(),
        cumulativeSurplusMinor: period.cumulativeSurplusMinor.toString(),
      })),
      projections: undefined,
      // A model printed from stale periods would cite assumptions it was not
      // computed from. Better to say so than to silently recompute behind a
      // reader's back.
      stale: changedSince.length > 0,
      changedSince,
      classification: 'PROJECTED' as const,
    };
  }

  /**
   * What changing one assumption would do — without changing anything.
   *
   * Available whether or not the model is locked: seeing the consequence is
   * how someone decides whether to ask for an unlock at all.
   */
  async previewAssumptionChange(modelId: string, code: string, value: number) {
    const model = await this.load(modelId);
    const rows = this.rowsOf(model);

    const row = rows.find((candidate) => candidate.code === code);
    if (!row) {
      throw new NotFoundException(`This model has no assumption "${code}".`);
    }

    const assumptions = this.decode(rows);

    const impact = previewChange({
      assumptions,
      assumptionCode: dependencyKeyFor(code),
      label: row.label,
      before: row.numericValue,
      after: value,
      apply: (_current, next) => withAssumption(rows, code, next),
      isApproved: model.status === 'APPROVED',
      now: this.now(),
      options: { horizonMonths: model.horizonMonths },
    });

    return {
      ...impact,
      assumptionCode: code,
      isLocked: row.isLocked,
      unit: row.unit,
      guidance:
        model.status === 'APPROVED'
          ? 'This model is approved. Applying this change requires an unlock, which creates a new version ' +
            'and leaves the approved version intact.'
          : undefined,
    };
  }

  /**
   * Apply a change to one assumption.
   *
   * Refused with 423 while the model is approved. The preview is not optional
   * politeness: a tariff moves the government's entitlement and the partner's
   * payback date, and the person making the change should have seen that.
   */
  async applyAssumptionChange(
    modelId: string,
    code: string,
    input: { value: number; reason: string; confirmImpact: true },
  ) {
    const model = await this.load(modelId);
    const rows = this.rowsOf(model);

    const row = rows.find((candidate) => candidate.code === code);
    if (!row) throw new NotFoundException(`This model has no assumption "${code}".`);

    if (row.isLocked || model.status === 'APPROVED') {
      throw new ModelLockedError(`${model.name} v${model.versionNumber}`);
    }

    if (!input.confirmImpact) {
      throw new BadRequestException(
        'Review the impact preview and confirm it before changing an assumption.',
      );
    }

    if (!input.reason || input.reason.trim().length < 10) {
      throw new ReasonRequiredError('Changing a model assumption');
    }

    // Rejects the change before it is written if it would make the model
    // unprojectable — a fractional kobo, a non-finite number.
    const after = this.decode(rows.map((r) => (r.code === code ? { ...r, numericValue: input.value } : r)));

    const context = tryGetContext();
    const before = row.numericValue;

    const updated = await this.prisma.modelAssumption.update({
      where: { modelId_code: { modelId, code } },
      data: { numericValue: input.value, rationale: input.reason, updatedBy: context?.userId },
      select: { id: true, code: true, numericValue: true, rationale: true },
    });

    await this.audit.record({
      action: 'financial_model.assumption.change',
      entityType: 'model_assumption',
      entityId: updated.id,
      facilityId: model.facilityId,
      oldValue: { code, value: before },
      newValue: { code, value: input.value },
      reason: input.reason,
      severity: 'NOTICE',
    });

    // Every scenario computed before this change now cites a number that is no
    // longer current. They are marked stale on read rather than recomputed
    // silently, so nobody is shown a figure that changed while they were
    // looking away.
    const scenarios = await this.prisma.modelScenario.count({ where: { modelId } });

    return {
      assumption: { ...updated, numericValue: Number(updated.numericValue) },
      projectedSurplusMinor: project(after, { horizonMonths: model.horizonMonths }).totalSurplusMinor,
      staleScenarios: scenarios,
      recomputeRequired: scenarios > 0,
    };
  }

  /**
   * Approve the model and lock every assumption.
   *
   * Refuses to approve something nobody has actually run: an approved model
   * with no computed base scenario is an approval of an intention.
   */
  async approve(modelId: string, input: { note?: string }) {
    const model = await this.load(modelId);
    const context = tryGetContext();

    if (model.status === 'APPROVED') {
      throw new BadRequestException(`"${model.name}" is already approved.`);
    }

    if (model.createdBy && context?.userId && model.createdBy === context.userId) {
      throw new SegregationOfDutiesError(
        'The person who built a financial model may not approve it. Ask a second approver.',
      );
    }

    const base = await this.prisma.modelScenario.findUnique({
      where: { modelId_scenarioType: { modelId, scenarioType: 'BASE' } },
      select: { id: true, computedAt: true, _count: { select: { projections: true } } },
    });

    if (!base || base._count.projections === 0) {
      throw new BadRequestException(
        'This model has no computed base scenario. Compute it and review the projected periods before approving.',
      );
    }

    const approvedAt = this.now();

    await this.prisma.$transaction([
      this.prisma.financialModel.update({
        where: { id: modelId },
        data: { status: 'APPROVED', approvedBy: context?.userId, approvedAt, updatedBy: context?.userId },
      }),
      this.prisma.modelAssumption.updateMany({ where: { modelId }, data: { isLocked: true } }),
    ]);

    await this.audit.record({
      action: 'financial_model.approve',
      entityType: 'financial_model',
      entityId: modelId,
      facilityId: model.facilityId,
      oldValue: { status: model.status },
      newValue: { status: 'APPROVED', lockedAssumptions: model.assumptions.length },
      reason: input.note,
      severity: 'CRITICAL',
    });

    return { id: modelId, status: 'APPROVED' as const, approvedAt, lockedAssumptions: model.assumptions.length };
  }

  /**
   * Unlock an approved model for change.
   *
   * This does NOT reopen the approved model. It creates the next version,
   * unlocked, and marks the approved one superseded — so the model a
   * government partner was shown remains exactly as it was, and anyone can
   * still read it (§12, §44).
   */
  async unlock(modelId: string, input: { reason: string }) {
    const model = await this.load(modelId);

    if (!hasPermission('financial_model.unlock')) {
      throw new SegregationOfDutiesError(
        'Unlocking an approved model requires the financial_model.unlock permission.',
      );
    }

    if (model.status !== 'APPROVED') {
      throw new BadRequestException(
        `"${model.name}" is not approved, so there is nothing to unlock. Its assumptions can be changed directly.`,
      );
    }

    if (!input.reason || input.reason.trim().length < 10) {
      throw new ReasonRequiredError('Unlocking an approved financial model');
    }

    const context = tryGetContext();

    const next = await this.prisma.$transaction(async (tx) => {
      const created = await tx.financialModel.create({
        data: {
          facilityId: model.facilityId,
          organisationId: model.organisationId,
          name: model.name,
          versionNumber: model.versionNumber + 1,
          horizonMonths: model.horizonMonths,
          startDate: model.startDate,
          status: 'DRAFT',
          changeReason: input.reason,
          // Authorship carries over from the version being superseded.
          //
          // The administrator unlocked it; they did not write it. Recording
          // them as the author would bar the only role that can approve a
          // model from approving this one — leaving an organisation with one
          // administrator permanently unable to re-approve after an unlock.
          // The unlock itself is recorded as the event it is, in the audit
          // trail and in changeReason.
          createdBy: model.createdBy ?? context?.userId,
          assumptions: {
            create: model.assumptions.map((row) => ({
              organisationId: model.organisationId,
              code: row.code,
              label: row.label,
              numericValue: row.numericValue,
              unit: row.unit,
              rationale: row.rationale,
              classification: 'ASSUMPTION' as const,
              isLocked: false,
              createdBy: context?.userId,
            })),
          },
        },
        select: { id: true, name: true, versionNumber: true, status: true },
      });

      await tx.financialModel.update({
        where: { id: modelId },
        data: { status: 'SUPERSEDED', supersededById: created.id, updatedBy: context?.userId },
      });

      return created;
    });

    await this.audit.record({
      action: 'financial_model.unlock',
      entityType: 'financial_model',
      entityId: modelId,
      facilityId: model.facilityId,
      oldValue: { status: 'APPROVED', versionNumber: model.versionNumber },
      newValue: { status: 'SUPERSEDED', supersededById: next.id, newVersion: next.versionNumber },
      reason: input.reason,
      severity: 'CRITICAL',
    });

    return {
      superseded: { id: modelId, versionNumber: model.versionNumber, status: 'SUPERSEDED' as const },
      workingVersion: next,
      note:
        'The approved version is unchanged and still readable. Continue in the new version; ' +
        'its scenarios must be recomputed before it can be approved.',
    };
  }

  /** One-at-a-time sensitivity across the drivers a case actually rests on (§34). */
  async sensitivity(modelId: string) {
    const model = await this.load(modelId);
    const assumptions = this.decode(this.rowsOf(model));

    const result = analyseSensitivity(assumptions, this.now(), { horizonMonths: model.horizonMonths });

    return {
      ...result,
      modelId,
      horizonMonths: model.horizonMonths,
      classification: 'PROJECTED' as const,
      note:
        'Each row varies one driver and holds the rest at their base values. ' +
        'These are ranges, not forecasts.',
    };
  }

  // ---------------------------------------------------------------------------

  private summarise(result: ReturnType<typeof project>) {
    return {
      periods: result.periods.length,
      breakEvenPeriod: result.breakEvenPeriod,
      paybackPeriod: result.paybackPeriod,
      totalRevenueMinor: result.totalRevenueMinor.toString(),
      totalSurplusMinor: result.totalSurplusMinor.toString(),
      totalInvestmentMinor: result.totalInvestmentMinor.toString(),
      lowestCashMinor: result.lowestCashMinor.toString(),
      lowestCashPeriod: result.lowestCashPeriod,
      // The number that decides whether a facility can actually open.
      requiredWorkingCapitalMinor: requiredWorkingCapitalMinor(result).toString(),
      classification: 'PROJECTED' as const,
    };
  }

  private rowsOf(model: { assumptions: LoadedAssumption[] }): AssumptionRow[] {
    return model.assumptions.map((row) => ({
      code: row.code,
      label: row.label,
      numericValue: Number(row.numericValue),
      unit: row.unit,
      rationale: row.rationale,
      isLocked: row.isLocked,
    }));
  }

  /** Turns a decode failure into a 400 that names what is missing. */
  private decode(rows: AssumptionRow[]): ModelAssumptions {
    try {
      return decodeAssumptions(rows);
    } catch (error) {
      if (error instanceof AssumptionDecodeError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private async load(modelId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const model = await this.prisma.financialModel.findFirst({
      where: { id: modelId, organisationId },
      select: {
        id: true,
        facilityId: true,
        organisationId: true,
        name: true,
        versionNumber: true,
        status: true,
        horizonMonths: true,
        startDate: true,
        currency: true,
        approvedAt: true,
        approvedBy: true,
        createdBy: true,
        supersededById: true,
        changeReason: true,
        assumptions: {
          orderBy: { code: 'asc' },
          select: {
            code: true,
            label: true,
            numericValue: true,
            unit: true,
            rationale: true,
            isLocked: true,
            classification: true,
          },
        },
      },
    });

    if (!model || !facilityIds.includes(model.facilityId)) {
      throw new NotFoundException('No such financial model, or it is not visible to you.');
    }

    return model;
  }
}

interface LoadedAssumption {
  code: string;
  label: string;
  numericValue: unknown;
  unit: string | null;
  rationale: string | null;
  isLocked: boolean;
}

/** `Object.hasOwn` via a helper, so an override of 0 is honoured rather than skipped. */
function overrideFor(overrides: Record<string, number>, code: string): number | undefined {
  return Object.hasOwn(overrides, code) ? overrides[code] : undefined;
}

function defaultScenarioName(scenarioType: ScenarioType): string {
  return {
    CONSERVATIVE: 'Conservative case',
    BASE: 'Base case',
    GROWTH: 'Growth case',
    STRESS: 'Stress case',
  }[scenarioType];
}

/**
 * Month arithmetic that does not slide.
 *
 * Adding a month to 31 January must not produce 3 March. Clamping to the last
 * day of the target month keeps a 60-period schedule aligned to the month it
 * belongs to.
 */
function addMonths(start: Date, months: number): Date {
  const result = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return result;
}
