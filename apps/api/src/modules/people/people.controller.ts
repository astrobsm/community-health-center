import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  approveIncentiveSchema,
  clockSchema,
  computeIncentiveSchema,
  computePerformanceSchema,
  configureMetricSchema,
  correctAttendanceSchema,
  createScheduleSchema,
  createStaffSchema,
  exitStaffSchema,
  recordCredentialSchema,
  suspendCredentialSchema,
  verifyCredentialSchema,
  type ApproveIncentive,
  type Clock,
  type ComputeIncentive,
  type ComputePerformance,
  type ConfigureMetric,
  type CorrectAttendance,
  type CreateSchedule,
  type CreateStaff,
  type ExitStaff,
  type RecordCredential,
  type SuspendCredential,
  type VerifyCredential,
} from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { AttendanceService } from './attendance.service';
import { PerformanceService } from './performance.service';
import { StaffService } from './staff.service';

@Controller({ path: 'staff', version: '1' })
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post()
  @RequirePermission('hr.write')
  @AuditAction('hr.staff.create')
  create(@Body(zodBody(createStaffSchema)) body: CreateStaff) {
    return this.staff.create(body);
  }

  @Get()
  @RequirePermission('hr.read')
  list(@Query('facilityId') facilityId: string) {
    return this.staff.list(facilityId);
  }

  @Get('establishment')
  @RequirePermission('hr.read')
  establishment(@Query('facilityId') facilityId: string) {
    return this.staff.establishment(facilityId);
  }

  @Post('exit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('hr.write')
  @AuditAction('hr.staff.exit')
  exit(@Body(zodBody(exitStaffSchema)) body: ExitStaff) {
    return this.staff.exit(body);
  }

  @Get(':staffId/credentials')
  @RequirePermission('hr.read')
  credentials(@Param('staffId') staffId: string) {
    return this.staff.credentialsFor(staffId);
  }
}

/**
 * Credentials (spec §24).
 *
 * Recording and verifying are separate endpoints because they are separate
 * acts by separate people: anybody may record what a licence says, but
 * verification means somebody checked it against the issuing body and is
 * willing to be named as having done so.
 */
@Controller({ path: 'credentials', version: '1' })
export class CredentialController {
  constructor(private readonly staff: StaffService) {}

  @Post()
  @RequirePermission('hr.write')
  @AuditAction('hr.credential.record')
  record(@Body(zodBody(recordCredentialSchema)) body: RecordCredential) {
    return this.staff.recordCredential(body);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('hr.credential_verify')
  @AuditAction('hr.credential.verify')
  verify(@Body(zodBody(verifyCredentialSchema)) body: VerifyCredential) {
    return this.staff.verifyCredential(body);
  }

  @Post('suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('hr.credential_verify')
  @AuditAction('hr.credential.suspend')
  suspend(@Body(zodBody(suspendCredentialSchema)) body: SuspendCredential) {
    return this.staff.suspendCredential(body);
  }

  @Get('expiring')
  @RequirePermission('hr.read')
  expiring(@Query('facilityId') facilityId: string, @Query('withinDays') withinDays?: string) {
    return this.staff.expiring(facilityId, withinDays ? Number(withinDays) : 60);
  }
}

@Controller({ path: 'attendance', version: '1' })
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('schedules')
  @RequirePermission('hr.write')
  @AuditAction('hr.schedule.publish')
  createSchedule(@Body(zodBody(createScheduleSchema)) body: CreateSchedule) {
    return this.attendance.createSchedule(body);
  }

  @Post('clock')
  @RequirePermission('attendance.record')
  @AuditAction('attendance.record')
  clock(@Body(zodBody(clockSchema)) body: Clock) {
    return this.attendance.clock(body);
  }

  @Post('correct')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('attendance.correct')
  @AuditAction('attendance.correct')
  correct(@Body(zodBody(correctAttendanceSchema)) body: CorrectAttendance) {
    return this.attendance.correct(body);
  }

  @Get('summary')
  @RequirePermission('attendance.read')
  summary(
    @Query('staffId') staffId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
  ) {
    return this.attendance.summary({ staffId, periodStart, periodEnd });
  }
}

/**
 * Performance and incentives (spec §25, acceptance criterion J).
 *
 * `compute` and `approve` sit behind different permissions because
 * SEGREGATION_OF_DUTIES says the person who computes an incentive may not
 * approve its payment — and the service checks the record as well as the
 * permission, since an organisation may grant one person both.
 */
@Controller({ path: 'performance', version: '1' })
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get('queries')
  @RequirePermission('performance.read')
  queries() {
    return this.performance.listQueries();
  }

  @Post('metrics')
  @RequirePermission('performance.configure')
  @AuditAction('performance.metric.configure')
  configure(@Body(zodBody(configureMetricSchema)) body: ConfigureMetric) {
    return this.performance.configureMetric(body);
  }

  @Get('metrics')
  @RequirePermission('performance.read')
  metrics(@Query('facilityId') facilityId?: string) {
    return this.performance.listMetrics(facilityId);
  }

  @Post('compute')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('performance.read')
  @AuditAction('performance.compute')
  compute(@Body(zodBody(computePerformanceSchema)) body: ComputePerformance) {
    return this.performance.computeFor(body);
  }
}

@Controller({ path: 'incentives', version: '1' })
export class IncentiveController {
  constructor(private readonly performance: PerformanceService) {}

  @Post('compute')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('performance.compute_incentive')
  @AuditAction('performance.compute_incentive')
  compute(@Body(zodBody(computeIncentiveSchema)) body: ComputeIncentive) {
    return this.performance.compute(body);
  }

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('performance.approve_incentive')
  @AuditAction('performance.approve_incentive')
  approve(@Body(zodBody(approveIncentiveSchema)) body: ApproveIncentive) {
    return this.performance.approve(body);
  }

  @Get(':incentiveId')
  @RequirePermission('performance.read')
  explain(@Param('incentiveId') incentiveId: string) {
    return this.performance.explain(incentiveId);
  }
}
