import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { createRiskSchema, type CreateRisk } from '@chc/contracts';
import { z } from 'zod';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { QualityService } from './quality.service';

const complianceStatusSchema = z.object({
  requirementId: z.string().uuid(),
  facilityId: z.string().uuid(),
  state: z.enum(['NOT_ASSESSED', 'COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NOT_APPLICABLE']),
  evidenceNote: z.string().max(2000).optional(),
  certificateNumber: z.string().max(100).optional(),
  issuedOn: z.string().optional(),
  expiresOn: z.string().optional(),
  actionRequired: z.string().max(1000).optional(),
});

@Controller({ path: 'risks', version: '1' })
export class RiskController {
  constructor(private readonly quality: QualityService) {}

  @Post()
  @RequirePermission('quality.write')
  @AuditAction('planning.risk.create')
  create(@Body(zodBody(createRiskSchema)) body: CreateRisk) {
    return this.quality.createRisk(body);
  }

  @Get()
  @RequirePermission('quality.read')
  list(@Query('facilityId') facilityId: string) {
    return this.quality.listRisks(facilityId);
  }
}

/**
 * The compliance register (spec §83).
 *
 * Records requirements and the evidence held against them. It does not decide
 * whether a facility is lawfully compliant, and every response says so.
 */
@Controller({ path: 'compliance', version: '1' })
export class ComplianceController {
  constructor(private readonly quality: QualityService) {}

  @Get()
  @RequirePermission('quality.read')
  list(@Query('facilityId') facilityId: string) {
    return this.quality.listCompliance(facilityId);
  }

  @Post('status')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('quality.write')
  @AuditAction('planning.compliance.set')
  setStatus(@Body(zodBody(complianceStatusSchema)) body: z.infer<typeof complianceStatusSchema>) {
    return this.quality.setComplianceStatus(body);
  }
}
