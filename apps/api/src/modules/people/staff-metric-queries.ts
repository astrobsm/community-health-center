import {
  periodRange,
  rate,
  UnknownMetricQueryError,
  type MetricQueryOutcome,
  type MetricQueryParams,
  type NamedMetricQuery,
} from '../../common/metric-query';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

import { summariseAttendance, type AttendanceEvent, type ScheduledShift } from './domain/attendance';

/**
 * The named queries that can score a member of staff (spec §25).
 *
 * Every one of them reads transactions somebody else recorded for their own
 * reasons — an encounter closed, a shift clocked, a consent taken. None of
 * them reads a number entered for the purpose of scoring, because a metric
 * that can be typed is a metric that can be arranged.
 *
 * Exactly one is marked `isVolumeMetric`. That flag is what the incentive
 * engine reads when it refuses a configuration where patient headcount is the
 * whole basis of pay.
 */

type Client = PrismaService;

/**
 * Attendance events, with corrected rows removed.
 *
 * The table is append-only: a correction is a new row pointing at the one it
 * replaces (doc 10 §5). Summarising without dropping the superseded rows would
 * count the mistake and the correction as two events.
 */
async function liveAttendanceEvents(
  client: Client,
  params: MetricQueryParams,
): Promise<AttendanceEvent[]> {
  const { gte, lt } = periodRange(params);

  const rows = await client.attendance.findMany({
    where: { staffId: params.staffId, facilityId: params.facilityId, occurredAt: { gte, lt } },
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
  });

  const superseded = new Set(rows.map((row) => row.correctsId).filter((id): id is string => id !== null));

  return rows
    .filter((row) => !superseded.has(row.id))
    .map((row) => ({
      id: row.id,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      shiftId: row.shiftId,
      method: row.method,
      manualReason: row.manualReason,
    }));
}

async function rosteredShifts(client: Client, params: MetricQueryParams): Promise<ScheduledShift[]> {
  const { gte, lt } = periodRange(params);

  const rows = await client.shift.findMany({
    where: {
      facilityId: params.facilityId,
      startsAt: { gte, lt },
      schedule: { staffId: params.staffId, publishedAt: { not: null } },
    },
    select: { id: true, shiftType: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    shiftType: row.shiftType,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  }));
}

/**
 * Attendance, computed once and reused by the three queries that need it.
 *
 * Only PUBLISHED schedules count. A draft roster is a plan somebody is still
 * editing, and scoring against it would let a supervisor change a score by
 * changing a draft.
 */
async function attendanceSummary(client: Client, params: MetricQueryParams) {
  const [shifts, events] = await Promise.all([
    rosteredShifts(client, params),
    liveAttendanceEvents(client, params),
  ]);

  return { summary: summariseAttendance(shifts, events, params.now), shifts, events };
}

function noRoster(shiftCount: number): MetricQueryOutcome | null {
  if (shiftCount > 0) return null;

  return {
    value: null,
    sampleSize: 0,
    inputs: { rosteredShifts: 0 },
    note:
      'No published shift was rostered for this person in this period, so there is no attendance to ' +
      'measure. This is not an attendance of zero.',
  };
}

