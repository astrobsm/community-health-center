import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { FacilityLifecycleStage } from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { FacilityService } from './facility.service';

const transitionSchema = z.object({
  toStage: z.nativeEnum(FacilityLifecycleStage),
  reason: z.string().max(1000).optional(),
});

@Controller({ path: 'facilities', version: '1' })
export class FacilityController {
  constructor(private readonly facilities: FacilityService) {}

  @Get()
  @RequirePermission('facility.read')
  list() {
    return this.facilities.list();
  }

  @Get(':id')
  @RequirePermission('facility.read')
  get(@Param('id') id: string) {
    return this.facilities.get(id);
  }

  /** Append-only: the history of how a facility got here is the institutional memory. */
  @Get(':id/stage-history')
  @RequirePermission('facility.read')
  stageHistory(@Param('id') id: string) {
    return this.facilities.stageHistory(id);
  }

  @Post(':id/transition')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('facility.transition_stage')
  @AuditAction('facility.transition_stage')
  transition(
    @Param('id') id: string,
    @Body(zodBody(transitionSchema)) body: z.infer<typeof transitionSchema>,
  ) {
    return this.facilities.transitionStage(id, body.toStage, body.reason);
  }
}
