import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { createEvidenceSchema, verifyEvidenceSchema, type CreateEvidence } from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { EvidenceService } from './evidence.service';

@Controller({ path: 'evidence', version: '1' })
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  /**
   * Register evidence and receive an upload URL.
   *
   * Idempotent on the client-supplied id, because a field device retrying after
   * a dropped connection is the normal case, not an error.
   */
  @Post()
  @RequirePermission('evidence.upload')
  @AuditAction('evidence.create')
  create(@Body(zodBody(createEvidenceSchema)) body: CreateEvidence) {
    return this.evidence.create(body);
  }

  /** Confirms the bytes arrived and match what was declared. */
  @Post(':id/confirm-upload')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('evidence.upload')
  @AuditAction('evidence.upload.confirm')
  confirmUpload(@Param('id') id: string) {
    return this.evidence.confirmUpload(id);
  }

  /**
   * Independent verification — a separate permission from uploading, because
   * the value of verification comes from it being done by someone else.
   */
  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('evidence.verify')
  @AuditAction('evidence.verify')
  verify(
    @Param('id') id: string,
    @Body(zodBody(verifyEvidenceSchema)) body: { verificationNote?: string },
  ) {
    return this.evidence.verify(id, body.verificationNote);
  }

  @Get(':id')
  @RequirePermission('evidence.read')
  get(@Param('id') id: string) {
    return this.evidence.describe(id, { includeUploadUrl: false });
  }

  @Get()
  @RequirePermission('evidence.read')
  list(
    @Query('facilityId') facilityId: string,
    @Query('stage') stage?: string,
    @Query('source') source?: string,
  ) {
    return this.evidence.listForFacility(facilityId, { stage, source });
  }
}
