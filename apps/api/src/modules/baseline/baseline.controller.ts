import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { sealBaselineSchema, type SealBaseline } from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { BaselineService } from './baseline.service';

@Controller({ path: 'baselines', version: '1' })
export class BaselineController {
  constructor(private readonly baselines: BaselineService) {}

  /**
   * What sealing would produce, including every gap.
   *
   * Sealing is irreversible, so this is not optional politeness — an assessor
   * must be able to see that 6 metrics will be recorded as "not captured"
   * before they commit to Day 0.
   */
  @Get('preview/:assessmentId')
  @RequirePermission('baseline.read')
  preview(@Param('assessmentId') assessmentId: string) {
    return this.baselines.preview(assessmentId);
  }

  @Post('seal/:assessmentId')
  @RequirePermission('baseline.seal')
  @AuditAction('baseline.seal')
  seal(
    @Param('assessmentId') assessmentId: string,
    @Body(zodBody(sealBaselineSchema)) body: SealBaseline,
  ) {
    return this.baselines.seal(assessmentId, body);
  }

  @Get()
  @RequirePermission('baseline.read')
  list(@Query('facilityId') facilityId: string) {
    return this.baselines.listForFacility(facilityId);
  }

  /** Includes an integrity check of the sealed content hash on every read. */
  @Get(':id')
  @RequirePermission('baseline.read')
  get(@Param('id') id: string) {
    return this.baselines.get(id);
  }

  /**
   * Exists only to answer the attempt with an explanation.
   *
   * The database refuses the write regardless; without this route the caller
   * would get a generic failure instead of being told why a baseline is
   * immutable and what to do instead.
   */
  @Patch(':id')
  @RequirePermission('baseline.seal')
  @AuditAction('baseline.modification.rejected')
  reject(@Param('id') id: string) {
    return this.baselines.rejectModification(id);
  }
}
