/**
 * Attendance (spec §24, the first link of acceptance criterion J).
 *
 * Turns clock events into the figures a performance metric can use: hours
 * actually worked, shifts attended, lateness. Pure, with the clock injected.
 *
 * The rule that shapes all of it: a missing clock-out is NOT the same as a
 * shift not worked, and neither is the same as an absence. A nurse who worked
 * a full night and forgot to clock out has done the work; recording that as
 * zero hours would take money off somebody who was there. So an unclosed
 * shift is reported as unclosed, and a person decides.
 */

export type AttendanceEventType = 'CLOCK_IN' | 'CLOCK_OUT';

export interface AttendanceEvent {
  id: string;
  eventType: AttendanceEventType;
  occurredAt: Date;
  shiftId: string | null;
  method: string;
  /** Set when a supervisor entered it on somebody's behalf. */
  manualReason: string | null;
}

export interface ScheduledShift {
  id: string;
  shiftType: string;
  startsAt: Date;
  endsAt: Date;
}

export interface ShiftAttendance {
  shiftId: string;
  shiftType: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  scheduledHours: number;
  clockedInAt: Date | null;
  clockedOutAt: Date | null;
  workedHours: number | null;
  minutesLate: number;
  status: 'ATTENDED' | 'LATE' | 'ABSENT' | 'UNCLOSED' | 'NOT_YET_DUE';
  /** Said in words, because a status code alone tells a supervisor nothing. */
  note?: string;
}

export interface AttendanceSummary {
  shifts: ShiftAttendance[];
  scheduledShifts: number;
  attendedShifts: number;
  absentShifts: number;
  unclosedShifts: number;
  lateShifts: number;
  /**
   * Hours rostered across the shifts whose worked hours are known — the
   * denominator of hoursRate, not the whole roster.
   */
  scheduledHours: number;
  workedHours: number;
  /**
   * Shifts whose hours are not known, because they were clocked into and never
   * closed. Their hours are excluded from workedHours and from hoursRate
   * rather than counted as zero.
   */
  hoursUnknownShifts: number;
  /** Shifts present for over shifts scheduled, 0..1. Null when none were scheduled. */
  attendanceRate: number | null;
  /**
   * Hours worked over hours scheduled, across the shifts whose hours are known.
   *
   * Unclosed shifts are left out of both sides. Putting them in the denominator
   * with nothing in the numerator would report somebody who worked all night as
   * having worked none of it.
   */
  hoursRate: number | null;
  /**
   * True when something needs a human before this feeds an incentive.
   *
   * An unclosed shift is not evidence of absence, and using it as such would
   * dock pay from somebody who was at work.
   */
  needsReview: boolean;
  reviewReasons: string[];
}

export interface AttendanceOptions {
  /** Minutes after the scheduled start before a clock-in counts as late. */
  graceMinutes?: number;
  /** How long after a shift ends an unclosed shift is still just unclosed. */
  maxShiftHours?: number;
}

const DEFAULT_GRACE_MINUTES = 15;
const DEFAULT_MAX_SHIFT_HOURS = 16;

