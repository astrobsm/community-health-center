import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  benchmarkQuerySchema,
  comparisonQuerySchema,
  dashboardQuerySchema,
  drillDownQuerySchema,
  searchQuerySchema,
} from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodQuery } from '../../common/pipes/zod-validation.pipe';

import { ComparisonService } from './comparison.service';
import { DashboardService } from './dashboard.service';
import { DataQualityService } from './data-quality.service';
import { LineageService } from './lineage.service';

/**
 * Analytics (spec §§36-42, 47, 60, 71).
 *
 * Everything here is read-only. There is no endpoint that sets a figure, and
 * that is not an omission — it is the point. A number on a dashboard either
 * came from a named query over the records or it does not exist.
 */
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly comparison: ComparisonService,
    private readonly dataQuality: DataQualityService,
  ) {}

  @Get('figures')
  @RequirePermission('analytics.read')
  catalogue() {
    return this.dashboard.catalogue();
  }

  @Get('dashboard')
  @RequirePermission('analytics.read')
  build(@Query(zodQuery(dashboardQuerySchema)) query: Record<string, never>) {
    return this.dashboard.build(query as never);
  }

  /**
   * The rows behind one figure.
   *
   * Permission is checked again here against the figure's own sections: seeing
   * a total does not entitle a caller to the records inside it.
   */
  @Get('drill-down')
  @RequirePermission('analytics.read')
  drillDown(@Query(zodQuery(drillDownQuerySchema)) query: Record<string, never>) {
    return this.dashboard.drillDown(query as never);
  }

  @Get('comparison')
  @RequirePermission('kpi.read')
  compare(@Query(zodQuery(comparisonQuerySchema)) query: Record<string, never>) {
    return this.comparison.compare(query as never);
  }

  @Get('benchmark')
  @RequirePermission('analytics.benchmark')
  benchmark(@Query(zodQuery(benchmarkQuerySchema)) query: Record<string, never>) {
    return this.comparison.benchmark(query as never);
  }

  @Get('trend')
  @RequirePermission('analytics.read')
  trend(
    @Query('facilityId') facilityId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
  ) {
    return this.dashboard.trend(facilityId, periodStart, periodEnd);
  }

  /**
   * Rebuild the cached rollup and check it against the base tables.
   *
   * A GET that changes something would be wrong, but so would hiding this
   * behind a write permission nobody operational holds: recomputing a derived
   * figure is the same act as recomputing a KPI, and carries the same
   * permission.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('kpi.compute')
  @AuditAction('analytics.refresh')
  refresh() {
    return this.dashboard.refresh();
  }

  @Get('data-quality')
  @RequirePermission('analytics.read')
  quality(
    @Query('facilityId') facilityId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
  ) {
    return this.dataQuality.assess(facilityId, periodStart, periodEnd);
  }

  @Get('search')
  @RequirePermission('facility.read')
  search(@Query(zodQuery(searchQuerySchema)) query: Record<string, never>) {
    return this.dataQuality.search(query as never);
  }
}

/**
 * Lineage (doc 22, acceptance criterion M).
 *
 * Given a figure or a record, what produced it and what it went on to affect.
 * Behind `analytics.read` at the door, and re-checked per hop inside — a hop
 * the caller may not follow is absent from the response with its reason
 * stated, rather than present and disabled.
 */
@Controller({ path: 'lineage', version: '1' })
export class LineageController {
  constructor(private readonly lineage: LineageService) {}

  @Get()
  @RequirePermission('analytics.read')
  supported() {
    return this.lineage.supported();
  }

  @Get(':entityType/:id/upstream')
  @RequirePermission('analytics.read')
  upstream(@Param('entityType') entityType: string, @Param('id') id: string) {
    return this.lineage.upstream(entityType, id);
  }

  @Get(':entityType/:id/downstream')
  @RequirePermission('analytics.read')
  downstream(@Param('entityType') entityType: string, @Param('id') id: string) {
    return this.lineage.downstream(entityType, id);
  }
}
