import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ApproveIncentive,
  ComputeIncentive,
  ComputePerformance,
  ConfigureMetric,
} from '@chc/contracts';

import {
  IncentiveNotScorableError,
  SegregationOfDutiesError,
  UnknownMetricQueryHttpError,
} from '../../common/errors';
import { UnknownMetricQueryError, type MetricQueryParams } from '../../common/metric-query';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import {
  assertScorable,
  computeIncentive,
  DEFAULT_INCENTIVE_RULES,
  IncentiveConfigurationError,
  splitPool,
  type IncentiveRules,
  type MetricDefinition,
  type MetricObservation,
} from './domain/incentive';
import { getStaffMetricQuery, listStaffMetricQueries, STAFF_METRIC_QUERIES } from './staff-metric-queries';

/**
 * Performance measurement and incentive computation (spec §25).
 *
 * This is acceptance criterion J end to end: attendance feeds performance,
 * performance feeds the incentive, and every step shows its arithmetic.
 *
 * The rule the whole module is built around is that patient volume alone may
 * not determine an incentive. It is enforced twice — when the metrics are
 * configured, and again at the moment of computation against the metrics that
 * could actually be scored — because a quality metric whose query returns
 * nothing this month would otherwise leave volume standing alone without
 * anybody changing a setting.
 */
@Injectable()
export class PerformanceService {
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

  /** The queries a metric may be built on. Nothing else can be named. */
  listQueries() {
    return {
      note:
        'A performance metric must name one of these queries. A metric with no query behind it cannot ' +
        'be recomputed, and paying on a number nobody can recompute is what this rule prevents.',
      queries: listStaffMetricQueries(),
    };
  }

  // ---------------------------------------------------------------------------
  // Metric configuration
  // ---------------------------------------------------------------------------

