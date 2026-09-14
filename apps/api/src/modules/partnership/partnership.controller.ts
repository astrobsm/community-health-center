import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  createObligationSchema,
  createPartnershipSchema,
  createPartySchema,
  createRecoveryEventSchema,
  createRevenueShareModelSchema,
  settleObligationSchema,
  type CreateObligation,
  type CreatePartnership,
  type CreateParty,
  type CreateRecoveryEvent,
  type CreateRevenueShareModel,
} from '@chc/contracts';
import { z } from 'zod';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { PartnershipService } from './partnership.service';

@Controller({ path: 'partnerships', version: '1' })
export class PartnershipController {
  constructor(private readonly partnerships: PartnershipService) {}

  @Post()
  @RequirePermission('partnership.write')
  @AuditAction('partnership.create')
  create(@Body(zodBody(createPartnershipSchema)) body: CreatePartnership) {
    return this.partnerships.create(body);
  }

  @Get(':id')
  @RequirePermission('partnership.read')
  get(@Param('id') id: string) {
    return this.partnerships.get(id);
  }

  @Post('parties')
  @RequirePermission('partnership.write')
  @AuditAction('partnership.party.add')
  addParty(@Body(zodBody(createPartySchema)) body: CreateParty) {
    return this.partnerships.addParty(body);
  }

  /**
   * Agree a new version of the sharing arrangement.
   *
   * Every percentage any party is entitled to lives in the steps of this
   * request. None is hard-coded anywhere in the system (spec §35).
   */
  @Post('revenue-share-models')
  @RequirePermission('partnership.write')
  @AuditAction('partnership.revenue_share.create')
  createRevenueShareModel(
    @Body(zodBody(createRevenueShareModelSchema)) body: CreateRevenueShareModel,
  ) {
    return this.partnerships.createRevenueShareModel(body);
  }

  /**
   * What each party is entitled to for one financial period.
   *
   * Computed from the posted ledger and the terms in force when the period
   * began — never from the latest terms, so a renegotiation cannot change what
   * was owed for a period already settled.
   */
  @Get(':id/settlement/:financialPeriodId')
  @RequirePermission('partnership.compute_waterfall')
  settlement(@Param('id') id: string, @Param('financialPeriodId') financialPeriodId: string) {
    return this.partnerships.settlement(id, financialPeriodId);
  }

  @Get(':id/capital-recovery')
  @RequirePermission('partnership.read')
  capitalRecovery(@Param('id') id: string) {
    return this.partnerships.capitalRecovery(id);
  }

  @Post('recovery-events')
  @RequirePermission('partnership.write')
  @AuditAction('partnership.recovery.record')
  recordRecoveryEvent(@Body(zodBody(createRecoveryEventSchema)) body: CreateRecoveryEvent) {
    return this.partnerships.recordRecoveryEvent(body);
  }

  @Post('obligations')
  @RequirePermission('partnership.write')
  @AuditAction('partnership.obligation.create')
  createObligation(@Body(zodBody(createObligationSchema)) body: CreateObligation) {
    return this.partnerships.createObligation(body);
  }

  @Post('obligations/:id/settle')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('partnership.write')
  @AuditAction('partnership.obligation.settle')
  settleObligation(
    @Param('id') id: string,
    @Body(zodBody(settleObligationSchema)) body: z.infer<typeof settleObligationSchema>,
  ) {
    return this.partnerships.settleObligation(id, body);
  }
}
