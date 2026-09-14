import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AssignKpi, ComputeKpi } from '@chc/contracts';

import { UnknownMetricQueryHttpError } from '../../common/errors';
import { UnknownMetricQueryError, type MetricQueryParams } from '../../common/metric-query';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';

import { getKpiQuery, listKpiQueries } from './kpi-queries';

/**
 * The KPI engine (spec §38).
 *
 * Three properties hold for every figure this produces:
 *
 *   1. It was computed from transactions by a named query, never typed in.
 *   2. It carries its denominator, its classification and the moment it was
 *      computed, so nothing can be shown as a bare number.
 *   3. Its baseline comes from a sealed Day 0 snapshot while its current value
 *      is recomputed from the ledger, which is what makes the two structurally
 *      incapable of being confused (doc 22 §3).
 *
 * Small denominators are suppressed rather than published. A rate over three
 * patients can identify them, and "50% of patients" over two people is not a
 * statistic.
 */
@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
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

  /** The catalogue a KPI may be built on. */
  listQueries() {
    return {
      note:
        'Every KPI names one of these queries. Nothing in this system accepts a typed-in KPI value, ' +
        'which is how a dashboard figure is guaranteed to have come from the records rather than from ' +
        'somebody who wanted it to look better.',
      queries: listKpiQueries(),
    };
  }

  async listRegistry() {
    const { organisationId } = getTenantScope();

    const kpis = await this.prisma.kpi.findMany({
      where: { OR: [{ organisationId }, { organisationId: null }] },
      orderBy: [{ domainCode: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        definition: true,
        unit: true,
        domainCode: true,
        direction: true,
        sourceQueryId: true,
        defaultPeriod: true,
      },
    });

    return kpis.map((kpi) => ({
      ...kpi,
      // A KPI whose query is missing cannot be computed. Saying so here is the
      // difference between a dashboard that is empty and one that is wrong.
      computable: getKpiQuerySafely(kpi.sourceQueryId) !== null,
    }));
  }

  // ---------------------------------------------------------------------------
  // Assignment
  // ---------------------------------------------------------------------------

  async assign(input: AssignKpi) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const kpi = await this.prisma.kpi.findFirst({
      where: { code: input.kpiCode, OR: [{ organisationId }, { organisationId: null }] },
      select: { id: true, code: true, name: true, unit: true, direction: true, sourceQueryId: true },
    });

    if (!kpi) throw new NotFoundException(`No KPI with code "${input.kpiCode}".`);

    try {
      getKpiQuery(kpi.sourceQueryId);
    } catch (error) {
      if (error instanceof UnknownMetricQueryError) throw new UnknownMetricQueryHttpError(error.message);
      throw error;
    }

    if (
      input.amberThreshold !== undefined &&
      input.redThreshold !== undefined &&
      input.redThreshold > input.amberThreshold
    ) {
      throw new BadRequestException(
        'The red threshold is above the amber one, which would make every amber result red as well. ' +
          'Red is the lower fraction of target.',
      );
    }

    // The baseline comes from the sealed Day 0 snapshot, matched by metric
    // code. It is never recomputed and never edited here: that is the whole
    // point of sealing it (§12).
    const baseline = await this.prisma.baselineMetric.findFirst({
      where: { facilityId: input.facilityId, metricCode: kpi.code },
      orderBy: { snapshot: { sequence: 'asc' } },
      select: {
        id: true,
        numericValue: true,
        classification: true,
        snapshot: { select: { id: true, sequence: true, label: true, asOfDate: true } },
      },
    });

    const context = tryGetContext();

    const data = {
      organisationId,
      baselineSnapshotId: baseline?.snapshot.id,
      baselineMetricId: baseline?.id,
      baselineValue: baseline?.numericValue,
      targetValue: input.targetValue,
      targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
      ownerUserId: input.ownerUserId ?? context?.userId,
      amberThreshold: input.amberThreshold,
      redThreshold: input.redThreshold,
    };

    const assignment = await this.prisma.kpiAssignment.upsert({
      where: { kpiId_facilityId: { kpiId: kpi.id, facilityId: input.facilityId } },
      create: { ...data, kpiId: kpi.id, facilityId: input.facilityId, createdBy: context?.userId },
      update: { ...data, version: { increment: 1 } },
      select: {
        id: true,
        baselineValue: true,
        targetValue: true,
        targetDate: true,
        amberThreshold: true,
        redThreshold: true,
      },
    });

    await this.audit.record({
      action: 'kpi.assign',
      entityType: 'kpi_assignment',
      entityId: assignment.id,
      facilityId: input.facilityId,
      newValue: {
        kpi: kpi.code,
        targetValue: input.targetValue ?? null,
        baselineValue: baseline?.numericValue?.toString() ?? null,
      },
      severity: 'NOTICE',
    });

    return {
      id: assignment.id,
      kpi,
      baselineValue: assignment.baselineValue === null ? null : Number(assignment.baselineValue),
      targetValue: assignment.targetValue === null ? null : Number(assignment.targetValue),
      targetDate: assignment.targetDate,
      baseline: baseline
        ? {
            snapshot: baseline.snapshot.label,
            sequence: baseline.snapshot.sequence,
            asOfDate: baseline.snapshot.asOfDate,
            classification: baseline.classification,
          }
        : null,
      baselineNote: baseline
        ? undefined
        : `No sealed baseline metric matches the code "${kpi.code}", so this KPI has no Day 0 comparison. ` +
          'Change against baseline will be reported as unavailable rather than as zero.',
    };
  }

  // ---------------------------------------------------------------------------
  // Computation
  // ---------------------------------------------------------------------------

  async compute(input: ComputeKpi) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const assignments = await this.prisma.kpiAssignment.findMany({
      where: {
        facilityId: input.facilityId,
        status: 'ACTIVE',
        ...(input.kpiCode ? { kpi: { code: input.kpiCode } } : {}),
      },
      select: {
        id: true,
        baselineValue: true,
        targetValue: true,
        amberThreshold: true,
        redThreshold: true,
        kpi: { select: { id: true, code: true, name: true, unit: true, direction: true, sourceQueryId: true } },
      },
    });

    if (assignments.length === 0) {
      throw new BadRequestException(
        input.kpiCode
          ? `"${input.kpiCode}" is not assigned to this facility. Assign it first.`
          : 'No KPI is assigned to this facility, so there is nothing to compute.',
      );
    }

    const threshold = await this.config.number('kpi.smallCellThreshold', 5, input.facilityId);
    const computedAt = this.now();

    const params: MetricQueryParams = {
      organisationId,
      facilityId: input.facilityId,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      now: computedAt,
    };

    const results = [];

    for (const assignment of assignments) {
      let query;
      try {
        query = getKpiQuery(assignment.kpi.sourceQueryId);
      } catch (error) {
        if (error instanceof UnknownMetricQueryError) {
          // Reported, not skipped silently. A KPI on the dashboard that
          // quietly never computes is worse than one that says why.
          results.push({
            code: assignment.kpi.code,
            name: assignment.kpi.name,
            value: null,
            status: 'NOT_ASSESSED' as const,
            error: error.message,
          });
          continue;
        }
        throw error;
      }

      const outcome = await query.run(this.prisma, params);

      // Small-cell suppression (doc 08 §5): a rate over a handful of patients
      // can identify them, and a percentage of three people is not a statistic.
      const suppressed =
        outcome.value !== null &&
        outcome.sampleSize !== null &&
        outcome.sampleSize > 0 &&
        outcome.sampleSize < threshold &&
        query.suppressSmallCells;

      const value = suppressed ? null : outcome.value;

      const baselineValue = assignment.baselineValue === null ? null : Number(assignment.baselineValue);
      const targetValue = assignment.targetValue === null ? null : Number(assignment.targetValue);

      const status = ragStatus({
        value,
        targetValue,
        direction: assignment.kpi.direction,
        amber: assignment.amberThreshold === null ? null : Number(assignment.amberThreshold),
        red: assignment.redThreshold === null ? null : Number(assignment.redThreshold),
      });

      const stored = await this.prisma.kpiResult.upsert({
        where: {
          kpiAssignmentId_periodStart_periodEnd: {
            kpiAssignmentId: assignment.id,
            periodStart: params.periodStart,
            periodEnd: params.periodEnd,
          },
        },
        create: {
          kpiAssignmentId: assignment.id,
          organisationId,
          facilityId: input.facilityId,
          periodStart: params.periodStart,
          periodEnd: params.periodEnd,
          value,
          targetValue: assignment.targetValue,
          baselineValue: assignment.baselineValue,
          varianceToTarget: value !== null && targetValue !== null ? value - targetValue : null,
          changeFromBaseline: value !== null && baselineValue !== null ? value - baselineValue : null,
          status,
          classification: 'ACTUAL',
          sampleSize: outcome.sampleSize,
          isSuppressed: suppressed,
          suppressionReason: suppressed
            ? `Fewer than ${threshold} observations. Publishing a rate over so few people could identify them.`
            : null,
          inputs: { ...outcome.inputs, sourceQueryId: assignment.kpi.sourceQueryId, note: outcome.note ?? null },
          computedAt,
        },
        update: {
          value,
          targetValue: assignment.targetValue,
          baselineValue: assignment.baselineValue,
          varianceToTarget: value !== null && targetValue !== null ? value - targetValue : null,
          changeFromBaseline: value !== null && baselineValue !== null ? value - baselineValue : null,
          status,
          sampleSize: outcome.sampleSize,
          isSuppressed: suppressed,
          suppressionReason: suppressed
            ? `Fewer than ${threshold} observations. Publishing a rate over so few people could identify them.`
            : null,
          inputs: { ...outcome.inputs, sourceQueryId: assignment.kpi.sourceQueryId, note: outcome.note ?? null },
          computedAt,
        },
        select: { id: true },
      });

      results.push({
        resultId: stored.id,
        code: assignment.kpi.code,
        name: assignment.kpi.name,
        unit: assignment.kpi.unit,
        direction: assignment.kpi.direction,
        sourceQueryId: assignment.kpi.sourceQueryId,
        value,
        sampleSize: outcome.sampleSize,
        baselineValue,
        targetValue,
        changeFromBaseline: value !== null && baselineValue !== null ? round6(value - baselineValue) : null,
        varianceToTarget: value !== null && targetValue !== null ? round6(value - targetValue) : null,
        status,
        // Never a bare number: every figure travels with what it is and when
        // it was worked out (§82).
        classification: 'ACTUAL' as const,
        computedAt: computedAt.toISOString(),
        isSuppressed: suppressed,
        note: suppressed
          ? `Withheld: fewer than ${threshold} observations.`
          : (outcome.note ?? undefined),
        inputs: outcome.inputs,
      });
    }

    await this.audit.record({
      action: 'kpi.compute',
      entityType: 'facility',
      entityId: input.facilityId,
      facilityId: input.facilityId,
      newValue: {
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        computed: results.filter((result) => result.value !== null).length,
        suppressed: results.filter((result) => 'isSuppressed' in result && result.isSuppressed).length,
        total: results.length,
      },
    });

    return {
      facilityId: input.facilityId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      computedAt: computedAt.toISOString(),
      smallCellThreshold: threshold,
      results,
    };
  }

  async list(facilityId: string, periodEnd?: string) {
    this.assertFacilityVisible(facilityId);

    const assignments = await this.prisma.kpiAssignment.findMany({
      where: { facilityId, status: 'ACTIVE' },
      select: {
        id: true,
        baselineValue: true,
        targetValue: true,
        targetDate: true,
        kpi: { select: { code: true, name: true, definition: true, unit: true, direction: true, sourceQueryId: true } },
        baselineSnapshot: { select: { label: true, sequence: true, asOfDate: true, sealedAt: true } },
        results: {
          where: periodEnd ? { periodEnd: new Date(periodEnd) } : {},
          orderBy: { periodEnd: 'desc' },
          take: 1,
          select: {
            id: true,
            periodStart: true,
            periodEnd: true,
            value: true,
            status: true,
            sampleSize: true,
            isSuppressed: true,
            suppressionReason: true,
            changeFromBaseline: true,
            varianceToTarget: true,
            classification: true,
            computedAt: true,
            inputs: true,
          },
        },
      },
    });

    return assignments.map((assignment) => {
      const latest = assignment.results[0];

      return {
        kpi: assignment.kpi,
        baseline: assignment.baselineSnapshot
          ? {
              value: assignment.baselineValue === null ? null : Number(assignment.baselineValue),
              snapshot: assignment.baselineSnapshot.label,
              sequence: assignment.baselineSnapshot.sequence,
              asOfDate: assignment.baselineSnapshot.asOfDate,
              sealedAt: assignment.baselineSnapshot.sealedAt,
            }
          : null,
        target: {
          value: assignment.targetValue === null ? null : Number(assignment.targetValue),
          date: assignment.targetDate,
        },
        latest: latest
          ? {
              ...latest,
              value: latest.value === null ? null : Number(latest.value),
              changeFromBaseline:
                latest.changeFromBaseline === null ? null : Number(latest.changeFromBaseline),
              varianceToTarget: latest.varianceToTarget === null ? null : Number(latest.varianceToTarget),
            }
          : null,
        // Distinguishes "we measured and it is bad" from "nobody has computed
        // this yet" — two very different things on a report to government.
        measured: latest !== undefined,
        note:
          latest === undefined
            ? 'No result has been computed for this KPI. It is assigned but unmeasured.'
            : undefined,
      };
    });
  }

  /**
   * Everything behind one computed figure (criterion B, in its R9 form).
   *
   * The stored inputs name the query, its counts and its period, so a figure
   * somebody disputes can be taken apart without re-running anything.
   */
  async explain(resultId: string) {
    const { facilityIds } = getTenantScope();

    const result = await this.prisma.kpiResult.findFirst({
      where: { id: resultId, facilityId: { in: [...facilityIds] } },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        value: true,
        targetValue: true,
        baselineValue: true,
        varianceToTarget: true,
        changeFromBaseline: true,
        status: true,
        classification: true,
        sampleSize: true,
        isSuppressed: true,
        suppressionReason: true,
        inputs: true,
        computedAt: true,
        kpiAssignment: {
          select: {
            kpi: { select: { code: true, name: true, definition: true, unit: true, direction: true, sourceQueryId: true } },
            baselineSnapshot: { select: { label: true, asOfDate: true, sealedAt: true, contentHash: true } },
          },
        },
      },
    });

    if (!result) throw new NotFoundException('No such KPI result, or it is not visible to you.');

    const query = getKpiQuerySafely(result.kpiAssignment.kpi.sourceQueryId);

    return {
      ...result,
      value: result.value === null ? null : Number(result.value),
      targetValue: result.targetValue === null ? null : Number(result.targetValue),
      baselineValue: result.baselineValue === null ? null : Number(result.baselineValue),
      varianceToTarget: result.varianceToTarget === null ? null : Number(result.varianceToTarget),
      changeFromBaseline: result.changeFromBaseline === null ? null : Number(result.changeFromBaseline),
      kpi: result.kpiAssignment.kpi,
      baselineSnapshot: result.kpiAssignment.baselineSnapshot,
      query: query
        ? { id: query.id, definition: query.definition, reads: query.reads }
        : { id: result.kpiAssignment.kpi.sourceQueryId, definition: null, reads: [] },
      // Spelled out rather than implied. The baseline is a sealed snapshot; the
      // current value was recomputed from transactions just now. They cannot
      // be conflated, and the reader should be able to see why.
      provenance:
        'The current value was computed from transaction records by the named query at the time shown. ' +
        'The baseline value comes from a sealed snapshot and is never recomputed.',
    };
  }
}

function getKpiQuerySafely(id: string) {
  try {
    return getKpiQuery(id);
  } catch {
    return null;
  }
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Red, amber or green against target.
 *
 * NOT_ASSESSED where there is no value or no target — the honest answer, and
 * better than a green tick that means "we never checked".
 */
function ragStatus(params: {
  value: number | null;
  targetValue: number | null;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER' | 'TARGET_RANGE';
  amber: number | null;
  red: number | null;
}): 'GREEN' | 'AMBER' | 'RED' | 'NOT_ASSESSED' {
  const { value, targetValue, direction } = params;
  if (value === null || targetValue === null || targetValue === 0) return 'NOT_ASSESSED';
  if (direction === 'TARGET_RANGE') return 'NOT_ASSESSED';

  const amber = params.amber ?? 0.9;
  const red = params.red ?? 0.75;

  // Achievement as a fraction of target, the right way round for the metric's
  // direction: for a lower-is-better KPI, being under target is achieving it.
  const achievement = direction === 'HIGHER_BETTER' ? value / targetValue : targetValue / value;

  if (achievement >= amber) return 'GREEN';
  if (achievement >= red) return 'AMBER';
  return 'RED';
}