  async configureMetric(input: ConfigureMetric) {
    const { organisationId } = getTenantScope();
    if (input.facilityId) this.assertFacilityVisible(input.facilityId);

    let query;
    try {
      query = getStaffMetricQuery(input.sourceQueryId);
    } catch (error) {
      if (error instanceof UnknownMetricQueryError) throw new UnknownMetricQueryHttpError(error.message);
      throw error;
    }

    if (query.direction !== input.direction) {
      // Silently accepting the wrong direction would invert the score: doing
      // well would pay less. Better to refuse and say which way round it goes.
      throw new BadRequestException(
        `"${query.name}" is scored ${query.direction === 'HIGHER_BETTER' ? 'higher-is-better' : 'lower-is-better'}, ` +
          'and the metric was configured the other way round. Scoring it backwards would pay more for ' +
          'doing worse.',
      );
    }

    const context = tryGetContext();

    const existing = await this.prisma.performanceMetric.findFirst({
      where: { organisationId, code: input.code },
      select: { id: true, code: true, weight: true, sourceQueryId: true, status: true },
    });

    // Validate the whole active set as it WOULD be, before writing anything.
    // A single metric is never unscorable on its own; the configuration is.
    const proposed = await this.proposedMetricSet(organisationId, input, existing?.id ?? null);

    try {
      assertScorable(proposed, await this.rules());
    } catch (error) {
      if (error instanceof IncentiveConfigurationError) {
        throw new IncentiveNotScorableError(error.message, error.code);
      }
      throw error;
    }

    const data = {
      organisationId,
      facilityId: input.facilityId,
      code: input.code,
      name: input.name,
      definition: input.definition,
      unit: input.unit ?? query.unit,
      direction: input.direction,
      sourceQueryId: input.sourceQueryId,
      weight: input.weight,
      targetValue: input.targetValue,
      createdBy: context?.userId,
    };

    const metric = existing
      ? await this.prisma.performanceMetric.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
          select: { id: true, code: true, name: true, weight: true, targetValue: true, sourceQueryId: true },
        })
      : await this.prisma.performanceMetric.create({
          data,
          select: { id: true, code: true, name: true, weight: true, targetValue: true, sourceQueryId: true },
        });

    await this.audit.record({
      action: 'performance.metric.configure',
      entityType: 'performance_metric',
      entityId: metric.id,
      facilityId: input.facilityId,
      oldValue: existing ? { weight: existing.weight.toString(), sourceQueryId: existing.sourceQueryId } : undefined,
      newValue: { code: input.code, weight: input.weight, sourceQueryId: input.sourceQueryId },
      severity: 'NOTICE',
    });

    return {
      ...metric,
      weight: Number(metric.weight),
      targetValue: metric.targetValue === null ? null : Number(metric.targetValue),
      isVolumeMetric: query.isVolumeMetric,
    };
  }

  async listMetrics(facilityId?: string) {
    const { organisationId } = getTenantScope();
    if (facilityId) this.assertFacilityVisible(facilityId);

    const metrics = await this.activeMetrics(organisationId, facilityId);
    const rules = await this.rules();

    let configurationProblem: string | null = null;
    try {
      assertScorable(metrics, rules);
    } catch (error) {
      configurationProblem = error instanceof Error ? error.message : String(error);
    }

    const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);
    const volumeWeight = metrics
      .filter((metric) => metric.isVolumeMetric)
      .reduce((sum, metric) => sum + metric.weight, 0);

    return {
      metrics,
      totalWeight,
      volumeWeightShare: totalWeight === 0 ? null : Math.round((volumeWeight / totalWeight) * 10_000) / 10_000,
      maxVolumeWeightShare: rules.maxVolumeWeightShare,
      // Reported rather than hidden: a configuration that cannot pay anybody
      // should say so on the screen where it is edited, not at month end.
      configurationProblem,
    };
  }

  // ---------------------------------------------------------------------------
  // Metric computation
  // ---------------------------------------------------------------------------

  /**
   * Run every configured metric's named query for one person and one period.
   *
   * The result rows are evidence of what was computed and from what, not a
   * source of truth: everything here is recomputable from the transactions,
   * and re-running this method over the same period reproduces it (§10).
   */
  async computeFor(input: ComputePerformance) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const staff = await this.requireStaff(input.staffId, input.facilityId);
    const metrics = await this.activeMetrics(organisationId, input.facilityId);

    if (metrics.length === 0) {
      throw new BadRequestException(
        'No performance metric is configured for this facility, so there is nothing to compute. ' +
          'Configure metrics first.',
      );
    }

    const params: MetricQueryParams = {
      organisationId,
      facilityId: input.facilityId,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      staffId: staff.id,
      now: this.now(),
    };

    const results = [];

    for (const metric of metrics) {
      const query = getStaffMetricQuery(metric.sourceQueryId!);
      const outcome = await query.run(this.prisma, params);

      // A metric the query could not compute is recorded as absent, not as
      // zero. The two look the same on a chart and mean opposite things.
      const stored =
        outcome.value === null
          ? null
          : await this.prisma.performanceMetricResult.upsert({
              where: {
                metricId_staffId_periodStart_periodEnd: {
                  metricId: metric.id,
                  staffId: staff.id,
                  periodStart: params.periodStart,
                  periodEnd: params.periodEnd,
                },
              },
              create: {
                metricId: metric.id,
                staffId: staff.id,
                organisationId,
                facilityId: input.facilityId,
                periodStart: params.periodStart,
                periodEnd: params.periodEnd,
                value: outcome.value,
                targetValue: metric.targetValue,
                inputs: { ...outcome.inputs, sourceQueryId: metric.sourceQueryId, sampleSize: outcome.sampleSize },
                classification: 'ACTUAL',
                computedAt: params.now,
              },
              update: {
                value: outcome.value,
                targetValue: metric.targetValue,
                inputs: { ...outcome.inputs, sourceQueryId: metric.sourceQueryId, sampleSize: outcome.sampleSize },
                computedAt: params.now,
              },
              select: { id: true },
            });

      results.push({
        metricId: metric.id,
        code: metric.code,
        name: metric.name,
        sourceQueryId: metric.sourceQueryId,
        unit: metric.unit,
        direction: metric.direction,
        isVolumeMetric: metric.isVolumeMetric,
        weight: metric.weight,
        targetValue: metric.targetValue,
        value: outcome.value,
        sampleSize: outcome.sampleSize,
        inputs: outcome.inputs,
        note: outcome.note,
        resultId: stored?.id ?? null,
        // Said plainly, because "—" in a table is read as zero by everybody in
        // a hurry.
        computed: outcome.value !== null,
      });
    }

    await this.audit.record({
      action: 'performance.compute',
      entityType: 'staff',
      entityId: staff.id,
      facilityId: input.facilityId,
      newValue: {
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        computed: results.filter((result) => result.computed).length,
        notComputed: results.filter((result) => !result.computed).length,
      },
    });

    return {
      staffId: staff.id,
      name: `${staff.givenName} ${staff.familyName}`,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      computedAt: params.now.toISOString(),
      results,
    };
  }

  // ---------------------------------------------------------------------------
  // Incentives
  // ---------------------------------------------------------------------------

  /**
   * Divide a pool between staff and compute each share from measured performance.
   *
   * Two separate steps, deliberately: the pool split is a policy decision about
   * how much each person's share of the pool is, and the score decides how much
   * of their share they earned. Anything unearned stays in the pool rather than
   * being quietly redistributed to somebody who scored well — redistribution is
   * a decision for the facility, not an accident of arithmetic.
   */
  async compute(input: ComputeIncentive) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    if (input.splitWeights && input.splitWeights.length !== input.staffIds.length) {
      throw new BadRequestException(
        'A split weight must be given for every member of staff, or for none of them.',
      );
    }

    const metrics = await this.activeMetrics(organisationId, input.facilityId);
    const rules = await this.rules();

    try {
      assertScorable(metrics, rules);
    } catch (error) {
      if (error instanceof IncentiveConfigurationError) {
        throw new IncentiveNotScorableError(error.message, error.code);
      }
      throw error;
    }

    const context = tryGetContext();
    const computedAt = this.now();
    const shares = splitPool(input.poolMinor, input.staffIds, input.splitWeights);

    const incentives = [];
    const warnings: string[] = [];

    for (const share of shares) {
      const performance = await this.computeFor({
        facilityId: input.facilityId,
        staffId: share.staffId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      });

      const observations: MetricObservation[] = performance.results.map((result) => ({
        metricId: result.metricId,
        value: result.value,
      }));

      for (const result of performance.results) {
        if (result.note) warnings.push(`${performance.name}: ${result.note}`);
      }

      let outcome;
      try {
        outcome = computeIncentive({
          metrics,
          observations,
          poolMinor: share.shareMinor,
          rules,
        });
      } catch (error) {
        if (error instanceof IncentiveConfigurationError) {
          // Reached when the quality metrics all failed to compute for this
          // person and volume is what remains. Refusing is the point.
          throw new IncentiveNotScorableError(
            `${performance.name}: ${error.message}`,
            error.code,
          );
        }
        throw error;
      }

      const incentive = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.staffIncentive.findUnique({
          where: {
            staffId_periodStart_periodEnd: {
              staffId: share.staffId,
              periodStart: new Date(input.periodStart),
              periodEnd: new Date(input.periodEnd),
            },
          },
          select: { id: true, status: true },
        });

        if (existing && existing.status !== 'DRAFT' && existing.status !== 'COMPUTED') {
          throw new BadRequestException(
            `An incentive for ${performance.name} for this period is already ${existing.status.toLowerCase()} ` +
              'and cannot be recomputed. Cancel it first, with a reason.',
          );
        }

        if (existing) {
          // Components are replaced wholesale rather than edited: a component
          // is the arithmetic of one computation, and mixing two computations'
          // components would produce a total nothing explains.
          await tx.incentiveComponent.deleteMany({ where: { staffIncentiveId: existing.id } });
        }

        const row = existing
          ? await tx.staffIncentive.update({
              where: { id: existing.id },
              data: {
                status: 'COMPUTED',
                totalAmountMinor: BigInt(outcome.totalAmountMinor),
                poolReference: input.poolReference,
                computedAt,
                createdBy: context?.userId,
                version: { increment: 1 },
              },
              select: { id: true, status: true, totalAmountMinor: true },
            })
          : await tx.staffIncentive.create({
              data: {
                staffId: share.staffId,
                organisationId,
                facilityId: input.facilityId,
                periodStart: new Date(input.periodStart),
                periodEnd: new Date(input.periodEnd),
                status: 'COMPUTED',
                totalAmountMinor: BigInt(outcome.totalAmountMinor),
                poolReference: input.poolReference,
                computedAt,
                createdBy: context?.userId,
              },
              select: { id: true, status: true, totalAmountMinor: true },
            });

        await tx.incentiveComponent.createMany({
          data: outcome.components.map((component) => ({
            staffIncentiveId: row.id,
            metricId: component.metricId,
            organisationId,
            label: component.label,
            metricValue: component.metricValue,
            normalisedScore: component.normalisedScore,
            weight: component.weight,
            amountMinor: BigInt(component.amountMinor),
            formulaText: component.formulaText,
          })),
        });

        return row;
      });

      await this.audit.record({
        action: 'performance.compute_incentive',
        entityType: 'staff_incentive',
        entityId: incentive.id,
        facilityId: input.facilityId,
        newValue: {
          staffId: share.staffId,
          poolShareMinor: share.shareMinor,
          overallScore: outcome.overallScore,
          totalAmountMinor: outcome.totalAmountMinor,
          poolReference: input.poolReference,
        },
        severity: 'NOTICE',
      });

      incentives.push({
        incentiveId: incentive.id,
        staffId: share.staffId,
        name: performance.name,
        status: incentive.status,
        poolShareMinor: share.shareMinor,
        overallScore: outcome.overallScore,
        totalAmountMinor: outcome.totalAmountMinor,
        components: outcome.components,
        unscored: outcome.unscored,
        explanation: outcome.explanation,
      });
    }

    const awardedMinor = incentives.reduce((sum, incentive) => sum + incentive.totalAmountMinor, 0);

    return {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      poolReference: input.poolReference,
      poolMinor: input.poolMinor,
      awardedMinor,
      // Stated rather than hidden. Money that nobody earned has not vanished,
      // and where it goes is the facility's decision to make openly.
      unawardedMinor: input.poolMinor - awardedMinor,
      unawardedNote:
        input.poolMinor - awardedMinor > 0
          ? 'This part of the pool was not earned against the measured metrics. It has not been ' +
            'redistributed: what happens to it is a decision for the facility, recorded separately.'
          : undefined,
      warnings,
      incentives,
    };
  }

  /**
   * Approve an incentive for payment.
   *
   * The person who computed it may not approve it (doc 18 §9). This is checked
   * against the record rather than against role design, because an
   * organisation may legitimately grant one person both permissions and the
   * control must still hold.
   */
  async approve(input: ApproveIncentive) {
    const { facilityIds } = getTenantScope();
    const context = tryGetContext();

    const incentive = await this.prisma.staffIncentive.findFirst({
      where: { id: input.incentiveId, facilityId: { in: [...facilityIds] } },
      select: {
        id: true,
        facilityId: true,
        status: true,
        totalAmountMinor: true,
        createdBy: true,
        staff: { select: { givenName: true, familyName: true } },
      },
    });

    if (!incentive) throw new NotFoundException('No such incentive, or it is not visible to you.');

    if (incentive.status !== 'COMPUTED') {
      throw new BadRequestException(
        `This incentive is ${incentive.status.toLowerCase()}. Only a computed incentive can be approved.`,
      );
    }

    if (incentive.createdBy && context?.userId && incentive.createdBy === context.userId) {
      throw new SegregationOfDutiesError(
        'The person who computed an incentive may not approve its payment. Ask a second person to ' +
          'approve it.',
      );
    }

    const approved = await this.prisma.staffIncentive.update({
      where: { id: incentive.id },
      data: {
        status: 'APPROVED',
        approvedBy: context?.userId,
        approvedAt: this.now(),
        version: { increment: 1 },
      },
      select: { id: true, status: true, approvedAt: true, totalAmountMinor: true },
    });

    await this.audit.record({
      action: 'performance.approve_incentive',
      entityType: 'staff_incentive',
      entityId: incentive.id,
      facilityId: incentive.facilityId,
      oldValue: { status: 'COMPUTED' },
      newValue: {
        status: 'APPROVED',
        totalAmountMinor: incentive.totalAmountMinor.toString(),
        computedBy: incentive.createdBy,
        note: input.note,
      },
      severity: 'NOTICE',
    });

    return { ...approved, totalAmountMinor: Number(approved.totalAmountMinor) };
  }

  /**
   * The incentive as the person being paid should see it.
   *
   * Every component, every weight, every piece of arithmetic in words. Nobody
   * has to trust the number; they can read how it was made and argue with it.
   */
  async explain(incentiveId: string) {
    const { facilityIds } = getTenantScope();

    const incentive = await this.prisma.staffIncentive.findFirst({
      where: { id: incentiveId, facilityId: { in: [...facilityIds] } },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        totalAmountMinor: true,
        currency: true,
        poolReference: true,
        computedAt: true,
        createdBy: true,
        approvedBy: true,
        approvedAt: true,
        staff: { select: { id: true, givenName: true, familyName: true, cadre: true } },
        components: {
          select: {
            label: true,
            metricValue: true,
            normalisedScore: true,
            weight: true,
            amountMinor: true,
            formulaText: true,
            metric: { select: { code: true, sourceQueryId: true, definition: true } },
          },
        },
      },
    });

    if (!incentive) throw new NotFoundException('No such incentive, or it is not visible to you.');

    const components = incentive.components.map((component) => ({
      label: component.label,
      metricCode: component.metric?.code ?? null,
      definition: component.metric?.definition ?? null,
      sourceQueryId: component.metric?.sourceQueryId ?? null,
      metricValue: component.metricValue === null ? null : Number(component.metricValue),
      normalisedScore: component.normalisedScore === null ? null : Number(component.normalisedScore),
      weight: Number(component.weight),
      amountMinor: Number(component.amountMinor),
      formulaText: component.formulaText,
    }));

    const componentSum = components.reduce((sum, component) => sum + component.amountMinor, 0);

    return {
      incentiveId: incentive.id,
      staff: incentive.staff,
      periodStart: incentive.periodStart,
      periodEnd: incentive.periodEnd,
      status: incentive.status,
      poolReference: incentive.poolReference,
      totalAmountMinor: Number(incentive.totalAmountMinor),
      currency: incentive.currency,
      computedAt: incentive.computedAt,
      computedBy: incentive.createdBy,
      approvedBy: incentive.approvedBy,
      approvedAt: incentive.approvedAt,
      components,
      // Asserted on every read rather than trusted. If these ever disagree,
      // somebody changed a total without changing what explains it.
      componentsSumToTotal: componentSum === Number(incentive.totalAmountMinor),
      componentSumMinor: componentSum,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Configurable, never hard-coded (spec §35 applied to the volume ceiling). */
  private async rules(): Promise<IncentiveRules> {
    return DEFAULT_INCENTIVE_RULES;
  }

  private async activeMetrics(organisationId: string, facilityId?: string): Promise<MetricDefinition[]> {
    const rows = await this.prisma.performanceMetric.findMany({
      where: {
        organisationId,
        status: 'ACTIVE',
        OR: [{ facilityId: null }, ...(facilityId ? [{ facilityId }] : [])],
      },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        direction: true,
        weight: true,
        targetValue: true,
        sourceQueryId: true,
      },
    });

    return rows.map((row) => this.toDefinition(row));
  }

  private toDefinition(row: {
    id: string;
    code: string;
    name: string;
    unit: string | null;
    direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
    weight: { toString(): string };
    targetValue: { toString(): string } | null;
    sourceQueryId: string | null;
  }): MetricDefinition {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      unit: row.unit,
      direction: row.direction,
      weight: Number(row.weight.toString()),
      targetValue: row.targetValue === null ? null : Number(row.targetValue.toString()),
      sourceQueryId: row.sourceQueryId,
      // Read from the catalogue, not from the metric row. A volume query
      // cannot be relabelled as a quality metric by editing a checkbox.
      isVolumeMetric: row.sourceQueryId
        ? (STAFF_METRIC_QUERIES.get(row.sourceQueryId)?.isVolumeMetric ?? false)
        : false,
    };
  }

  private async proposedMetricSet(
    organisationId: string,
    input: ConfigureMetric,
    existingId: string | null,
  ): Promise<MetricDefinition[]> {
    const others = (await this.activeMetrics(organisationId, input.facilityId)).filter(
      (metric) => metric.id !== existingId && metric.code !== input.code,
    );

    const query = getStaffMetricQuery(input.sourceQueryId);

    return [
      ...others,
      {
        id: existingId ?? 'proposed',
        code: input.code,
        name: input.name,
        unit: input.unit ?? query.unit,
        direction: input.direction,
        weight: input.weight,
        targetValue: input.targetValue ?? null,
        sourceQueryId: input.sourceQueryId,
        isVolumeMetric: query.isVolumeMetric,
      },
    ];
  }

  private async requireStaff(staffId: string, facilityId: string) {
    const person = await this.prisma.staff.findFirst({
      where: { id: staffId, facilityId, deletedAt: null },
      select: { id: true, givenName: true, familyName: true, status: true },
    });

    if (!person) throw new NotFoundException('No such member of staff at this facility.');
    return person;
  }
}
