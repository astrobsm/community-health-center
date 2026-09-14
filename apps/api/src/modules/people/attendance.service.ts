import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Clock, CorrectAttendance, CreateSchedule } from '@chc/contracts';

import { ReasonRequiredError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import { summariseAttendance, type AttendanceEvent, type ScheduledShift } from './domain/attendance';

/**
 * Rostering and attendance (spec §24, the first link of criterion J).
 *
 * The attendance table is append-only. A clock event is a fact about a moment,
 * and a fact is not improved by being edited: a correction is a NEW row that
 * points at the one it replaces, so the original mistake and the correction
 * both remain visible. That is also what makes the table safe to sync from a
 * phone that was offline for a week — two events are two events, never a merge
 * (doc 10 §5).
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date();
  }

  // ---------------------------------------------------------------------------
  // Rostering
  // ---------------------------------------------------------------------------

  /**
   * Create a schedule and its shifts.
   *
   * Published in the same call: an unpublished roster is a draft, and metrics
   * deliberately ignore drafts so that a score cannot be changed by editing
   * one after the fact.
   */
  async createSchedule(input: CreateSchedule) {
    const staff = await this.requireStaff(input.staffId);
    const context = tryGetContext();

    for (const shift of input.shifts) {
      if (new Date(shift.endsAt) <= new Date(shift.startsAt)) {
        throw new BadRequestException(
          `A shift starting ${shift.startsAt} ends at or before it starts. A night shift crossing ` +
            'midnight still ends on the following date.',
        );
      }
    }

    const schedule = await this.prisma.staffSchedule.create({
      data: {
        staffId: staff.id,
        organisationId: staff.organisationId,
        facilityId: staff.facilityId,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
        publishedAt: this.now(),
        publishedBy: context?.userId,
        shifts: {
          create: input.shifts.map((shift) => ({
            organisationId: staff.organisationId,
            facilityId: staff.facilityId,
            shiftType: shift.shiftType,
            startsAt: new Date(shift.startsAt),
            endsAt: new Date(shift.endsAt),
            departmentId: shift.departmentId,
            notes: shift.notes,
          })),
        },
      },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        publishedAt: true,
        shifts: { select: { id: true, shiftType: true, startsAt: true, endsAt: true }, orderBy: { startsAt: 'asc' } },
      },
    });

    await this.audit.record({
      action: 'hr.schedule.publish',
      entityType: 'staff_schedule',
      entityId: schedule.id,
      facilityId: staff.facilityId,
      newValue: { staffId: staff.id, shifts: schedule.shifts.length },
    });

    return schedule;
  }

  // ---------------------------------------------------------------------------
  // Clocking
  // ---------------------------------------------------------------------------

  async clock(input: Clock) {
    const staff = await this.requireStaff(input.staffId);
    const context = tryGetContext();

    if (input.method === 'MANUAL' && !input.manualReason) {
      // The one path by which a person asserts attendance without an event.
      // It must say who and why, or it is an unaccountable assertion about
      // somebody else's pay.
      throw new ReasonRequiredError('Recording attendance manually');
    }

    if (input.method !== 'MANUAL' && input.manualReason) {
      throw new BadRequestException(
        'A manual reason was given for a clock event that was not manual. Either record it as MANUAL, ' +
          'or leave the reason off — a reason attached to an automatic event makes the log misleading.',
      );
    }

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : this.now();

    if (occurredAt.getTime() > this.now().getTime() + 60_000) {
      throw new BadRequestException('A clock event cannot be recorded in the future.');
    }

    if (input.method !== 'MANUAL' && input.occurredAt) {
      // A device clocking somebody in says when it happened; a person typing a
      // time is doing something else entirely, and that difference has to stay
      // visible in the record.
      throw new BadRequestException(
        'Only a MANUAL entry may state its own time. An automatic clock event is timed when it happens.',
      );
    }

    const shiftId = input.shiftId ?? (await this.resolveShift(staff.id, occurredAt));

    const event = await this.prisma.attendance.create({
      data: {
        staffId: staff.id,
        organisationId: staff.organisationId,
        facilityId: staff.facilityId,
        eventType: input.eventType,
        occurredAt,
        method: input.method,
        latitude: input.latitude,
        longitude: input.longitude,
        shiftId,
        recordedBy: context?.userId,
        manualReason: input.manualReason,
      },
      select: { id: true, eventType: true, occurredAt: true, method: true, shiftId: true },
    });

    await this.audit.record({
      action: 'attendance.record',
      entityType: 'attendance',
      entityId: event.id,
      facilityId: staff.facilityId,
      newValue: {
        staffId: staff.id,
        eventType: input.eventType,
        method: input.method,
        occurredAt: occurredAt.toISOString(),
        manualReason: input.manualReason,
      },
      severity: input.method === 'MANUAL' ? 'NOTICE' : 'INFO',
    });

    return {
      ...event,
      matchedShift: shiftId !== null,
      note:
        shiftId === null
          ? 'No rostered shift matched this time. The event is recorded, but it will not count towards ' +
            'attendance until somebody links it to a shift.'
          : undefined,
    };
  }

  /**
   * Correct an event by appending its replacement (spec §43).
   *
   * The original row stays exactly as it was recorded. Anybody reading the log
   * later can see both what was first entered and what it was changed to, by
   * whom and why.
   */
  async correct(input: CorrectAttendance) {
    const { facilityIds } = getTenantScope();

    const original = await this.prisma.attendance.findFirst({
      where: { id: input.attendanceId, facilityId: { in: [...facilityIds] } },
      select: {
        id: true,
        staffId: true,
        organisationId: true,
        facilityId: true,
        eventType: true,
        occurredAt: true,
        shiftId: true,
      },
    });

    if (!original) throw new NotFoundException('No such attendance event, or it is not visible to you.');

    const alreadyCorrected = await this.prisma.attendance.findFirst({
      where: { correctsId: original.id },
      select: { id: true },
    });

    if (alreadyCorrected) {
      throw new BadRequestException(
        'This event has already been corrected. Correct the correction, so the chain of what was ' +
          'believed when stays readable.',
      );
    }

    const occurredAt = new Date(input.occurredAt);
    const context = tryGetContext();

    const correction = await this.prisma.attendance.create({
      data: {
        staffId: original.staffId,
        organisationId: original.organisationId,
        facilityId: original.facilityId,
        eventType: original.eventType,
        occurredAt,
        // A correction is always somebody deciding, never a device reading.
        method: 'MANUAL',
        shiftId: original.shiftId,
        recordedBy: context?.userId,
        manualReason: input.correctionReason,
        correctsId: original.id,
        correctionReason: input.correctionReason,
      },
      select: { id: true, eventType: true, occurredAt: true, correctsId: true },
    });

    await this.audit.record({
      action: 'attendance.correct',
      entityType: 'attendance',
      entityId: correction.id,
      facilityId: original.facilityId,
      oldValue: { occurredAt: original.occurredAt.toISOString() },
      newValue: { occurredAt: occurredAt.toISOString(), reason: input.correctionReason, corrects: original.id },
      severity: 'NOTICE',
    });

    return correction;
  }

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  async summary(params: { staffId: string; periodStart: string; periodEnd: string }) {
    const staff = await this.requireStaff(params.staffId);

    const from = startOfDay(new Date(params.periodStart));
    const to = endOfDay(new Date(params.periodEnd));

    const [shiftRows, eventRows] = await Promise.all([
      this.prisma.shift.findMany({
        where: {
          facilityId: staff.facilityId,
          startsAt: { gte: from, lt: to },
          schedule: { staffId: staff.id, publishedAt: { not: null } },
        },
        select: { id: true, shiftType: true, startsAt: true, endsAt: true },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.attendance.findMany({
        where: { staffId: staff.id, occurredAt: { gte: from, lt: to } },
        select: {
          id: true,
          eventType: true,
          occurredAt: true,
          shiftId: true,
          method: true,
          manualReason: true,
          correctsId: true,
        },
        orderBy: { occurredAt: 'asc' },
      }),
    ]);

    const superseded = new Set(
      eventRows.map((row) => row.correctsId).filter((id): id is string => id !== null),
    );

    const shifts: ScheduledShift[] = shiftRows.map((row) => ({
      id: row.id,
      shiftType: row.shiftType,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    }));

    const events: AttendanceEvent[] = eventRows
      .filter((row) => !superseded.has(row.id))
      .map((row) => ({
        id: row.id,
        eventType: row.eventType,
        occurredAt: row.occurredAt,
        shiftId: row.shiftId,
        method: row.method,
        manualReason: row.manualReason,
      }));

    return {
      staffId: staff.id,
      name: `${staff.givenName} ${staff.familyName}`,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      ...summariseAttendance(shifts, events, this.now()),
      correctedEvents: superseded.size,
    };
  }

  /**
   * Find the shift a clock event belongs to.
   *
   * Generous at the edges — an hour before the start, four hours after the end
   * — because people arrive early and leave late, and an event matched to no
   * shift is worse than one matched to an obvious shift.
   */
  private async resolveShift(staffId: string, at: Date): Promise<string | null> {
    const shift = await this.prisma.shift.findFirst({
      where: {
        schedule: { staffId, publishedAt: { not: null } },
        startsAt: { lte: new Date(at.getTime() + 60 * 60_000) },
        endsAt: { gte: new Date(at.getTime() - 4 * 60 * 60_000) },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true },
    });

    return shift?.id ?? null;
  }

  private async requireStaff(staffId: string) {
    const { facilityIds } = getTenantScope();

    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, facilityId: { in: [...facilityIds] }, deletedAt: null },
      select: {
        id: true,
        organisationId: true,
        facilityId: true,
        givenName: true,
        familyName: true,
        status: true,
      },
    });

    if (!staff) throw new NotFoundException('No such member of staff, or they are not visible to you.');
    return staff;
  }
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  copy.setUTCDate(copy.getUTCDate() + 1);
  return copy;
}
