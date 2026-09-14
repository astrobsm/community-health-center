import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { applyAssumptionChangeSchema, modelAssumptionsSchema, type ScenarioType } from '@chc/contracts';
import { z } from 'zod';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { FinancialModelService } from './financial-model.service';

const createModelSchema = z.object({
  facilityId: z.string().uuid(),
  name: z.string().min(3).max(200),
  startDate: z.string(),
  horizonMonths: z.number().int().min(1).max(120).optional(),
  assumptions: modelAssumptionsSchema,
});

const computeScenarioSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  /** Code -> value. Each code must be one this model already holds. */
  overrides: z.record(z.string(), z.number()).optional(),
});

const previewSchema = z.object({ value: z.number() });

const unlockSchema = z.object({
  reason: z.string().min(10).max(1000),
});

const approveSchema = z.object({ note: z.string().max(1000).optional() });

const scenarioTypeSchema = z.enum(['CONSERVATIVE', 'BASE', 'GROWTH', 'STRESS']);

@Controller({ path: 'financial-models', version: '1' })
export class FinancialModelController {
  constructor(private readonly models: FinancialModelService) {}

  @Post()
  @RequirePermission('financial_model.write')
  @AuditAction('financial_model.create')
  create(@Body(zodBody(createModelSchema)) body: z.infer<typeof createModelSchema>) {
    return this.models.create(body);
  }

  @Get(':id')
  @RequirePermission('financial_model.read')
  get(@Param('id') id: string) {
    return this.models.get(id);
  }

  /** Runs the projection and replaces the scenario's periods. */
  @Post(':id/scenarios/:scenarioType/compute')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('financial_model.write')
  @AuditAction('financial_model.scenario.compute')
  compute(
    @Param('id') id: string,
    @Param('scenarioType') scenarioType: string,
    @Body(zodBody(computeScenarioSchema)) body: z.infer<typeof computeScenarioSchema>,
  ) {
    return this.models.computeScenario(id, scenarioTypeSchema.parse(scenarioType) as ScenarioType, body);
  }

  /** The stored periods, flagged stale if an assumption has moved since. */
  @Get(':id/scenarios/:scenarioType')
  @RequirePermission('financial_model.read')
  scenario(@Param('id') id: string, @Param('scenarioType') scenarioType: string) {
    return this.models.getScenario(id, scenarioTypeSchema.parse(scenarioType) as ScenarioType);
  }

  /** One-at-a-time sensitivity across the drivers the case rests on (§34). */
  @Get(':id/sensitivity')
  @RequirePermission('financial_model.read')
  sensitivity(@Param('id') id: string) {
    return this.models.sensitivity(id);
  }

  /**
   * What this change would do, before anything is written (§72).
   *
   * Readable on an approved model too: seeing the consequence is how someone
   * decides whether to ask for an unlock at all.
   */
  @Post(':id/assumptions/:code/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('financial_model.read')
  preview(
    @Param('id') id: string,
    @Param('code') code: string,
    @Body(zodBody(previewSchema)) body: z.infer<typeof previewSchema>,
  ) {
    return this.models.previewAssumptionChange(id, code, body.value);
  }

  /** Refused with 423 while the model is approved. */
  @Post(':id/assumptions/:code')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('financial_model.write')
  @AuditAction('financial_model.assumption.change')
  change(
    @Param('id') id: string,
    @Param('code') code: string,
    @Body(zodBody(applyAssumptionChangeSchema)) body: z.infer<typeof applyAssumptionChangeSchema>,
  ) {
    return this.models.applyAssumptionChange(id, code, body);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('financial_model.approve')
  @AuditAction('financial_model.approve')
  approve(@Param('id') id: string, @Body(zodBody(approveSchema)) body: z.infer<typeof approveSchema>) {
    return this.models.approve(id, body);
  }

  /**
   * Opens the next version for change. The approved version is left intact —
   * it is what a government partner was shown.
   */
  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('financial_model.unlock')
  @AuditAction('financial_model.unlock')
  unlock(@Param('id') id: string, @Body(zodBody(unlockSchema)) body: z.infer<typeof unlockSchema>) {
    return this.models.unlock(id, body);
  }
}
