import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  acknowledgeResultSchema,
  collectSampleSchema,
  enterResultSchema,
  orderLabTestsSchema,
  rejectSampleSchema,
  verifyResultSchema,
  type CollectSample,
  type EnterResult,
  type OrderLabTests,
} from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { LaboratoryService } from './laboratory.service';

@Controller({ path: 'laboratory', version: '1' })
export class LaboratoryController {
  constructor(private readonly laboratory: LaboratoryService) {}

  @Post('orders')
  @RequirePermission('lab.order')
  @AuditAction('laboratory.order')
  order(@Body(zodBody(orderLabTestsSchema)) body: OrderLabTests) {
    return this.laboratory.order(body);
  }

  @Post('samples')
  @RequirePermission('lab.collect')
  @AuditAction('laboratory.sample.collect')
  collectSample(@Body(zodBody(collectSampleSchema)) body: CollectSample) {
    return this.laboratory.collectSample(body);
  }

  /** A rejected sample is a clinical event: the patient must be bled again. */
  @Post('samples/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lab.collect')
  @AuditAction('laboratory.sample.reject')
  rejectSample(@Param('id') id: string, @Body(zodBody(rejectSampleSchema)) body: { reason: string }) {
    return this.laboratory.rejectSample(id, body);
  }

  /** Entered, not released. It is a machine reading until verified. */
  @Post('results')
  @RequirePermission('lab.process')
  @AuditAction('laboratory.result.enter')
  enterResult(@Body(zodBody(enterResultSchema)) body: EnterResult) {
    return this.laboratory.enterResult(body);
  }

  @Post('results/:id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lab.verify')
  @AuditAction('laboratory.result.verify')
  verifyResult(@Param('id') id: string, @Body(zodBody(verifyResultSchema)) body: { comment?: string }) {
    return this.laboratory.verifyResult(id, body);
  }

  /** Critical results still waiting, and who to tell next. */
  @Get('critical')
  @RequirePermission('lab.read')
  pendingCritical(@Query('facilityId') facilityId: string) {
    return this.laboratory.pendingCriticalResults(facilityId);
  }

  /** The only thing that stops escalation. */
  @Post('results/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('clinical.read')
  @AuditAction('laboratory.result.acknowledge')
  acknowledgeResult(
    @Param('id') id: string,
    @Body(zodBody(acknowledgeResultSchema)) body: { actionTaken: string },
  ) {
    return this.laboratory.acknowledgeResult(id, body);
  }

  @Get('results/encounter/:encounterId')
  @RequirePermission('lab.read')
  resultsForEncounter(@Param('encounterId') encounterId: string) {
    return this.laboratory.resultsForEncounter(encounterId);
  }
}
