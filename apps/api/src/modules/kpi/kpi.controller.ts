import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { assignKpiSchema, computeKpiSchema, type AssignKpi, type ComputeKpi } from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { KpiService } from './kpi.service';

/**
 * The KPI engine (spec §38).
 *
 * There is deliberately no endpoint that sets a KPI value. A figure either
 * came from a named query over the records or it does not exist.
 */
@Controller({ path: 'kpis', version: '1' })
export class KpiController {
  constructor(private readonly kpi: KpiService) {}

  @Get('registry')
  @RequirePermission('kpi.read')
  registry() {
    return this.kpi.listRegistry();
  }

  @Get('queries')
  @RequirePermission('kpi.read')
  queries() {
    return this.kpi.listQueries();
  }

  @Post('assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('kpi.configure')
  @AuditAction('kpi.assign')
  assign(@Body(zodBody(assignKpiSchema)) body: AssignKpi) {
    return this.kpi.assign(body);
  }

  @Post('compute')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('kpi.compute')
  @AuditAction('kpi.compute')
  compute(@Body(zodBody(computeKpiSchema)) body: ComputeKpi) {
    return this.kpi.compute(body);
  }

  @Get()
  @RequirePermission('kpi.read')
  list(@Query('facilityId') facilityId: string, @Query('periodEnd') periodEnd?: string) {
    return this.kpi.list(facilityId, periodEnd);
  }

  @Get('results/:resultId')
  @RequirePermission('kpi.read')
  explain(@Param('resultId') resultId: string) {
    return this.kpi.explain(resultId);
  }
}
