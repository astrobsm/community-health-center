import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { aiAskSchema, aiForecastSchema, aiReviewSchema, type AiAsk, type AiReview } from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';

import { AiService } from './ai.service';
import { InsightService } from './insight.service';

/**
 * The AI surface (spec §§53-54, doc 17).
 *
 * Every route here is a read. There is no endpoint by which this layer writes
 * to a clinical, financial or stock record, and the database role it uses holds
 * no such permission either — the absence is enforced twice, in different
 * places, because one of them might one day be edited by mistake.
 *
 * `/ai/status` is deliberately readable with the layer switched off. A facility
 * should be able to see that AI is off, and why that changes nothing.
 */
@Controller({ path: 'ai', version: '1' })
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly insights: InsightService,
  ) {}

  @Get('status')
  @RequirePermission('facility.read')
  status() {
    return this.ai.status();
  }

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ai.query')
  @AuditAction('ai.generate')
  ask(@Body(zodBody(aiAskSchema)) body: AiAsk) {
    return this.ai.ask(body);
  }

  @Get('insights')
  @RequirePermission('ai.query')
  list(@Query('facilityId') facilityId: string) {
    return this.ai.list(facilityId);
  }

  /**
   * Record that a person looked at an insight and what they made of it.
   *
   * Behind `ai.query` rather than a write permission, because reviewing is not
   * a change to any record — it is a note that somebody checked.
   */
  @Post('insights/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ai.query')
  @AuditAction('ai.review')
  review(@Body(zodBody(aiReviewSchema)) body: AiReview) {
    return this.ai.review(body);
  }

  /**
   * Forecasting and anomaly detection do not require the AI layer.
   *
   * They are arithmetic over the facility's own records. Switching AI off must
   * not take away the ability to see that a medicine runs out in nine days, so
   * these sit behind `analytics.read` and work regardless.
   */
  @Get('forecast')
  @RequirePermission('analytics.read')
  forecast(@Query(zodQuery(aiForecastSchema)) query: Record<string, never>) {
    return this.insights.forecast(query as never);
  }

  @Get('stock-depletion')
  @RequirePermission('inventory.read')
  depletion(@Query('facilityId') facilityId: string, @Query('windowDays') windowDays?: string) {
    return this.insights.stockDepletion(facilityId, windowDays ? Number(windowDays) : 28);
  }

  @Get('anomalies')
  @RequirePermission('analytics.read')
  anomalies(@Query('facilityId') facilityId: string, @Query('days') days?: string) {
    return this.insights.anomalies(facilityId, days ? Number(days) : 60);
  }
}
