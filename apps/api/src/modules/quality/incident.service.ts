import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ActOnComplaint,
  AdvanceQualityCycle,
  CloseIncident,
  CompleteAction,
  InvestigateIncident,
  OpenQualityCycle,
  ReceiveComplaint,
  ReportIncident,
  ResolveComplaint,
} from '@chc/contracts';

import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Incidents, complaints and improvement cycles (spec §39).
 *
 * All three share one rule: a case is closed when something was done about it,
 * not when somebody grew tired of looking at it. So an incident cannot be
 * closed with an outstanding action, a complaint cannot be resolved with no
 * action recorded, and an improvement cycle cannot be reviewed without a
 * measured value for the indicator it named at the start.
 *
 * Reporting is deliberately easy and closing is deliberately hard. A facility
 * where reporting is hard has no incidents, which is not the same as being
 * safe.
 */
@Injectable()
export class IncidentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date();
  }

  private assertFacilityVisible(facilityId: string): void {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }
  }

  // ---------------------------------------------------------------------------
  // Incidents
  // ---------------------------------------------------------------------------

  async report(input: ReportIncident) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const context = tryGetContext();
    const occurredAt = new Date(input.occurredAt);

    if (occurredAt > this.now()) {
      throw new BadRequestException('An incident cannot be reported as having happened in the future.');
    }

    const reference = await this.nextReference('incident', organisationId, 'INC');

    const incident = await this.prisma.incident.create({
      data: {
        organisationId,
        facilityId: input.facilityId,
        reference,
        incidentType: input.incidentType,
        description: input.description,
        severity: input.severity,
        occurredAt,
        reportedBy: context?.userId,
        patientAffected: input.patientAffected,
        linkedEncounterId: input.linkedEncounterId,
        immediateAction: input.immediateAction,
        createdBy: context?.userId,
      },
      select: {
        id: true,
        reference: true,
        incidentType: true,
        severity: true,
        status: true,
        occurredAt: true,
        reportedAt: true,
      },
    });

    await this.audit.record({
      action: 'quality.incident.report',
      entityType: 'incident',
      entityId: incident.id,
      facilityId: input.facilityId,
      newValue: {
        reference,
        incidentType: input.incidentType,
        severity: input.severity,
        patientAffected: input.patientAffected,
      },
      severity: input.severity === 'CRITICAL' || input.severity === 'HIGH' ? 'WARNING' : 'NOTICE',
    });

    return {
      ...incident,
      // Said back to the reporter, so nobody has to wonder whether it went
      // anywhere.
      acknowledgement:
        `Recorded as ${reference}. It is now on the incident register and requires an investigation ` +
        'with a root cause and at least one action before it can be closed.',
    };
  }

  async investigate(input: InvestigateIncident) {
    const incident = await this.requireIncident(input.incidentId);

    if (incident.status === 'CLOSED') {
      throw new BadRequestException(
        `${incident.reference} is closed. Reopen it with a reason before adding findings, so the record ` +
          'shows that the conclusion changed and why.',
      );
    }

    const context = tryGetContext();

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.incident.update({
        where: { id: incident.id },
        data: {
          rootCause: input.rootCause,
          status: 'ACTION_TAKEN',
          version: { increment: 1 },
        },
        select: { id: true, reference: true, status: true, rootCause: true },
      });

      await tx.correctiveAction.createMany({
        data: input.actions.map((action) => ({
          organisationId: incident.organisationId,
          facilityId: incident.facilityId,
          incidentId: incident.id,
          description: action.description,
          ownerUserId: action.ownerUserId,
          dueDate: action.dueDate ? new Date(action.dueDate) : undefined,
          createdBy: context?.userId,
        })),
      });

      return row;
    });

    await this.audit.record({
      action: 'quality.incident.investigate',
      entityType: 'incident',
      entityId: incident.id,
      facilityId: incident.facilityId,
      oldValue: { status: incident.status },
      newValue: { status: 'ACTION_TAKEN', actions: input.actions.length },
      severity: 'NOTICE',
    });

    return updated;
  }

  async completeAction(input: CompleteAction) {
    const { facilityIds } = getTenantScope();

    const action = await this.prisma.correctiveAction.findFirst({
      where: { id: input.actionId, facilityId: { in: [...facilityIds] } },
      select: { id: true, facilityId: true, status: true, description: true },
    });

    if (!action) throw new NotFoundException('No such action, or it is not visible to you.');

    if (action.status === 'COMPLETED') {
      throw new BadRequestException('This action is already recorded as completed.');
    }

    const completed = await this.prisma.correctiveAction.update({
      where: { id: action.id },
      data: {
        status: 'COMPLETED',
        completedAt: this.now(),
        verificationNote: input.verificationNote,
        version: { increment: 1 },
      },
      select: { id: true, status: true, completedAt: true, verificationNote: true },
    });

    await this.audit.record({
      action: 'quality.action.complete',
      entityType: 'corrective_action',
      entityId: action.id,
      facilityId: action.facilityId,
      oldValue: { status: action.status },
      newValue: { status: 'COMPLETED', verificationNote: input.verificationNote },
    });

    return completed;
  }

  /**
   * Close an incident.
   *
   * Refused while an action is outstanding. An incident closed with its
   * actions still open is an incident that was filed, not one that was dealt
   * with, and the register would then measure paperwork rather than safety.
   */
  async close(input: CloseIncident) {
    const incident = await this.requireIncident(input.incidentId);

    if (incident.status === 'CLOSED') {
      throw new BadRequestException(`${incident.reference} is already closed.`);
    }

    if (!incident.rootCause) {
      throw new BadRequestException(
        `${incident.reference} has no root cause recorded. Investigate it first: closing it now would ` +
          'record that something happened and nobody found out why.',
      );
    }

    const outstanding = await this.prisma.correctiveAction.findMany({
      where: { incidentId: incident.id, status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] } },
      select: { id: true, description: true, dueDate: true },
    });

    if (outstanding.length > 0) {
      throw new BadRequestException(
        `${incident.reference} has ${outstanding.length} outstanding action(s) and cannot be closed: ` +
          `${outstanding.map((action) => `"${action.description}"`).join('; ')}. ` +
          'Complete them, or cancel them with a reason.',
      );
    }

    const actions = await this.prisma.correctiveAction.count({ where: { incidentId: incident.id } });

    if (actions === 0) {
      throw new BadRequestException(
        `${incident.reference} has no corrective action recorded. An investigation that produced no ` +
          'action is a finding nobody acted on.',
      );
    }

    const closed = await this.prisma.incident.update({
      where: { id: incident.id },
      data: { status: 'CLOSED', closedAt: this.now(), version: { increment: 1 } },
      select: { id: true, reference: true, status: true, closedAt: true },
    });

    await this.audit.record({
      action: 'quality.incident.close',
      entityType: 'incident',
      entityId: incident.id,
      facilityId: incident.facilityId,
      oldValue: { status: incident.status },
      newValue: { status: 'CLOSED', closureNote: input.closureNote, actionsCompleted: actions },
      severity: 'NOTICE',
    });

    return closed;
  }

  async listIncidents(facilityId: string) {
    this.assertFacilityVisible(facilityId);

    const incidents = await this.prisma.incident.findMany({
      where: { facilityId },
      orderBy: [{ status: 'asc' }, { occurredAt: 'desc' }],
      select: {
        id: true,
        reference: true,
        incidentType: true,
        description: true,
        severity: true,
        status: true,
        occurredAt: true,
        reportedAt: true,
        patientAffected: true,
        rootCause: true,
        closedAt: true,
        actions: {
          select: {
            id: true,
            description: true,
            status: true,
            dueDate: true,
            completedAt: true,
            verificationNote: true,
          },
        },
      },
    });

    const today = this.now();

    return incidents.map((incident) => ({
      ...incident,
      actions: incident.actions.map((action) => ({
        ...action,
        // Overdue is a fact about a date, computed on read. Storing it would
        // make the register correct only as recently as the last job run (§10).
        overdue: Boolean(action.dueDate && action.status !== 'COMPLETED' && action.dueDate < today),
      })),
      openActions: incident.actions.filter((action) => action.status !== 'COMPLETED').length,
      daysOpen:
        incident.closedAt === null
          ? Math.floor((today.getTime() - incident.reportedAt.getTime()) / 86_400_000)
          : null,
    }));
  }

  // ---------------------------------------------------------------------------
  // Complaints
  // ---------------------------------------------------------------------------

  async receiveComplaint(input: ReceiveComplaint) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    if (input.isAnonymous && (input.complainantName || input.complainantContact)) {
      // Recording a name against an anonymous complaint would break the
      // promise made when it was taken.
      throw new BadRequestException(
        'A complaint marked anonymous cannot carry a name or contact detail. Either record it as ' +
          'anonymous with neither, or record who made it.',
      );
    }

    const context = tryGetContext();
    const reference = await this.nextReference('complaint', organisationId, 'CMP');

    const complaint = await this.prisma.complaint.create({
      data: {
        organisationId,
        facilityId: input.facilityId,
        reference,
        source: input.source,
        subject: input.subject,
        description: input.description,
        complainantName: input.complainantName,
        complainantContact: input.complainantContact,
        isAnonymous: input.isAnonymous,
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : this.now(),
        createdBy: context?.userId,
      },
      select: { id: true, reference: true, subject: true, status: true, receivedAt: true, isAnonymous: true },
    });

    await this.audit.record({
      action: 'quality.complaint.receive',
      entityType: 'complaint',
      entityId: complaint.id,
      facilityId: input.facilityId,
      // Deliberately not the complainant's name: the audit log is read far more
      // widely than the complaint itself.
      newValue: { reference, source: input.source, anonymous: input.isAnonymous },
    });

    return complaint;
  }

  async actOnComplaint(input: ActOnComplaint) {
    const complaint = await this.requireComplaint(input.complaintId);

    if (complaint.status === 'CLOSED') {
      throw new BadRequestException(`${complaint.reference} is closed.`);
    }

    const context = tryGetContext();

    const action = await this.prisma.$transaction(async (tx) => {
      const row = await tx.complaintAction.create({
        data: {
          complaintId: complaint.id,
          organisationId: complaint.organisationId,
          description: input.description,
          outcome: input.outcome,
          takenBy: context?.userId,
        },
        select: { id: true, description: true, outcome: true, takenAt: true },
      });

      await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status: complaint.status === 'RECEIVED' ? 'INVESTIGATING' : complaint.status,
          assignedTo: complaint.assignedTo ?? context?.userId,
          version: { increment: 1 },
        },
      });

      return row;
    });

    await this.audit.record({
      action: 'quality.complaint.act',
      entityType: 'complaint',
      entityId: complaint.id,
      facilityId: complaint.facilityId,
      newValue: { reference: complaint.reference, action: input.description },
    });

    return action;
  }

  async resolveComplaint(input: ResolveComplaint) {
    const complaint = await this.requireComplaint(input.complaintId);

    if (complaint.status === 'RESOLVED' || complaint.status === 'CLOSED') {
      throw new BadRequestException(`${complaint.reference} is already ${complaint.status.toLowerCase()}.`);
    }

    const actions = await this.prisma.complaintAction.count({ where: { complaintId: complaint.id } });

    if (actions === 0) {
      throw new BadRequestException(
        `${complaint.reference} has no action recorded against it. A complaint resolved with nothing ` +
          'done is a complaint that was closed, not resolved.',
      );
    }

    const resolved = await this.prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        status: 'RESOLVED',
        resolution: input.resolution,
        resolvedAt: this.now(),
        // Never defaulted and never inferred: satisfaction is what the
        // complainant said, or it is nothing.
        satisfactionRating: input.satisfactionRating,
        version: { increment: 1 },
      },
      select: { id: true, reference: true, status: true, resolvedAt: true, satisfactionRating: true },
    });

    await this.audit.record({
      action: 'quality.complaint.resolve',
      entityType: 'complaint',
      entityId: complaint.id,
      facilityId: complaint.facilityId,
      oldValue: { status: complaint.status },
      newValue: { status: 'RESOLVED', actions, satisfactionRating: input.satisfactionRating ?? null },
      severity: 'NOTICE',
    });

    return resolved;
  }

  async listComplaints(facilityId: string) {
    this.assertFacilityVisible(facilityId);

    const complaints = await this.prisma.complaint.findMany({
      where: { facilityId },
      orderBy: [{ status: 'asc' }, { receivedAt: 'desc' }],
      select: {
        id: true,
        reference: true,
        source: true,
        subject: true,
        description: true,
        isAnonymous: true,
        status: true,
        receivedAt: true,
        resolvedAt: true,
        resolution: true,
        satisfactionRating: true,
        actions: { select: { id: true, description: true, outcome: true, takenAt: true } },
      },
    });

    const today = this.now();
    const resolved = complaints.filter((complaint) => complaint.resolvedAt !== null);

    return {
      complaints: complaints.map((complaint) => ({
        ...complaint,
        daysOpen:
          complaint.resolvedAt === null
            ? Math.floor((today.getTime() - complaint.receivedAt.getTime()) / 86_400_000)
            : Math.floor((complaint.resolvedAt.getTime() - complaint.receivedAt.getTime()) / 86_400_000),
        actionCount: complaint.actions.length,
      })),
      // Computed from the rows above, with its denominator stated. A mean
      // presented without the count it came from invites false confidence.
      resolution: {
        resolvedCount: resolved.length,
        openCount: complaints.length - resolved.length,
        meanDaysToResolve:
          resolved.length === 0
            ? null
            : Math.round(
                (resolved.reduce(
                  (sum, complaint) =>
                    sum + (complaint.resolvedAt!.getTime() - complaint.receivedAt.getTime()) / 86_400_000,
                  0,
                ) /
                  resolved.length) *
                  10,
              ) / 10,
        ratedCount: resolved.filter((complaint) => complaint.satisfactionRating !== null).length,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Quality improvement cycles (spec §39)
  // ---------------------------------------------------------------------------

  /**
   * Open a cycle: problem → root cause → intervention → measurement → review.
   *
   * The indicator is named before the work starts, and its baseline is taken
   * from the last measured KPI result rather than typed in. Choosing the
   * measure afterwards is how an intervention that changed nothing gets
   * written up as a success.
   */
  async openCycle(input: OpenQualityCycle) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const assignment = await this.prisma.kpiAssignment.findFirst({
      where: { kpiId: input.measurementKpiId, facilityId: input.facilityId, status: 'ACTIVE' },
      select: {
        id: true,
        kpi: { select: { id: true, code: true, name: true, unit: true } },
        results: { orderBy: { periodEnd: 'desc' }, take: 1, select: { value: true, periodEnd: true } },
      },
    });

    if (!assignment) {
      throw new BadRequestException(
        'That KPI is not assigned to this facility, so a cycle cannot be measured against it. Assign ' +
          'the KPI first.',
      );
    }

    const latest = assignment.results[0];
    const context = tryGetContext();
    const reference = await this.nextReference('quality_improvement', organisationId, 'QI');

    const cycle = await this.prisma.qualityImprovement.create({
      data: {
        organisationId,
        facilityId: input.facilityId,
        reference,
        title: input.title,
        problemStatement: input.problemStatement,
        measurementKpiId: input.measurementKpiId,
        // The baseline as measured, or null. Never a guess: a cycle with no
        // starting measurement can still run, and it will say so.
        baselineValue: latest?.value ?? null,
        targetValue: input.targetValue,
        ownerUserId: input.ownerUserId ?? context?.userId,
        startedOn: this.now(),
        createdBy: context?.userId,
      },
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        baselineValue: true,
        targetValue: true,
        startedOn: true,
      },
    });

    await this.audit.record({
      action: 'quality.cycle.open',
      entityType: 'quality_improvement',
      entityId: cycle.id,
      facilityId: input.facilityId,
      newValue: { reference, kpi: assignment.kpi.code, baselineValue: latest?.value?.toString() ?? null },
    });

    return {
      ...cycle,
      baselineValue: cycle.baselineValue === null ? null : Number(cycle.baselineValue),
      targetValue: cycle.targetValue === null ? null : Number(cycle.targetValue),
      kpi: assignment.kpi,
      baselineNote:
        latest === undefined
          ? 'No KPI result has been computed for this facility yet, so this cycle has no measured ' +
            'starting point. Compute the KPI before claiming an improvement against it.'
          : `Baseline taken from the KPI result for the period ending ${latest.periodEnd.toISOString().slice(0, 10)}.`,
    };
  }

  /**
   * Move a cycle along its stages.
   *
   * The review stage is the one with teeth: it requires a KPI result measured
   * after the cycle started, because "we think it helped" is not a measurement.
   */
  async advanceCycle(input: AdvanceQualityCycle) {
    const { facilityIds } = getTenantScope();

    const cycle = await this.prisma.qualityImprovement.findFirst({
      where: { id: input.cycleId, facilityId: { in: [...facilityIds] } },
      select: {
        id: true,
        reference: true,
        facilityId: true,
        status: true,
        measurementKpiId: true,
        baselineValue: true,
        targetValue: true,
        startedOn: true,
        rootCauseAnalysis: true,
        intervention: true,
      },
    });

    if (!cycle) throw new NotFoundException('No such improvement cycle, or it is not visible to you.');

    if (cycle.status === 'CLOSED') {
      throw new BadRequestException(`${cycle.reference} is closed.`);
    }

    let status = cycle.status;
    if (input.rootCauseAnalysis) status = 'ANALYSING';
    if (input.intervention) status = 'INTERVENING';

    if (input.reviewOutcome) {
      if (!(cycle.intervention || input.intervention)) {
        throw new BadRequestException(
          `${cycle.reference} has no intervention recorded, so there is nothing to review. Record what ` +
            'was actually changed first.',
        );
      }

      const measured = await this.currentValue(cycle.measurementKpiId, cycle.facilityId, cycle.startedOn);

      if (measured === null) {
        throw new BadRequestException(
          `${cycle.reference} cannot be reviewed: no result has been computed for its indicator since ` +
            'the cycle started. Compute the KPI for a period after the intervention, then review. An ' +
            'improvement nobody measured is an opinion.',
        );
      }

      status = 'REVIEWED';
    }

    const updated = await this.prisma.qualityImprovement.update({
      where: { id: cycle.id },
      data: {
        rootCauseAnalysis: input.rootCauseAnalysis ?? cycle.rootCauseAnalysis,
        intervention: input.intervention ?? cycle.intervention,
        reviewOutcome: input.reviewOutcome,
        reviewDate: input.reviewOutcome ? this.now() : undefined,
        status,
        version: { increment: 1 },
      },
      select: { id: true, reference: true, status: true, reviewDate: true },
    });

    await this.audit.record({
      action: 'quality.cycle.advance',
      entityType: 'quality_improvement',
      entityId: cycle.id,
      facilityId: cycle.facilityId,
      oldValue: { status: cycle.status },
      newValue: { status },
    });

    return updated;
  }

  async listCycles(facilityId: string) {
    this.assertFacilityVisible(facilityId);

    const cycles = await this.prisma.qualityImprovement.findMany({
      where: { facilityId },
      orderBy: [{ status: 'asc' }, { startedOn: 'desc' }],
      select: {
        id: true,
        reference: true,
        title: true,
        problemStatement: true,
        rootCauseAnalysis: true,
        intervention: true,
        reviewOutcome: true,
        status: true,
        measurementKpiId: true,
        baselineValue: true,
        targetValue: true,
        startedOn: true,
        reviewDate: true,
      },
    });

    return Promise.all(
      cycles.map(async (cycle) => {
        // Derived, never stored. `current_value` stays null in the table on
        // purpose: the truth is the KPI result, and a copy of it here would be
        // a second number to disagree with the first (§10).
        const current = await this.currentValue(cycle.measurementKpiId, facilityId, cycle.startedOn);
        const baseline = cycle.baselineValue === null ? null : Number(cycle.baselineValue);

        return {
          ...cycle,
          baselineValue: baseline,
          targetValue: cycle.targetValue === null ? null : Number(cycle.targetValue),
          currentValue: current,
          change: current === null || baseline === null ? null : Math.round((current - baseline) * 1e6) / 1e6,
          measured: current !== null,
          note:
            current === null
              ? 'No result has been computed for this indicator since the cycle started, so no change ' +
                'can be claimed.'
              : undefined,
        };
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** The most recent measured value for a KPI, after a given date. */
  private async currentValue(
    kpiId: string | null,
    facilityId: string,
    after: Date | null,
  ): Promise<number | null> {
    if (!kpiId) return null;

    const result = await this.prisma.kpiResult.findFirst({
      where: {
        facilityId,
        kpiAssignment: { kpiId },
        isSuppressed: false,
        ...(after ? { periodEnd: { gte: after } } : {}),
      },
      orderBy: { periodEnd: 'desc' },
      select: { value: true },
    });

    return result?.value === null || result?.value === undefined ? null : Number(result.value);
  }

  private async requireIncident(incidentId: string) {
    const { facilityIds } = getTenantScope();

    const incident = await this.prisma.incident.findFirst({
      where: { id: incidentId, facilityId: { in: [...facilityIds] } },
      select: {
        id: true,
        reference: true,
        organisationId: true,
        facilityId: true,
        status: true,
        rootCause: true,
      },
    });

    if (!incident) throw new NotFoundException('No such incident, or it is not visible to you.');
    return incident;
  }

  private async requireComplaint(complaintId: string) {
    const { facilityIds } = getTenantScope();

    const complaint = await this.prisma.complaint.findFirst({
      where: { id: complaintId, facilityId: { in: [...facilityIds] } },
      select: {
        id: true,
        reference: true,
        organisationId: true,
        facilityId: true,
        status: true,
        assignedTo: true,
      },
    });

    if (!complaint) throw new NotFoundException('No such complaint, or it is not visible to you.');
    return complaint;
  }

  private async nextReference(
    entity: 'incident' | 'complaint' | 'quality_improvement',
    organisationId: string,
    prefix: string,
  ): Promise<string> {
    const count =
      entity === 'incident'
        ? await this.prisma.incident.count({ where: { organisationId } })
        : entity === 'complaint'
          ? await this.prisma.complaint.count({ where: { organisationId } })
          : await this.prisma.qualityImprovement.count({ where: { organisationId } });

    return `${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
}
