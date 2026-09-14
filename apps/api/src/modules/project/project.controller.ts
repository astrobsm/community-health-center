import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  advanceAssetSchema,
  commissioningCheckSchema,
  createPhaseSchema,
  createProjectSchema,
  createTaskSchema,
  recordMaintenanceSchema,
  updateTaskProgressSchema,
  type CommissioningCheckInput,
  type CreatePhase,
  type CreateProject,
  type CreateTask,
  type RecordMaintenance,
} from '@chc/contracts';
import { z } from 'zod';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { AssetService } from './asset.service';
import { ProjectService } from './project.service';

@Controller({ path: 'projects', version: '1' })
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  @Post()
  @RequirePermission('project.write')
  @AuditAction('project.create')
  create(@Body(zodBody(createProjectSchema)) body: CreateProject) {
    return this.projects.create(body);
  }

  /** Completion and the critical path, both derived on read. */
  @Get(':id')
  @RequirePermission('project.read')
  get(@Param('id') id: string) {
    return this.projects.get(id);
  }

  @Post('phases')
  @RequirePermission('project.write')
  @AuditAction('project.phase.add')
  addPhase(@Body(zodBody(createPhaseSchema)) body: CreatePhase) {
    return this.projects.addPhase(body);
  }

  /** A dependency cycle is refused here, not discovered on an empty Gantt chart. */
  @Post('tasks')
  @RequirePermission('project.write')
  @AuditAction('project.task.add')
  addTask(@Body(zodBody(createTaskSchema)) body: CreateTask) {
    return this.projects.addTask(body);
  }

  @Post('tasks/:id/progress')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('project.write')
  @AuditAction('project.task.progress')
  updateProgress(
    @Param('id') id: string,
    @Body(zodBody(updateTaskProgressSchema)) body: z.infer<typeof updateTaskProgressSchema>,
  ) {
    return this.projects.updateTaskProgress(id, body);
  }
}

@Controller({ path: 'assets', version: '1' })
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  /** The register, with service readiness counted from commissioned assets only. */
  @Get()
  @RequirePermission('asset.read')
  list(@Query('facilityId') facilityId: string) {
    return this.assets.list(facilityId);
  }

  @Post(':id/commissioning')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('asset.commission')
  @AuditAction('asset.commissioning.record')
  recordChecks(
    @Param('id') id: string,
    @Body(zodBody(commissioningCheckSchema)) body: CommissioningCheckInput,
  ) {
    return this.assets.recordChecks(id, body);
  }

  /** COMMISSIONED requires every check to pass — acceptance criterion F. */
  @Post(':id/advance')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('asset.commission')
  @AuditAction('asset.advance')
  advance(
    @Param('id') id: string,
    @Body(zodBody(advanceAssetSchema)) body: z.infer<typeof advanceAssetSchema>,
  ) {
    return this.assets.advance(id, body);
  }

  @Post('maintenance')
  @RequirePermission('asset.write')
  @AuditAction('asset.maintenance.record')
  recordMaintenance(@Body(zodBody(recordMaintenanceSchema)) body: RecordMaintenance) {
    return this.assets.recordMaintenance(body);
  }

  @Get('maintenance/due')
  @RequirePermission('asset.read')
  maintenanceDue(@Query('facilityId') facilityId: string) {
    return this.assets.maintenanceDue(facilityId);
  }
}