export function summariseAttendance(
  shifts: readonly ScheduledShift[],
  events: readonly AttendanceEvent[],
  now: Date,
  options: AttendanceOptions = {},
): AttendanceSummary {
  const grace = options.graceMinutes ?? DEFAULT_GRACE_MINUTES;
  const maxShiftHours = options.maxShiftHours ?? DEFAULT_MAX_SHIFT_HOURS;

  const byShift = new Map<string, AttendanceEvent[]>();
  for (const event of events) {
    if (!event.shiftId) continue;
    byShift.set(event.shiftId, [...(byShift.get(event.shiftId) ?? []), event]);
  }

  const results: ShiftAttendance[] = [];
  const reviewReasons: string[] = [];

  for (const shift of [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const shiftEvents = (byShift.get(shift.id) ?? []).sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );

    const clockIn = shiftEvents.find((event) => event.eventType === 'CLOCK_IN') ?? null;
    // The LAST clock-out, so somebody who stepped out and came back is not
    // recorded as having left at the first opportunity.
    const clockOut =
      [...shiftEvents].reverse().find((event) => event.eventType === 'CLOCK_OUT') ?? null;

    const scheduledHours = hoursBetween(shift.startsAt, shift.endsAt);

    if (!clockIn) {
      // A shift that has not started yet is not an absence. Counting it as one
      // would make every roster look half-abandoned.
      if (shift.startsAt > now) {
        results.push({
          shiftId: shift.id,
          shiftType: shift.shiftType,
          scheduledStart: shift.startsAt,
          scheduledEnd: shift.endsAt,
          scheduledHours,
          clockedInAt: null,
          clockedOutAt: null,
          workedHours: null,
          minutesLate: 0,
          status: 'NOT_YET_DUE',
        });
        continue;
      }

      results.push({
        shiftId: shift.id,
        shiftType: shift.shiftType,
        scheduledStart: shift.startsAt,
        scheduledEnd: shift.endsAt,
        scheduledHours,
        clockedInAt: null,
        clockedOutAt: null,
        workedHours: 0,
        minutesLate: 0,
        status: 'ABSENT',
        note: 'No clock-in was recorded for this shift.',
      });
      continue;
    }

    const minutesLate = Math.max(
      0,
      Math.round((clockIn.occurredAt.getTime() - shift.startsAt.getTime()) / 60_000),
    );

    if (!clockOut) {
      const hoursSinceEnd = hoursBetween(shift.endsAt, now);

      results.push({
        shiftId: shift.id,
        shiftType: shift.shiftType,
        scheduledStart: shift.startsAt,
        scheduledEnd: shift.endsAt,
        scheduledHours,
        clockedInAt: clockIn.occurredAt,
        clockedOutAt: null,
        // Deliberately null, not zero and not the scheduled hours. Somebody
        // was at work; how long for is not known, and guessing it either way
        // takes money from them or gives them money they did not earn.
        workedHours: null,
        minutesLate,
        status: hoursSinceEnd > maxShiftHours || shift.endsAt <= now ? 'UNCLOSED' : 'ATTENDED',
        note:
          shift.endsAt <= now
            ? 'Clocked in but never clocked out. The hours worked are not known and must be confirmed ' +
              'before this counts towards anything.'
            : undefined,
      });

      if (shift.endsAt <= now) {
        reviewReasons.push(
          `Shift on ${shift.startsAt.toISOString().slice(0, 10)} was clocked into but never closed.`,
        );
      }

      continue;
    }

    const workedHours = hoursBetween(clockIn.occurredAt, clockOut.occurredAt);

    results.push({
      shiftId: shift.id,
      shiftType: shift.shiftType,
      scheduledStart: shift.startsAt,
      scheduledEnd: shift.endsAt,
      scheduledHours,
      clockedInAt: clockIn.occurredAt,
      clockedOutAt: clockOut.occurredAt,
      workedHours,
      minutesLate,
      status: minutesLate > grace ? 'LATE' : 'ATTENDED',
      ...(minutesLate > grace
        ? { note: `Clocked in ${minutesLate} minutes after the shift started.` }
        : {}),
    });
  }

  const counted = results.filter((shift) => shift.status !== 'NOT_YET_DUE');
  // An unclosed shift was clocked into: somebody was there, and that is what
  // attendance measures. How long they stayed is a separate question, answered
  // by the hours figures below and flagged for review.
  const attended = counted.filter((shift) => shift.status !== 'ABSENT');
  const absent = counted.filter((shift) => shift.status === 'ABSENT');
  const unclosed = counted.filter((shift) => shift.status === 'UNCLOSED');
  const late = counted.filter((shift) => shift.status === 'LATE');

  // Hours are totalled only over the shifts where they are known. An absence is
  // a known zero and belongs here; an unclosed shift is an unknown and does not,
  // because `?? 0` would quietly turn 'we do not know' into 'they did nothing'.
  const hoursKnown = counted.filter((shift) => shift.workedHours !== null);

  const scheduledHours = round(
    hoursKnown.reduce((sum, shift) => sum + shift.scheduledHours, 0),
    2,
  );

  const workedHours = round(
    hoursKnown.reduce((sum, shift) => sum + (shift.workedHours ?? 0), 0),
    2,
  );

  const manualEntries = events.filter((event) => event.method === 'MANUAL');
  if (manualEntries.length > 0) {
    reviewReasons.push(
      `${manualEntries.length} attendance event(s) were entered manually rather than clocked. ` +
        'Each one is somebody vouching for somebody else.',
    );
  }

  return {
    shifts: results,
    scheduledShifts: counted.length,
    attendedShifts: attended.length,
    absentShifts: absent.length,
    unclosedShifts: unclosed.length,
    lateShifts: late.length,
    scheduledHours,
    workedHours,
    hoursUnknownShifts: counted.length - hoursKnown.length,
    // Null rather than 0 when nothing was scheduled: a person with no roster
    // has no attendance rate, and calling that 0% would score them at nothing.
    attendanceRate: counted.length === 0 ? null : round(attended.length / counted.length, 4),
    hoursRate: scheduledHours === 0 ? null : round(workedHours / scheduledHours, 4),
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
}

function hoursBetween(from: Date, to: Date): number {
  return round(Math.max(0, (to.getTime() - from.getTime()) / 3_600_000), 2);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
