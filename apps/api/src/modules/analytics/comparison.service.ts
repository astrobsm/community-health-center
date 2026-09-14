import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { BenchmarkQuery, ComparisonQuery, Permission } from '@chc/contracts';

import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigService } from '../config/config.service';

import { benchmark, DEFAULT_BENCHMARK_RULES, type BenchmarkEntry } from './domain/benchmark';
import { compare, type ComparisonInput } from './domain/comparison';

/**
 * Baseline against current against target, and facility against facility
 * (acceptance criterion B; spec §§40-41).
 *
 * The comparison reads its two halves from two structurally different places
 * and hands them to a pure engine that has no way to fetch either. The
 * baseline comes from `assess.baseline_metric`, sealed at Day 0 and immutable;
 * the current value from `qual.kpi_result`, recomputed from transactions. No
 * code path in this service reads the baseline table when producing a current
 * value, which is what makes conflating them structurally impossible rather
 * than merely discouraged (doc 22 §3).
 */
@Injectable()
export class ComparisonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private assertFacilityVisible(facilityId: string): void {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }
  }

  private can(permission: Permission): boolean {
    return tryGetContext()?.permissions.has(permission) ?? false;
  }

  async compare(query: ComparisonQuery) {
    this.assertFacilityVisible(query.facilityId);

    const assignments = await this.prisma.kpiAssignment.findMany({
      where: {
        facilityId: query.facilityId,
        status: 'ACTIVE',
        ...(query.kpiCode ? { kpi: { code: query.kpiCode } } : {}),
      },
      select: {
        id: true,
        targetValue: true,
        targetDate: true,
        kpi: { select: { id: true, code: true, name: true, unit: true, direction: true } },
        // The sealed half is fetched separately, below, by its id. The
        // assignment carries only a pointer to it.
        baselineMetricId: true,
        results: {
          where: { periodStart: new Date(query.periodStart), periodEnd: new Date(query.periodEnd) },
          take: 1,
          select: {
            id: true,
            value: true,
            classification: true,
            computedAt: true,
            sampleSize: true,
            isSuppressed: true,
            suppressionReason: true,
          },
        },
      },
    });

    if (assignments.length === 0) {
      throw new NotFoundException(
        query.kpiCode
          ? `"${query.kpiCode}" is not assigned to this facility.`
          : 'No KPI is assigned to this facility, so there is nothing to compare.',
      );
    }

    // The sealed half, read from `assess.baseline_metric` — a different table,
    // by a different query, from the current values above.
    const baselineIds = assignments
      .map((assignment) => assignment.baselineMetricId)
      .filter((id): id is string => id !== null);

    const baselineMetrics = await this.prisma.baselineMetric.findMany({
      where: { id: { in: baselineIds } },
      select: {
        id: true,
        numericValue: true,
        classification: true,
        snapshot: { select: { label: true, sealedAt: true } },
      },
    });

    const baselines = new Map(baselineMetrics.map((metric) => [metric.id, metric]));

    const comparisons = assignments.map((assignment) => {
      const result = assignment.results[0];
      const baseline = assignment.baselineMetricId
        ? (baselines.get(assignment.baselineMetricId) ?? null)
        : null;

      const input: ComparisonInput = {
        kpiCode: assignment.kpi.code,
        kpiName: assignment.kpi.name,
        unit: assignment.kpi.unit,
        direction: assignment.kpi.direction,
        baseline: baseline
          ? {
              value: baseline.numericValue === null ? null : Number(baseline.numericValue),
              classification: baseline.classification,
              sealedAt: baseline.snapshot.sealedAt,
              label: baseline.snapshot.label,
            }
          : null,
        current:
          result && !result.isSuppressed
            ? {
                value: result.value === null ? null : Number(result.value),
                classification: result.classification,
                computedAt: result.computedAt,
                sampleSize: result.sampleSize,
              }
            : null,
        target: {
          value: assignment.targetValue === null ? null : Number(assignment.targetValue),
          date: assignment.targetDate,
        },
      };

      return {
        ...compare(input),
        resultId: result?.id ?? null,
        // The drill-down for a comparison is the result's own lineage: the
        // named query, its inputs, and the sealed snapshot beside it.
        drillDownHref: result ? `/api/v1/lineage/kpi_result/${result.id}/upstream` : null,
        suppressed: result?.isSuppressed ?? false,
        suppressionReason: result?.suppressionReason ?? null,
      };
    });

    return {
      facilityId: query.facilityId,
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      comparisons,
      // Repeated on every payload, because this is the sentence that keeps the
      // whole comparison honest.
      provenance:
        'Baseline values come from a snapshot sealed at Day 0 and never recomputed. Current values are ' +
        'recomputed from transactions by a named query. The two are read from different tables by ' +
        'different code paths, so they cannot be conflated.',
      measured: comparisons.filter((comparison) => comparison.comparable).length,
      unmeasured: comparisons.filter((comparison) => !comparison.comparable).length,
    };
  }

  /**
   * Compare this facility with the others in the organisation (spec §§40-41).
   *
   * Behind `analytics.benchmark`, which is granted deliberately and is not part
   * of READ_EVERYTHING: seeing your own figures and ranking other people's are
   * different capabilities.
   */
  async benchmark(query: BenchmarkQuery) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!this.can('analytics.benchmark')) {
      throw new ForbiddenException(
        'Comparing facilities requires analytics.benchmark. Reading your own facility does not grant it.',
      );
    }

    const kpi = await this.prisma.kpi.findFirst({
      where: { code: query.kpiCode, OR: [{ organisationId }, { organisationId: null }] },
      select: { id: true, code: true, name: true, unit: true, direction: true, definition: true },
    });

    if (!kpi) throw new NotFoundException(`No KPI with code "${query.kpiCode}".`);

    if (kpi.direction === 'TARGET_RANGE') {
      throw new ForbiddenException(
        `"${kpi.name}" is scored against a range, so there is no single direction in which one facility ` +
          'is better than another. Ranking it would invent one.',
      );
    }

    const results = await this.prisma.kpiResult.findMany({
      where: {
        organisationId,
        facilityId: { in: [...facilityIds] },
        kpiAssignment: { kpiId: kpi.id },
        periodStart: new Date(query.periodStart),
        periodEnd: new Date(query.periodEnd),
      },
      select: {
        facilityId: true,
        value: true,
        sampleSize: true,
        isSuppressed: true,
      },
    });

    const facilities = await this.prisma.facility.findMany({
      where: { id: { in: [...facilityIds] } },
      select: { id: true, name: true },
    });

    const byFacility = new Map(results.map((result) => [result.facilityId, result]));

    const entries: BenchmarkEntry[] = facilities.map((facility) => {
      const result = byFacility.get(facility.id);
      return {
        facilityId: facility.id,
        facilityName: facility.name,
        value: !result || result.isSuppressed || result.value === null ? null : Number(result.value),
        sampleSize: result?.sampleSize ?? null,
      };
    });

    const rules = {
      minimumFacilities: await this.config.number(
        'analytics.benchmarkMinimumFacilities',
        DEFAULT_BENCHMARK_RULES.minimumFacilities,
      ),
      smallCellThreshold: await this.config.number(
        'analytics.smallCellThreshold',
        DEFAULT_BENCHMARK_RULES.smallCellThreshold,
      ),
    };

    return {
      kpi,
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      ...benchmark(entries, kpi.direction, rules),
      rules,
    };
  }
}
