import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  createAssessmentSchema,
  createFindingSchema,
  saveResponseBatchSchema,
  submitAssessmentSchema,
  type CreateAssessment,
  type CreateFinding,
} from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { AssessmentService } from './assessment.service';

@Controller({ path: 'assessments', version: '1' })
export class AssessmentController {
  constructor(private readonly assessments: AssessmentService) {}

  @Post()
  @RequirePermission('assessment.write')
  @AuditAction('assessment.create')
  create(@Body(zodBody(createAssessmentSchema)) body: CreateAssessment) {
    return this.assessments.create(body);
  }

  /** The instrument plus any answers so far — one call, because the field app may be offline after it. */
  @Get(':id')
  @RequirePermission('assessment.read')
  get(@Param('id') id: string) {
    return this.assessments.getWithTemplate(id);
  }

  @Post(':id/responses')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('assessment.write')
  @AuditAction('assessment.responses.save')
  saveResponses(
    @Param('id') id: string,
    @Body(zodBody(saveResponseBatchSchema)) body: { responses: Parameters<AssessmentService['saveResponses']>[1] },
  ) {
    return this.assessments.saveResponses(id, body.responses);
  }

  @Get(':id/progress')
  @RequirePermission('assessment.read')
  progress(@Param('id') id: string) {
    return this.assessments.progress(id);
  }

  /** Facility condition index (spec §17). */
  @Get(':id/readiness')
  @RequirePermission('assessment.read')
  readiness(@Param('id') id: string) {
    return this.assessments.readiness(id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('assessment.submit')
  @AuditAction('assessment.submit')
  submit(
    @Param('id') id: string,
    @Body(zodBody(submitAssessmentSchema)) body: { acknowledgeIncomplete: boolean; note?: string },
  ) {
    return this.assessments.submit(id, body);
  }
}

@Controller({ path: 'findings', version: '1' })
export class FindingController {
  constructor(private readonly assessments: AssessmentService) {}

  @Post()
  @RequirePermission('assessment.write')
  @AuditAction('assessment.finding.create')
  create(@Body(zodBody(createFindingSchema)) body: CreateFinding) {
    return this.assessments.createFinding(body);
  }

  @Get()
  @RequirePermission('assessment.read')
  list(@Query('facilityId') facilityId: string) {
    return this.assessments.listFindings(facilityId);
  }
}
