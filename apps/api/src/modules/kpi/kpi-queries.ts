import { periodRange, UnknownMetricQueryError, type NamedMetricQuery } from '../../common/metric-query';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * The named queries behind every facility KPI (spec §38).
 *
 * A KPI row in the database carries a `source_query_id`. This is what it
 * names. There is no other way to produce a KPI value: nothing in the system
 * accepts a typed-in figure for a KPI, which is how "dashboards must calculate
 * from the authoritative data" becomes a mechanism rather than a request.
 *
 * Each query reports its denominator alongside its value, so a rate computed
 * from four observations is never shown with the same confidence as one
 * computed from four thousand — and so the small-cell rule has something to
 * work with.
 */

type Client = PrismaService;

const QUERIES: NamedMetricQuery<Client>[] = [
  {
    id: 'kpi/patients_per_day@v1',
    name: 'Patients per day',
    definition:
      'Encounters in the period divided by the number of days on which the facility saw anybody. ' +
      'Days with no encounter are excluded from the denominator: a facility that closed for a public ' +
      'holiday did not see nought patients that day, it was shut.',
    unit: 'patients/day',
    scope: 'FACILITY',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: true,
    suppressSmallCells: false,
    reads: ['clinical.encounter'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const encounters = await client.encounter.findMany({
        where: { facilityId: params.facilityId, startedAt: { gte, lt }, status: { not: 'CANCELLED' } },
        select: { startedAt: true },
      });

      if (encounters.length === 0) {
        return {
          value: null,
          sampleSize: 0,
          inputs: { encounters: 0, operatingDays: 0 },
          note:
            'No encounter was recorded in this period. Whether that means the facility was closed or ' +
            'that nobody wrote anything down is not something this query can tell you.',
        };
      }

      const operatingDays = new Set(
        encounters.map((encounter) => encounter.startedAt.toISOString().slice(0, 10)),
      ).size;

      return {
        value: Math.round((encounters.length / operatingDays) * 100) / 100,
        sampleSize: encounters.length,
        inputs: { encounters: encounters.length, operatingDays },
      };
    },
  },

  {
    id: 'kpi/revenue_collected@v1',
    name: 'Revenue collected',
    definition: 'Inbound payments received in the period, in naira.',
    unit: 'NGN',
    scope: 'FACILITY',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: false,
    reads: ['fin.payment'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const result = await client.payment.aggregate({
        where: { facilityId: params.facilityId, direction: 'INBOUND', receivedAt: { gte, lt } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      });

      const minor = result._sum.amountMinor ?? 0n;

      return {
        // Reported in naira because that is what a KPI target is set in; the
        // kobo figure travels alongside so nothing is lost to rounding.
        value: Number(minor) / 100,
        sampleSize: result._count._all,
        inputs: { amountMinor: minor.toString(), payments: result._count._all },
      };
    },
  },

  {
    id: 'kpi/collection_rate@v1',
    name: 'Collection rate',
    definition:
      'Payments allocated to invoices issued in the period, over the value of those invoices. ' +
      'Measures what was actually collected against what was billed.',
    unit: '%',
    scope: 'FACILITY',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    // Invoices, not patients: a collection rate over three invoices is a weak
    // figure but it identifies nobody.
    suppressSmallCells: false,
    reads: ['fin.invoice'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const invoices = await client.invoice.findMany({
        where: {
          facilityId: params.facilityId,
          issuedAt: { gte, lt },
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        select: { totalMinor: true, paidMinor: true },
      });

      if (invoices.length === 0) {
        return {
          value: null,
          sampleSize: 0,
          inputs: { invoices: 0 },
          note: 'No invoice was issued in this period, so there is nothing to have collected.',
        };
      }

      const billed = invoices.reduce((sum, invoice) => sum + invoice.totalMinor, 0n);
      const paid = invoices.reduce((sum, invoice) => sum + invoice.paidMinor, 0n);

      if (billed === 0n) {
        return {
          value: null,
          sampleSize: invoices.length,
          inputs: { invoices: invoices.length, billedMinor: '0' },
          note: 'Invoices were issued with a zero total, so a collection rate cannot be computed.',
        };
      }

      return {
        value: percent(Number(paid), Number(billed)),
        sampleSize: invoices.length,
        inputs: {
          invoices: invoices.length,
          billedMinor: billed.toString(),
          paidMinor: paid.toString(),
          outstandingMinor: (billed - paid).toString(),
        },
      };
    },
  },

  {
    id: 'kpi/consent_documented@v1',
    name: 'Consent documented',
    definition:
      'Encounters whose patient held a granted, unwithdrawn treatment consent when care began, over ' +
      'encounters in the period.',
    unit: '%',
    scope: 'FACILITY',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    // A rate over patients. Withheld where the denominator is small.
    suppressSmallCells: true,
    reads: ['clinical.encounter', 'clinical.patient_consent'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const encounters = await client.encounter.findMany({
        where: { facilityId: params.facilityId, startedAt: { gte, lt }, status: { not: 'CANCELLED' } },
        select: {
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
          note: 'No encounter took place in this period.',
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
        value: percent(covered.length, encounters.length),
        sampleSize: encounters.length,
        inputs: {
          encounters: encounters.length,
          withConsent: covered.length,
          withoutConsent: encounters.length - covered.length,
        },
      };
    },
  },

  {
    id: 'kpi/incident_rate@v1',
    name: 'Incidents per 1,000 encounters',
    definition:
      'Incidents occurring in the period per 1,000 encounters. A rising rate may mean care got worse ' +
      'or that reporting got better; the register alone cannot tell the two apart.',
    unit: 'per 1,000',
    scope: 'FACILITY',
    direction: 'LOWER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: true,
    reads: ['qual.incident', 'clinical.encounter'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const [incidents, encounters] = await Promise.all([
        client.incident.count({ where: { facilityId: params.facilityId, occurredAt: { gte, lt } } }),
        client.encounter.count({
          where: { facilityId: params.facilityId, startedAt: { gte, lt }, status: { not: 'CANCELLED' } },
        }),
      ]);

      if (encounters === 0) {
        return {
          value: null,
          sampleSize: 0,
          inputs: { incidents, encounters: 0 },
          note:
            'No encounter took place in this period, so a rate per 1,000 encounters has no denominator. ' +
            `${incidents} incident(s) were still recorded.`,
        };
      }

      return {
        value: Math.round((incidents / encounters) * 1000 * 100) / 100,
        sampleSize: encounters,
        inputs: { incidents, encounters },
      };
    },
  },

  {
    id: 'kpi/complaint_resolution@v1',
    name: 'Mean days to resolve a complaint',
    definition:
      'Mean days from receipt to resolution, over complaints resolved in the period. Complaints still ' +
      'open are excluded — they have no resolution time yet, and counting them as zero would flatter ' +
      'the figure.',
    unit: 'days',
    scope: 'FACILITY',
    direction: 'LOWER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: false,
    reads: ['qual.complaint'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const resolved = await client.complaint.findMany({
        where: { facilityId: params.facilityId, resolvedAt: { gte, lt } },
        select: { receivedAt: true, resolvedAt: true },
      });

      if (resolved.length === 0) {
        const open = await client.complaint.count({
          where: { facilityId: params.facilityId, resolvedAt: null },
        });

        return {
          value: null,
          sampleSize: 0,
          inputs: { resolved: 0, stillOpen: open },
          note:
            'No complaint was resolved in this period. ' +
            (open > 0 ? `${open} remain(s) open.` : 'None is outstanding.'),
        };
      }

      const totalDays = resolved.reduce(
        (sum, complaint) => sum + (complaint.resolvedAt!.getTime() - complaint.receivedAt.getTime()) / 86_400_000,
        0,
      );

      return {
        value: Math.round((totalDays / resolved.length) * 10) / 10,
        sampleSize: resolved.length,
        inputs: { resolved: resolved.length, totalDays: Math.round(totalDays * 10) / 10 },
      };
    },
  },

  {
    id: 'kpi/corrective_action_completion@v1',
    name: 'Corrective actions completed',
    definition:
      'Corrective actions due in the period that were completed, over actions due. Measures whether ' +
      'what was promised after an incident actually happened.',
    unit: '%',
    scope: 'FACILITY',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: false,
    reads: ['qual.corrective_action'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const actions = await client.correctiveAction.findMany({
        where: { facilityId: params.facilityId, dueDate: { gte, lt }, status: { not: 'CANCELLED' } },
        select: { status: true, dueDate: true, completedAt: true },
      });

      if (actions.length === 0) {
        return {
          value: null,
          sampleSize: 0,
          inputs: { due: 0 },
          note: 'No corrective action fell due in this period.',
        };
      }

      const completed = actions.filter((action) => action.status === 'COMPLETED');

      return {
        value: percent(completed.length, actions.length),
        sampleSize: actions.length,
        inputs: {
          due: actions.length,
          completed: completed.length,
          outstanding: actions.length - completed.length,
        },
      };
    },
  },

  {
    id: 'kpi/staff_attendance@v1',
    name: 'Staff attendance',
    definition:
      'Rostered shifts clocked into, over shifts rostered, across all staff. Counts published ' +
      'rosters only.',
    unit: '%',
    scope: 'FACILITY',
    direction: 'HIGHER_BETTER',
    isVolumeMetric: false,
    suppressSmallCells: false,
    reads: ['people.shift', 'people.attendance'],
    async run(client, params) {
      const { gte, lt } = periodRange(params);

      const shifts = await client.shift.findMany({
        where: {
          facilityId: params.facilityId,
          startsAt: { gte, lt },
          endsAt: { lte: params.now },
          schedule: { publishedAt: { not: null } },
        },
        select: { id: true },
      });

      if (shifts.length === 0) {
        return {
          value: null,
          sampleSize: 0,
          inputs: { shifts: 0 },
          note:
            'No published shift had finished within this period, so attendance has nothing to measure ' +
            'against. This is not an attendance of zero.',
        };
      }

      const attended = await client.attendance.findMany({
        where: {
          facilityId: params.facilityId,
          eventType: 'CLOCK_IN',
          shiftId: { in: shifts.map((shift) => shift.id) },
        },
        select: { shiftId: true },
        distinct: ['shiftId'],
      });

      return {
        value: percent(attended.length, shifts.length),
        sampleSize: shifts.length,
        inputs: { shiftsFinished: shifts.length, shiftsClockedInto: attended.length },
      };
    },
  },
];

export const KPI_QUERIES: ReadonlyMap<string, NamedMetricQuery<Client>> = new Map(
  QUERIES.map((query) => [query.id, query]),
);

export function getKpiQuery(id: string): NamedMetricQuery<Client> {
  const query = KPI_QUERIES.get(id);
  if (!query) throw new UnknownMetricQueryError(id, [...KPI_QUERIES.keys()]);
  return query;
}

/**
 * A rate as a percentage, to two decimal places.
 *
 * KPI targets in this system are set in per cent because that is how a
 * government letter states them; the underlying counts travel in `inputs`, so
 * nothing is lost to the rounding.
 */
function percent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

export function listKpiQueries() {
  return QUERIES.map(({ id, name, definition, unit, direction, reads }) => ({
    id,
    name,
    definition,
    unit,
    direction,
    reads,
  }));
}
