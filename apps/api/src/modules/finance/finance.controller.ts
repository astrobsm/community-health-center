import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  closePeriodSchema,
  dailyCashSchema,
  openPeriodSchema,
  type DailyCash,
  type OpenPeriod,
} from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { FinanceService } from './finance.service';

@Controller({ path: 'finance', version: '1' })
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Post('periods')
  @RequirePermission('finance.post')
  @AuditAction('finance.period.open')
  openPeriod(@Body(zodBody(openPeriodSchema)) body: OpenPeriod) {
    return this.finance.openPeriod(body);
  }

  /** Refused while the period does not balance. */
  @Post('periods/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.close_period')
  @AuditAction('finance.period.close')
  closePeriod(@Param('id') id: string, @Body(zodBody(closePeriodSchema)) body: { note?: string }) {
    return this.finance.closePeriod(id, body);
  }

  /** Computed from the journal lines, never cached. */
  @Get('trial-balance')
  @RequirePermission('finance.read')
  trialBalance(@Query('facilityId') facilityId: string, @Query('periodId') periodId?: string) {
    return this.finance.trialBalance(facilityId, periodId);
  }

  @Post('daily-cash')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.reconcile')
  @AuditAction('finance.cash.reconcile')
  dailyCash(@Body(zodBody(dailyCashSchema)) body: DailyCash) {
    return this.finance.dailyCash(body);
  }

  /** The entries behind a figure, so any total can be opened up. */
  @Get('entries/:sourceType/:sourceId')
  @RequirePermission('finance.read')
  entries(
    @Query('facilityId') facilityId: string,
    @Param('sourceType') sourceType: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.finance.entriesFor(facilityId, sourceType, sourceId);
  }
}