const QUERIES: NamedMetricQuery<Client>[] = [
  {
    id: 'staff/attendance_rate@v1',
    name: 'Attendance rate',
    definition:
      'Rostered shifts the person was present for, over rostered shifts. A shift clocked into but ' +
      'never clocked out counts as present: somebody was there.',
    unit: 'ratio',
    scope: 'STAFF',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: false,
    reads: ['people.shift', 'people.staff_schedule', 'people.attendance'],
    async run(client, params) {
      const { summary } = await attendanceSummary(client, params);

      const empty = noRoster(summary.scheduledShifts);
      if (empty) return empty;

      return {
        value: summary.attendanceRate,
        sampleSize: summary.scheduledShifts,
        inputs: {
          scheduledShifts: summary.scheduledShifts,
          attendedShifts: summary.attendedShifts,
          absentShifts: summary.absentShifts,
          unclosedShifts: summary.unclosedShifts,
        },
        note: summary.needsReview ? summary.reviewReasons.join(' ') : undefined,
      };
    },
  },

  {
    id: 'staff/punctuality_rate@v1',
    name: 'Punctuality',
    definition:
      'Shifts started within the grace period, over shifts the person was present for. Absence is ' +
      'not lateness and is excluded from both sides.',
    unit: 'ratio',
    scope: 'STAFF',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: false,
    reads: ['people.shift', 'people.attendance'],
    async run(client, params) {
      const { summary } = await attendanceSummary(client, params);

      const empty = noRoster(summary.scheduledShifts);
      if (empty) return empty;

      if (summary.attendedShifts === 0) {
        return {
          value: null,
          sampleSize: 0,
          inputs: { scheduledShifts: summary.scheduledShifts, attendedShifts: 0 },
          note: 'The person was present for no shift in this period, so punctuality has nothing to measure.',
        };
      }

      return {
        value: rate(summary.attendedShifts - summary.lateShifts, summary.attendedShifts),
        sampleSize: summary.attendedShifts,
        inputs: { attendedShifts: summary.attendedShifts, lateShifts: summary.lateShifts },
      };
    },
  },

  {
    id: 'staff/hours_worked@v1',
    name: 'Hours worked',
    definition:
      'Hours between clock-in and clock-out, summed over the shifts where both were recorded. ' +
      'Unclosed shifts are excluded rather than counted as zero.',
    unit: 'hours',
    scope: 'STAFF',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: false,
    reads: ['people.attendance', 'people.shift'],
    async run(client, params) {
      const { summary } = await attendanceSummary(client, params);

      const empty = noRoster(summary.scheduledShifts);
      if (empty) return empty;

      return {
        value: summary.workedHours,
        sampleSize: summary.scheduledShifts - summary.hoursUnknownShifts,
        inputs: {
          workedHours: summary.workedHours,
          scheduledHours: summary.scheduledHours,
          hoursUnknownShifts: summary.hoursUnknownShifts,
        },
        note:
          summary.hoursUnknownShifts > 0
            ? `${summary.hoursUnknownShifts} shift(s) were clocked into but never closed and are excluded ` +
              'from this total. Confirm them before this figure is used to pay anybody.'
            : undefined,
      };
    },
  },

  {
    id: 'staff/encounters_attended@v1',
    name: 'Patients seen',
    definition: 'Encounters in the period where this person is recorded as the attending staff member.',
    unit: 'encounters',
    scope: 'STAFF',
    direction: 'HIGHER_BETTER',
    // The only volume metric in the catalogue, and marked as such so the
    // incentive engine can refuse to pay on it alone (spec §25).
    isVolumeMetric: true,
    suppressSmallCells: false,
    reads: ['clinical.encounter'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const count = await client.encounter.count({
        where: {
          facilityId: params.facilityId,
          attendingStaffId: params.staffId,
          startedAt: { gte, lt },
          status: { not: 'CANCELLED' },
        },
      });

      return {
        value: count,
        sampleSize: count,
        inputs: { encounters: count, periodStart: gte.toISOString(), periodEnd: lt.toISOString() },
      };
    },
  },

  {
    id: 'staff/documentation_rate@v1',
    name: 'Clinical documentation',
    definition:
      'Closed encounters carrying either a diagnosis or a recorded reason for having none, over ' +
      'closed encounters. An encounter closed with neither is undocumented care.',
    unit: 'ratio',
    scope: 'STAFF',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: false,
    reads: ['clinical.encounter', 'clinical.diagnosis'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const encounters = await client.encounter.findMany({
        where: {
          facilityId: params.facilityId,
          attendingStaffId: params.staffId,
          startedAt: { gte, lt },
          status: 'CLOSED',
        },
        select: {
          id: true,
          noDiagnosisReason: true,
          _count: { select: { diagnoses: true } },
        },
      });

      if (encounters.length === 0) {
        return {
          value: null,
          sampleSize: 0,
          inputs: { closedEncounters: 0 },
          note:
            'This person closed no encounter in this period, so there is no documentation to assess. ' +
            'A clinician with no encounters is a rostering question, not a documentation score of zero.',
        };
      }

      const documented = encounters.filter(
        (encounter) => encounter._count.diagnoses > 0 || Boolean(encounter.noDiagnosisReason),
      );

      return {
        value: rate(documented.length, encounters.length),
        sampleSize: encounters.length,
        inputs: {
          closedEncounters: encounters.length,
          documented: documented.length,
          undocumented: encounters.length - documented.length,
        },
      };
    },
  },

  {
    id: 'staff/encounter_closure_rate@v1',
    name: 'Encounters closed',
    definition:
      'Encounters started in the period that have since been closed, over encounters started. An ' +
      'encounter left open indefinitely is a record nobody finished.',
    unit: 'ratio',
    scope: 'STAFF',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: false,
    reads: ['clinical.encounter'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const rows = await client.encounter.groupBy({
        by: ['status'],
        where: {
          facilityId: params.facilityId,
          attendingStaffId: params.staffId,
          startedAt: { gte, lt },
        },
        _count: { _all: true },
      });

      const counts = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
      // A cancelled encounter is not an unfinished one; it is a decision.
      const started = (counts.OPEN ?? 0) + (counts.CLOSED ?? 0);

      if (started === 0) {
        return {
          value: null,
          sampleSize: 0,
          inputs: counts,
          note: 'This person started no encounter in this period.',
        };
      }

      return {
        value: rate(counts.CLOSED ?? 0, started),
        sampleSize: started,
        inputs: { ...counts, started },
      };
    },
  },

  {
    id: 'staff/consent_documented_rate@v1',
    name: 'Consent recorded',
    definition:
      'Encounters whose patient held a granted, unwithdrawn treatment consent at the time care ' +
      'began, over encounters attended.',
    unit: 'ratio',
    scope: 'STAFF',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: false,
    reads: ['clinical.encounter', 'clinical.patient_consent'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const encounters = await client.encounter.findMany({
        where: {
          facilityId: params.facilityId,
          attendingStaffId: params.staffId,
          startedAt: { gte, lt },
          status: { not: 'CANCELLED' },
        },
        select: {
          id: true,
          startedAt: true,
          patient: {
            select: {
              consents: {
                where: { purpose: 'TREATMENT', granted: true },
                select: { grantedAt: true, withdrawnAt: true },
              },
            },
          },
        },
      });

      if (encounters.length === 0) {
        return {
          value: null,
          sampleSize: 0,
          inputs: { encounters: 0 },
          note: 'This person attended no encounter in this period.',
        };
      }

      const covered = encounters.filter((encounter) =>
        encounter.patient.consents.some(
          (consent) =>
            consent.grantedAt <= encounter.startedAt &&
            (consent.withdrawnAt === null || consent.withdrawnAt > encounter.startedAt),
        ),
      );

      return {
        value: rate(covered.length, encounters.length),
        sampleSize: encounters.length,
        inputs: {
          encounters: encounters.length,
          withConsent: covered.length,
          withoutConsent: encounters.length - covered.length,
        },
      };
    },
  },
];

export const STAFF_METRIC_QUERIES: ReadonlyMap<string, NamedMetricQuery<Client>> = new Map(
  QUERIES.map((query) => [query.id, query]),
);

export function getStaffMetricQuery(id: string): NamedMetricQuery<Client> {
  const query = STAFF_METRIC_QUERIES.get(id);
  if (!query) throw new UnknownMetricQueryError(id, [...STAFF_METRIC_QUERIES.keys()]);
  return query;
}

export function listStaffMetricQueries() {
  return QUERIES.map(({ id, name, definition, unit, direction, isVolumeMetric, reads }) => ({
    id,
    name,
    definition,
    unit,
    direction,
    isVolumeMetric,
    reads,
  }));
}
