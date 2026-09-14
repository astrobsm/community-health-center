import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  createNeedSchema,
  createRecommendationSchema,
  type CreateNeed,
  type CreateRecommendation,
} from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { NeedsService } from './needs.service';

@Controller({ path: 'needs', version: '1' })
export class NeedController {
  constructor(private readonly needs: NeedsService) {}

  @Post()
  @RequirePermission('needs.write')
  @AuditAction('planning.need.create')
  create(@Body(zodBody(createNeedSchema)) body: CreateNeed) {
    return this.needs.createNeed(body);
  }

  /** Each need with its basis — a finding reference, or the stated reason there is none. */
  @Get()
  @RequirePermission('needs.read')
  list(@Query('facilityId') facilityId: string) {
    return this.needs.listNeeds(facilityId);
  }
}

@Controller({ path: 'recommendations', version: '1' })
export class RecommendationController {
  constructor(private readonly needs: NeedsService) {}

  @Post()
  @RequirePermission('needs.write')
  @AuditAction('planning.recommendation.create')
  create(@Body(zodBody(createRecommendationSchema)) body: CreateRecommendation) {
    return this.needs.createRecommendation(body);
  }
}

