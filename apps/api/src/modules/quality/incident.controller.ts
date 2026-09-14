import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  actOnComplaintSchema,
  advanceQualityCycleSchema,
  closeIncidentSchema,
  completeActionSchema,
  investigateIncidentSchema,
  openQualityCycleSchema,
  receiveComplaintSchema,
  reportIncidentSchema,
  resolveComplaintSchema,
  type ActOnComplaint,
  type AdvanceQualityCycle,
  type CloseIncident,
  type CompleteAction,
  type InvestigateIncident,
  type OpenQualityCycle,
  type ReceiveComplaint,
  type ReportIncident,
  type ResolveComplaint,
} from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { IncidentService } from './incident.service';

/**
 * Incident reporting (spec §39).
 *
 * Reporting sits behind `quality.write`, which nearly every clinical role
 * holds: a facility where only managers may report incidents has very few
 * incidents, and that is not the same as being safe. Closing one sits behind
 * `quality.close`.
 */
@Controller({ path: 'incidents', version: '1' })
export class IncidentController {
  constructor(private readonly incidents: IncidentService) {}

  @Post()
  @RequirePermission('quality.write')
  @AuditAction('quality.incident.report')
  report(@Body(zodBody(reportIncidentSchema)) body: ReportIncident) {
    return this.incidents.report(body);
  }

  @Get()
  @RequirePermission('quality.read')
  list(@Query('facilityId') facilityId: string) {
    return this.incidents.listIncidents(facilityId);
  }

  @Post('investigate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('quality.write')
  @AuditAction('quality.incident.investigate')
  investigate(@Body(zodBody(investigateIncidentSchema)) body: InvestigateIncident) {
    return this.incidents.investigate(body);
  }

  @Post('close')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('quality.close')
  @AuditAction('quality.incident.close')
  close(@Body(zodBody(closeIncidentSchema)) body: CloseIncident) {
    return this.incidents.close(body);
  }

  @Post('actions/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('quality.write')
  @AuditAction('quality.action.complete')
  completeAction(@Body(zodBody(completeActionSchema)) body: CompleteAction) {
    return this.incidents.completeAction(body);
  }
}

@Controller({ path: 'complaints', version: '1' })
export class ComplaintController {
  constructor(private readonly incidents: IncidentService) {}

  @Post()
  @RequirePermission('quality.write')
  @AuditAction('quality.complaint.receive')
  receive(@Body(zodBody(receiveComplaintSchema)) body: ReceiveComplaint) {
    return this.incidents.receiveComplaint(body);
  }

  @Get()
  @RequirePermission('quality.read')
  list(@Query('facilityId') facilityId: string) {
    return this.incidents.listComplaints(facilityId);
  }

  @Post('actions')
  @RequirePermission('quality.write')
  @AuditAction('quality.complaint.act')
  act(@Body(zodBody(actOnComplaintSchema)) body: ActOnComplaint) {
    return this.incidents.actOnComplaint(body);
  }

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('quality.close')
  @AuditAction('quality.complaint.resolve')
  resolve(@Body(zodBody(resolveComplaintSchema)) body: ResolveComplaint) {
    return this.incidents.resolveComplaint(body);
  }
}

/**
 * Improvement cycles: problem → root cause → intervention → measurement →
 * review (spec §39).
 *
 * The indicator is named when the cycle opens and the review is refused
 * without a measured result for it, so a cycle cannot be written up as a
 * success by choosing the measure afterwards.
 */
@Controller({ path: 'quality-cycles', version: '1' })
export class QualityCycleController {
  constructor(private readonly incidents: IncidentService) {}

  @Post()
  @RequirePermission('quality.write')
  @AuditAction('quality.cycle.open')
  open(@Body(zodBody(openQualityCycleSchema)) body: OpenQualityCycle) {
    return this.incidents.openCycle(body);
  }

  @Get()
  @RequirePermission('quality.read')
  list(@Query('facilityId') facilityId: string) {
    return this.incidents.listCycles(facilityId);
  }

  @Post('advance')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('quality.write')
  @AuditAction('quality.cycle.advance')
  advance(@Body(zodBody(advanceQualityCycleSchema)) body: AdvanceQualityCycle) {
    return this.incidents.advanceCycle(body);
  }
}
