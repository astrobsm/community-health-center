import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreatePhase, CreateProject, CreateTask } from '@chc/contracts';

import { ReasonRequiredError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import {
  completionPercent,
  computeSchedule,
  ScheduleCycleError,
  UnknownPredecessorError,
  type ScheduleDependency,
  type ScheduleTask,
} from './domain/critical-path';

/**
 * Capital projects (spec §21, doc 15).
 *
 * A project exists to deliver a recommendation. That link is the fourth in the
 * chain this platform keeps intact — finding, need, recommendation, project —
 * and without it nobody can answer why a facility is spending six weeks
 * rebuilding a roof.
 *
 * Completion is computed from the tasks, weighted, on every read. It is never
 * stored, so the headline figure and the task list cannot disagree (§10).
 */
@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date();
  }

  async create(input: CreateProject) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(input.facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    if (input.recommendationId) {
      const recommendation = await this.prisma.recommendation.findFirst({
        where: { id: input.recommendationId, organisationId },
        select: { id: true, facilityId: true, reference: true },
      });

      if (!recommendation || recommendation.facilityId !== input.facilityId) {
        throw new NotFoundException('No such recommendation at this facility.');
      }
    } else if ((input.unlinkedReason ?? '').trim().length < 10) {
      throw new ReasonRequiredError('Creating a project that delivers no recorded recommendation');
    }

    const context = tryGetContext();
    const count = await this.prisma.capitalProject.count({ where: { facilityId: input.facilityId } });
    const reference = `PRJ-${String(count + 1).padStart(4, '0')}`;

    const project = await this.prisma.capitalProject.create({
      data: {
        id: input.id ?? randomUUID(),
        organisationId,
        facilityId: input.facilityId,
        recommendationId: input.recommendationId,
        capexLineId: input.capexLineId,
        reference,
        name: input.name,
        description: input.description,
        category: input.category,
        priorityClass: input.priorityClass,
        plannedStart: input.plannedStart ? new Date(input.plannedStart) : undefined,
        plannedEnd: input.plannedEnd ? new Date(input.plannedEnd) : undefined,
        unplannedReason: input.recommendationId ? undefined : input.unlinkedReason,
        createdBy: context?.userId,
      },
      select: { id: true, reference: true, name: true, status: true, plannedStart: true, plannedEnd: true },
    });

    await this.audit.record({
      action: 'project.create',
      entityType: 'capital_project',
      entityId: project.id,
      facilityId: input.facilityId,
      newValue: { reference, recommendationId: input.recommendationId ?? null },
      reason: input.recommendationId ? undefined : input.unlinkedReason,
    });

    return project;
  }

  async addPhase(input: CreatePhase) {
    const { organisationId } = getTenantScope();
    const project = await this.load(input.projectId);

    const phase = await this.prisma.projectPhase.create({
      data: {
        id: input.id ?? randomUUID(),
        projectId: project.id,
        organisationId,
        name: input.name,
        sequence: input.sequence,
        plannedStart: input.plannedStart ? new Date(input.plannedStart) : undefined,
        plannedEnd: input.plannedEnd ? new Date(input.plannedEnd) : undefined,
      },
      select: { id: true, name: true, sequence: true, status: true },
    });

    await this.audit.record({
      action: 'project.phase.add',
      entityType: 'project_phase',
      entityId: phase.id,
      facilityId: project.facilityId,
      newValue: { projectReference: project.reference, name: phase.name },
    });

    return phase;
  }

  /**
   * Add a task, with its dependencies.
   *
   * The dependencies are validated by computing the schedule before the task
   * is written. A cycle is refused here rather than discovered the first time
   * somebody opens the Gantt chart and finds it empty.
   */
  async addTask(input: CreateTask) {
    const { organisationId } = getTenantScope();

    const phase = await this.prisma.projectPhase.findFirst({
      where: { id: input.phaseId, organisationId },
      select: {
        id: true,
        name: true,
        project: { select: { id: true, reference: true, facilityId: true } },
      },
    });

    if (!phase) throw new NotFoundException('No such project phase.');

    const facilityId = phase.project.facilityId;
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such project phase, or it is not visible to you.');
    }

    const taskId = input.id ?? randomUUID();
    const count = await this.prisma.projectTask.count({ where: { facilityId } });
    const reference = `T-${String(count + 1).padStart(4, '0')}`;

    // Compute the schedule as it WOULD be, before writing anything.
    const existing = await this.scheduleInputs(phase.project.id);
    const proposedTasks: ScheduleTask[] = [
      ...existing.tasks,
      { id: taskId, reference, name: input.name, durationDays: input.estimatedDays },
    ];
    const proposedDependencies: ScheduleDependency[] = [
      ...existing.dependencies,
      ...input.dependsOn.map((dependency) => ({
        taskId,
        predecessorId: dependency.predecessorId,
        dependencyType: dependency.dependencyType,
        lagDays: dependency.lagDays,
      })),
    ];

    try {
      computeSchedule(proposedTasks, proposedDependencies);
    } catch (error) {
      if (error instanceof ScheduleCycleError || error instanceof UnknownPredecessorError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const context = tryGetContext();

    const task = await this.prisma.projectTask.create({
      data: {
        id: taskId,
        phaseId: phase.id,
        organisationId,
        facilityId,
        reference,
        name: input.name,
        description: input.description,
        weight: input.weight,
        estimatedDays: input.estimatedDays,
        ownerUserId: input.ownerUserId,
        plannedStart: input.plannedStart ? new Date(input.plannedStart) : undefined,
        plannedEnd: input.plannedEnd ? new Date(input.plannedEnd) : undefined,
        createdBy: context?.userId,
        dependencies: {
          create: input.dependsOn.map((dependency) => ({
            organisationId,
            predecessorId: dependency.predecessorId,
            dependencyType: dependency.dependencyType,
            lagDays: dependency.lagDays,
          })),
        },
      },
      select: { id: true, reference: true, name: true, status: true, weight: true, estimatedDays: true },
    });

    await this.audit.record({
      action: 'project.task.add',
      entityType: 'project_task',
      entityId: task.id,
      facilityId,
      newValue: { reference, phase: phase.name, dependsOn: input.dependsOn.length },
    });

    return {
      ...task,
      weight: Number(task.weight),
      estimatedDays: task.estimatedDays === null ? null : Number(task.estimatedDays),
    };
  }

  async updateTaskProgress(
    taskId: string,
    input: { percentComplete: number; status?: string; note?: string },
  ) {
    const { organisationId, facilityIds } = getTenantScope();

    const task = await this.prisma.projectTask.findFirst({
      where: { id: taskId, organisationId },
      select: { id: true, facilityId: true, reference: true, name: true, status: true, percentComplete: true },
    });

    if (!task || !facilityIds.includes(task.facilityId)) {
      throw new NotFoundException('No such task, or it is not visible to you.');
    }

    const status = input.status ?? inferStatus(input.percentComplete, task.status);

    if ((status === 'BLOCKED' || status === 'CANCELLED') && (input.note ?? '').trim().length < 10) {
      // A stalled task with no stated cause cannot be unstuck by anybody who
      // was not in the room.
      throw new ReasonRequiredError(`Marking ${task.reference} as ${status.toLowerCase()}`);
    }

    if (status === 'COMPLETED' && input.percentComplete < 100) {
      throw new BadRequestException(
        `${task.reference} cannot be complete at ${input.percentComplete}%. Set it to 100, or leave it in progress.`,
      );
    }

    const context = tryGetContext();

    const updated = await this.prisma.projectTask.update({
      where: { id: task.id },
      data: {
        percentComplete: input.percentComplete,
        status: status as never,
        actualStart: input.percentComplete > 0 && task.percentComplete.equals(0) ? this.now() : undefined,
        actualEnd: status === 'COMPLETED' ? this.now() : undefined,
        updatedBy: context?.userId,
      },
      select: { id: true, reference: true, status: true, percentComplete: true, actualEnd: true },
    });

    await this.refreshProjectCompletion(task.id);

    await this.audit.record({
      action: 'project.task.progress',
      entityType: 'project_task',
      entityId: task.id,
      facilityId: task.facilityId,
      oldValue: { percentComplete: Number(task.percentComplete), status: task.status },
      newValue: { percentComplete: input.percentComplete, status },
      reason: input.note,
    });

    return { ...updated, percentComplete: Number(updated.percentComplete) };
  }

  /**
   * The project, its schedule, and what is actually driving the end date.
   *
   * Everything derived: completion from the tasks, the critical path from the
   * dependencies. Nothing here is a stored summary that could be stale.
   */
  async get(projectId: string) {
    const project = await this.load(projectId);
    const inputs = await this.scheduleInputs(projectId);

    const tasks = await this.prisma.projectTask.findMany({
      where: { phase: { projectId } },
      orderBy: { reference: 'asc' },
      select: {
        id: true,
        reference: true,
        name: true,
        status: true,
        weight: true,
        percentComplete: true,
        estimatedDays: true,
        plannedStart: true,
        plannedEnd: true,
        actualStart: true,
        actualEnd: true,
        phase: { select: { id: true, name: true, sequence: true } },
      },
    });

    let schedule: ReturnType<typeof computeSchedule> | undefined;
    let scheduleError: string | undefined;

    try {
      schedule = computeSchedule(inputs.tasks, inputs.dependencies);
    } catch (error) {
      // Reported rather than thrown: the rest of the project is still
      // readable, and a manager who has drawn a cycle needs to see the tasks
      // in order to fix it.
      scheduleError = (error as Error).message;
    }

    const completion = completionPercent(
      tasks.map((task) => ({
        weight: Number(task.weight),
        percentComplete: Number(task.percentComplete),
        status: task.status,
      })),
    );

    const criticalReferences = new Set(schedule?.criticalPath ?? []);

    return {
      ...project,
      completionPercent: Number(project.completionPercent),
      completion,
      schedule: schedule
        ? {
            durationDays: schedule.durationDays,
            criticalPath: schedule.criticalPath,
            note:
              'Durations are in days. Working days, holidays and site closures are not applied; ' +
              'the schedule shows elapsed days from the project start.',
          }
        : null,
      scheduleError,
      tasks: tasks.map((task) => {
        const scheduled = schedule?.tasks.find((candidate) => candidate.id === task.id);

        return {
          ...task,
          weight: Number(task.weight),
          percentComplete: Number(task.percentComplete),
          estimatedDays: task.estimatedDays === null ? null : Number(task.estimatedDays),
          isCritical: criticalReferences.has(task.reference),
          slackDays: scheduled?.slackDays ?? null,
          earliestStartDay: scheduled?.earliestStart ?? null,
          earliestFinishDay: scheduled?.earliestFinish ?? null,
        };
      }),
    };
  }

  /**
   * Keep the stored completion figure in step with the tasks it summarises.
   *
   * The API always derives it (§10); the column exists so a report reading the
   * database directly does not see zero against a project that is half built.
   * Refreshed here rather than trusted, so the two can never disagree.
   */
  private async refreshProjectCompletion(taskId: string): Promise<void> {
    const task = await this.prisma.projectTask.findUnique({
      where: { id: taskId },
      select: { phase: { select: { projectId: true } } },
    });

    if (!task) return;

    const tasks = await this.prisma.projectTask.findMany({
      where: { phase: { projectId: task.phase.projectId } },
      select: { weight: true, percentComplete: true, status: true },
    });

    const completion = completionPercent(
      tasks.map((row) => ({
        weight: Number(row.weight),
        percentComplete: Number(row.percentComplete),
        status: row.status,
      })),
    );

    await this.prisma.capitalProject.update({
      where: { id: task.phase.projectId },
      data: { completionPercent: completion.percent },
    });
  }

  private async scheduleInputs(projectId: string) {
    const tasks = await this.prisma.projectTask.findMany({
      where: { phase: { projectId } },
      orderBy: [{ phase: { sequence: 'asc' } }, { reference: 'asc' }],
      select: {
        id: true,
        reference: true,
        name: true,
        estimatedDays: true,
        dependencies: { select: { predecessorId: true, dependencyType: true, lagDays: true } },
      },
    });

    return {
      tasks: tasks.map((task) => ({
        id: task.id,
        reference: task.reference,
        name: task.name,
        durationDays: task.estimatedDays === null ? 0 : Number(task.estimatedDays),
      })),
      dependencies: tasks.flatMap((task) =>
        task.dependencies.map((dependency) => ({
          taskId: task.id,
          predecessorId: dependency.predecessorId,
          dependencyType: dependency.dependencyType,
          lagDays: dependency.lagDays,
        })),
      ),
    };
  }

  private async load(projectId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const project = await this.prisma.capitalProject.findFirst({
      where: { id: projectId, organisationId },
      select: {
        id: true,
        facilityId: true,
        reference: true,
        name: true,
        description: true,
        status: true,
        plannedStart: true,
        plannedEnd: true,
        actualStart: true,
        actualEnd: true,
        recommendationId: true,
        unplannedReason: true,
        completionPercent: true,
        phases: {
          orderBy: { sequence: 'asc' },
          select: { id: true, name: true, sequence: true, status: true },
        },
      },
    });

    if (!project || !facilityIds.includes(project.facilityId)) {
      throw new NotFoundException('No such project, or it is not visible to you.');
    }

    return project;
  }
}

function inferStatus(percentComplete: number, current: string): string {
  if (current === 'CANCELLED') return current;
  if (percentComplete >= 100) return 'COMPLETED';
  if (percentComplete > 0) return 'IN_PROGRESS';
  return current === 'BLOCKED' ? 'BLOCKED' : 'NOT_STARTED';
}
