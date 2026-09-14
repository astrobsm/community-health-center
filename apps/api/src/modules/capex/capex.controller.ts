import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { approveCapexLineSchema, createCapexLineSchema, type CreateCapexLine } from '@chc/contracts';
import { z } from 'zod';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { CapexService } from './capex.service';

const createCapexPlanSchema = z.object({
  facilityId: z.string().uuid(),
  name: z.string().min(3).max(200),
  notes: z.string().max(2000).optional(),
});

const workingCapitalSchema = z.object({
  monthsOfCover: z.number().int().min(1).max(24),
  openingStockMinor: z.number().int().nonnegative(),
  staffCostsMinor: z.number().int().nonnegative(),
  utilitiesMinor: z.number().int().nonnegative(),
  contingencyMinor: z.number().int().nonnegative(),
  assumptionsNote: z.string().max(2000).optional(),
});

@Controller({ path: 'capex-plans', version: '1' })
export class CapexController {
  constructor(private readonly capex: CapexService) {}

  @Post()
  @RequirePermission('capex.write')
  @AuditAction('planning.capex_plan.create')
  create(@Body(zodBody(createCapexPlanSchema)) body: z.infer<typeof createCapexPlanSchema>) {
    return this.capex.createCapexPlan(body);
  }

  @Get()
  @RequirePermission('capex.read')
  list(@Query('facilityId') facilityId: string) {
    return this.capex.listCapexPlans(facilityId);
  }

  /** The plan, its lines, totals computed on read, and the traceability of each line. */
  @Get(':id')
  @RequirePermission('capex.read')
  get(@Param('id') id: string) {
    return this.capex.getCapexPlan(id);
  }

  @Post('lines')
  @RequirePermission('capex.write')
  @AuditAction('planning.capex_line.create')
  addLine(@Body(zodBody(createCapexLineSchema)) body: CreateCapexLine) {
    return this.capex.addCapexLine(body);
  }

  /**
   * Approving is a separate permission from writing, and the service refuses
   * an approver who is also the estimator.
   */
  @Post('lines/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('capex.approve')
  @AuditAction('planning.capex_line.approve')
  approveLine(
    @Param('id') id: string,
    @Body(zodBody(approveCapexLineSchema)) body: z.infer<typeof approveCapexLineSchema>,
  ) {
    return this.capex.approveCapexLine(id, body);
  }

  @Post(':id/working-capital')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('capex.write')
  @AuditAction('planning.working_capital.set')
  setWorkingCapital(
    @Param('id') id: string,
    @Body(zodBody(workingCapitalSchema)) body: z.infer<typeof workingCapitalSchema>,
  ) {
    return this.capex.setWorkingCapital(id, body);
  }
}

