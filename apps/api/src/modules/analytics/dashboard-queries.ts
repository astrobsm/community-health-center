import type { DataClassification } from '@chc/contracts';

import { periodRange, type MetricQueryParams } from '../../common/metric-query';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Every number that appears on a dashboard (spec §71, criterion M).
 *
 * A dashboard figure is not a number. It is a number, the query that produced
 * it, the tables that query read, its classification, the moment it was
 * computed, its denominator, and a way to reach the rows underneath it. This
 * catalogue is where all of that is declared together, so the three cannot
 * drift apart.
 *
 * The `rows` function is what makes "every figure is clickable down to its
 * source records" true rather than aspirational. A figure without one must give
 * `noDrillDownReason`, and the contract schema refuses a figure that does
 * neither — so the only way to put an unreachable number on a dashboard is to
 * state, in words, why it has no rows.
 */

type Client = PrismaService;

export interface FigureRow {
  id: string;
  /** What a reader would call this row. */
  label: string;
  /** The columns worth showing, already formatted for reading. */
  detail: Record<string, string | number | null>;
  /** The next hop down, where one exists. */
  href: string | null;
  /** True where the row was withheld because the caller may not see it. */
  redacted?: boolean;
}

export interface FigureRows {
  rows: FigureRow[];
  totalCount: number;
  /** What these rows are, and how they relate to the figure above them. */
  note: string;
}

export interface FigureOutcome {
  value: number | null;
  sampleSize: number | null;
  note?: string;
  /** Overrides the query's declared classification for this computation. */
  classification?: DataClassification;
  weakenedBy?: Array<{ source: string; classification: DataClassification; reason: string }>;
}

export interface DashboardFigureQuery {
  key: string;
  sourceQueryId: string;
  label: string;
  definition: string;
  unit: string | null;
  /**
   * What this figure is by default.
   *
   * ACTUAL for anything counted from transactions. A figure that summarises
   * what somebody told us is REPORTED however many rows it came from.
   */
  classification: DataClassification;
  reads: readonly string[];
  /** Which dashboards this figure belongs on. */
  sections: readonly string[];
  /**
   * The permission required to see this figure, and to open the rows beneath it.
   *
   * Carried per figure rather than per section. A figure appearing in the
   * manager's overview and in the clinical dashboard needs the same permission
   * in both places; deriving it from whichever section the reader happened to
   * open would mean a government observer seeing clinical counts because they
   * can read the overview.
   */
  permission: string;
  compute(client: Client, params: MetricQueryParams): Promise<FigureOutcome>;
  /** The rows behind the number. Omit only with `noDrillDownReason`. */
  rows?(client: Client, params: MetricQueryParams, limit: number): Promise<FigureRows>;
  noDrillDownReason?: string;
}

const money = (minor: bigint | number) => Number(minor) / 100;

const QUERIES: DashboardFigureQuery[] = [
  // ---------------------------------------------------------------------------
  // Clinical
  // ---------------------------------------------------------------------------
  {
    key: 'encounters',
    sourceQueryId: 'dash/encounters@v1',
    label: 'Encounters',
    definition: 'Encounters started in the period, excluding cancelled ones.',
    unit: 'encounters',
    classification: 'ACTUAL',
    reads: ['clinical.encounter'],
    sections: ['clinical', 'manager', 'government'],
    permission: 'clinical.read',
    async compute(client, params) {
      const { gte, lt } = periodRange(params);
      const count = await client.encounter.count({
        where: { facilityId: params.facilityId, startedAt: { gte, lt }, status: { not: 'CANCELLED' } },
      });
      return { value: count, sampleSize: count };
    },
    async rows(client, params, limit) {
      const { gte, lt } = periodRange(params);
      const [rows, totalCount] = await Promise.all([
        client.encounter.findMany({
          where: { facilityId: params.facilityId, startedAt: { gte, lt }, status: { not: 'CANCELLED' } },
          orderBy: { startedAt: 'desc' },
          take: limit,
          select: {
            id: true,
            reference: true,
            encounterType: true,
            status: true,
            startedAt: true,
            endedAt: true,
            _count: { select: { diagnoses: true, charges: true } },
          },
        }),
        client.encounter.count({
          where: { facilityId: params.facilityId, startedAt: { gte, lt }, status: { not: 'CANCELLED' } },
        }),
      ]);

      return {
        totalCount,
        note: 'Each row is one encounter. The patient is reached from the encounter, and only by a caller permitted to see identity.',
        rows: rows.map((row) => ({
          id: row.id,
          label: row.reference,
          detail: {
            type: row.encounterType,
            status: row.status,
            started: row.startedAt.toISOString(),
            ended: row.endedAt?.toISOString() ?? null,
            diagnoses: row._count.diagnoses,
            charges: row._count.charges,
          },
          href: `/api/v1/lineage/encounter/${row.id}/upstream`,
        })),
      };
    },
  },

  {
    key: 'encounters_open',
    sourceQueryId: 'dash/encounters_open@v1',
    label: 'Encounters still open',
    definition:
      'Encounters started in the period and not yet closed. An encounter left open is a record ' +
      'nobody finished, and it carries no diagnosis into any report.',
    unit: 'encounters',
    classification: 'ACTUAL',
    reads: ['clinical.encounter'],
    sections: ['clinical', 'manager'],
    permission: 'clinical.read',
    async compute(client, params) {
      const { gte, lt } = periodRange(params);
      const count = await client.encounter.count({
        where: { facilityId: params.facilityId, startedAt: { gte, lt }, status: 'OPEN' },
      });
      return { value: count, sampleSize: count };
    },
    async rows(client, params, limit) {
      const { gte, lt } = periodRange(params);
      const rows = await client.encounter.findMany({
        where: { facilityId: params.facilityId, startedAt: { gte, lt }, status: 'OPEN' },
        orderBy: { startedAt: 'asc' },
        take: limit,
        select: { id: true, reference: true, startedAt: true, encounterType: true },
      });

      return {
        totalCount: rows.length,
        note: 'The oldest first, because the oldest is the one somebody has forgotten.',
        rows: rows.map((row) => ({
          id: row.id,
          label: row.reference,
          detail: {
            type: row.encounterType,
            openSince: row.startedAt.toISOString(),
            daysOpen: Math.floor((params.now.getTime() - row.startedAt.getTime()) / 86_400_000),
          },
          href: `/api/v1/lineage/encounter/${row.id}/upstream`,
        })),
      };
    },
  },

  {
    key: 'undocumented_encounters',
    sourceQueryId: 'dash/undocumented_encounters@v1',
    label: 'Closed with no diagnosis and no reason',
    definition:
      'Encounters closed in the period carrying neither a diagnosis nor a recorded reason for having ' +
      'none. This is undocumented care, and it is counted rather than averaged away.',
    unit: 'encounters',
    classification: 'ACTUAL',
    reads: ['clinical.encounter', 'clinical.diagnosis'],
    sections: ['clinical', 'quality'],
    permission: 'clinical.read',
    async compute(client, params) {
      const { gte, lt } = periodRange(params);
      const encounters = await client.encounter.findMany({
        where: { facilityId: params.facilityId, startedAt: { gte, lt }, status: 'CLOSED' },
        select: { id: true, noDiagnosisReason: true, _count: { select: { diagnoses: true } } },
      });

      const undocumented = encounters.filter(
        (encounter) => encounter._count.diagnoses === 0 && !encounter.noDiagnosisReason,
      );

      return { value: undocumented.length, sampleSize: encounters.length };
    },
    async rows(client, params, limit) {
      const { gte, lt } = periodRange(params);
      const encounters = await client.encounter.findMany({
        where: { facilityId: params.facilityId, startedAt: { gte, lt }, status: 'CLOSED' },
        select: {
          id: true,
          reference: true,
          startedAt: true,
          noDiagnosisReason: true,
          attendingStaffId: true,
          _count: { select: { diagnoses: true } },
        },
      });

      const undocumented = encounters.filter(
        (encounter) => encounter._count.diagnoses === 0 && !encounter.noDiagnosisReason,
      );

      return {
        totalCount: undocumented.length,
        note: 'Each of these is a closed encounter with nothing recorded about what was wrong.',
        rows: undocumented.slice(0, limit).map((row) => ({
          id: row.id,
          label: row.reference,
          detail: {
            closed: row.startedAt.toISOString(),
            attendingStaffId: row.attendingStaffId,
          },
          href: `/api/v1/lineage/encounter/${row.id}/upstream`,
        })),
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Money
  // ---------------------------------------------------------------------------
  {
    key: 'revenue_collected',
    sourceQueryId: 'dash/revenue_collected@v1',
    label: 'Revenue collected',
    definition:
      'Inbound payments received in the period. This is cash in hand, not revenue earned — a facility ' +
      'that gives credit will see the two differ.',
    unit: 'NGN',
    classification: 'ACTUAL',
    reads: ['fin.payment'],
    sections: ['finance', 'manager', 'government'],
    permission: 'finance.read',
    async compute(client, params) {
      const { gte, lt } = periodRange(params);
      const result = await client.payment.aggregate({
        where: { facilityId: params.facilityId, direction: 'INBOUND', receivedAt: { gte, lt } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      });
      return { value: money(result._sum.amountMinor ?? 0n), sampleSize: result._count._all };
    },
    async rows(client, params, limit) {
      const { gte, lt } = periodRange(params);
      const [rows, totalCount] = await Promise.all([
        client.payment.findMany({
          where: { facilityId: params.facilityId, direction: 'INBOUND', receivedAt: { gte, lt } },
          orderBy: { receivedAt: 'desc' },
          take: limit,
          select: { id: true, reference: true, amountMinor: true, method: true, receivedAt: true },
        }),
        client.payment.count({
          where: { facilityId: params.facilityId, direction: 'INBOUND', receivedAt: { gte, lt } },
        }),
      ]);

      return {
        totalCount,
        note: 'Each row is one payment. From a payment you can reach the invoice it settled, the charges on it, and the encounter that raised them.',
        rows: rows.map((row) => ({
          id: row.id,
          label: row.reference,
          detail: {
            amount: money(row.amountMinor),
            method: row.method,
            received: row.receivedAt.toISOString(),
          },
          href: `/api/v1/lineage/payment/${row.id}/upstream`,
        })),
      };
    },
  },

  {
    key: 'billed',
    sourceQueryId: 'dash/billed@v1',
    label: 'Invoiced',
    definition: 'Value of invoices issued in the period, excluding drafts and cancellations.',
    unit: 'NGN',
    classification: 'ACTUAL',
    reads: ['fin.invoice'],
    sections: ['finance', 'manager'],
    permission: 'billing.read',
    async compute(client, params) {
      const { gte, lt } = periodRange(params);
      const result = await client.invoice.aggregate({
        where: {
          facilityId: params.facilityId,
          issuedAt: { gte, lt },
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        _sum: { totalMinor: true },
        _count: { _all: true },
      });
      return { value: money(result._sum.totalMinor ?? 0n), sampleSize: result._count._all };
    },
    async rows(client, params, limit) {
      const { gte, lt } = periodRange(params);
      const where = {
        facilityId: params.facilityId,
        issuedAt: { gte, lt },
        status: { notIn: ['DRAFT' as const, 'CANCELLED' as const] },
      };
      const [rows, totalCount] = await Promise.all([
        client.invoice.findMany({
          where,
          orderBy: { issuedAt: 'desc' },
          take: limit,
          select: {
            id: true,
            reference: true,
            totalMinor: true,
            paidMinor: true,
            status: true,
            issuedAt: true,
          },
        }),
        client.invoice.count({ where }),
      ]);

      return {
        totalCount,
        note: 'Each row is one invoice, with what has been paid against it.',
        rows: rows.map((row) => ({
          id: row.id,
          label: row.reference,
          detail: {
            total: money(row.totalMinor),
            paid: money(row.paidMinor),
            outstanding: money(row.totalMinor - row.paidMinor),
            status: row.status,
            issued: row.issuedAt?.toISOString() ?? null,
          },
          href: `/api/v1/lineage/invoice/${row.id}/upstream`,
        })),
      };
    },
  },

  {
    key: 'outstanding',
    sourceQueryId: 'dash/outstanding@v1',
    label: 'Outstanding',
    definition:
      'Invoiced value not yet settled, across every open invoice regardless of when it was issued. ' +
      'Not restricted to the period: a debt from March is still a debt in September.',
    unit: 'NGN',
    classification: 'ACTUAL',
    reads: ['fin.invoice'],
    sections: ['finance', 'manager'],
    permission: 'billing.read',
    async compute(client, params) {
      const invoices = await client.invoice.findMany({
        where: { facilityId: params.facilityId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
        select: { totalMinor: true, paidMinor: true },
      });

      const outstanding = invoices.reduce(
        (sum, invoice) => sum + (invoice.totalMinor - invoice.paidMinor),
        0n,
      );

      return { value: money(outstanding), sampleSize: invoices.length };
    },
    async rows(client, params, limit) {
      const where = { facilityId: params.facilityId, status: { in: ['ISSUED' as const, 'PARTIALLY_PAID' as const] } };
      const [rows, totalCount] = await Promise.all([
        client.invoice.findMany({
          where,
          orderBy: { issuedAt: 'asc' },
          take: limit,
          select: { id: true, reference: true, totalMinor: true, paidMinor: true, issuedAt: true, dueDate: true },
        }),
        client.invoice.count({ where }),
      ]);

      return {
        totalCount,
        note: 'Oldest first. An invoice issued months ago and still unpaid is a different problem from one issued last week.',
        rows: rows.map((row) => ({
          id: row.id,
          label: row.reference,
          detail: {
            outstanding: money(row.totalMinor - row.paidMinor),
            issued: row.issuedAt?.toISOString() ?? null,
            due: row.dueDate?.toISOString().slice(0, 10) ?? null,
            daysOutstanding: row.issuedAt
              ? Math.floor((params.now.getTime() - row.issuedAt.getTime()) / 86_400_000)
              : null,
          },
          href: `/api/v1/lineage/invoice/${row.id}/upstream`,
        })),
      };
    },
  },

  {
    key: 'waived',
    sourceQueryId: 'dash/waived@v1',
    label: 'Waived',
    definition:
      'Charges waived in the period: care given and deliberately not billed. Every waiver carries a ' +
      'reason and the name of whoever decided it.',
    unit: 'NGN',
    classification: 'ACTUAL',
    reads: ['fin.charge'],
    sections: ['finance', 'manager', 'balance'],
    permission: 'billing.read',
    async compute(client, params) {
      const { gte, lt } = periodRange(params);
      const result = await client.charge.aggregate({
        where: { facilityId: params.facilityId, status: 'WAIVED', waivedAt: { gte, lt } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      });
      return { value: money(result._sum.amountMinor ?? 0n), sampleSize: result._count._all };
    },
    async rows(client, params, limit) {
      const { gte, lt } = periodRange(params);
      const where = { facilityId: params.facilityId, status: 'WAIVED' as const, waivedAt: { gte, lt } };
      const [rows, totalCount] = await Promise.all([
        client.charge.findMany({
          where,
          orderBy: { waivedAt: 'desc' },
          take: limit,
          select: {
            id: true,
            description: true,
            amountMinor: true,
            waiverReason: true,
            waivedBy: true,
            waivedAt: true,
            encounterId: true,
          },
        }),
        client.charge.count({ where }),
      ]);

      return {
        totalCount,
        note: 'Each waiver, with the reason given and the person who gave it.',
        rows: rows.map((row) => ({
          id: row.id,
          label: row.description,
          detail: {
            amount: money(row.amountMinor),
            reason: row.waiverReason,
            waivedBy: row.waivedBy,
            waivedAt: row.waivedAt?.toISOString() ?? null,
          },
          href: row.encounterId ? `/api/v1/lineage/encounter/${row.encounterId}/upstream` : null,
        })),
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Supply
  // ---------------------------------------------------------------------------
  {
    key: 'stock_out_items',
    sourceQueryId: 'dash/stock_out_items@v1',
    label: 'Items at zero',
    definition:
      'Active inventory items with no stock on hand in any batch, as at the moment of asking. ' +
      'Computed from the stock ledger cache, which the database maintains from every movement.',
    unit: 'items',
    classification: 'ACTUAL',
    reads: ['supply.inventory_item', 'supply.inventory_batch'],
    sections: ['supply', 'manager'],
    permission: 'inventory.read',
    async compute(client, params) {
      const items = await client.inventoryItem.findMany({
        where: { facilityId: params.facilityId, status: 'ACTIVE' },
        select: { id: true, batches: { where: { status: 'ACTIVE' }, select: { quantityOnHand: true } } },
      });

      const out = items.filter(
        (item) => item.batches.reduce((sum, batch) => sum + Number(batch.quantityOnHand), 0) <= 0,
      );

      return { value: out.length, sampleSize: items.length };
    },
    async rows(client, params, limit) {
      const items = await client.inventoryItem.findMany({
        where: { facilityId: params.facilityId, status: 'ACTIVE' },
        select: {
          id: true,
          code: true,
          name: true,
          unitOfMeasure: true,
          batches: { where: { status: 'ACTIVE' }, select: { quantityOnHand: true } },
        },
      });

      const out = items.filter(
        (item) => item.batches.reduce((sum, batch) => sum + Number(batch.quantityOnHand), 0) <= 0,
      );

      return {
        totalCount: out.length,
        note: 'Each row is an item with nothing on the shelf.',
        rows: out.slice(0, limit).map((item) => ({
          id: item.id,
          label: `${item.code} — ${item.name}`,
          detail: { unit: item.unitOfMeasure, onHand: 0, batches: item.batches.length },
          href: null,
        })),
      };
    },
  },

  {
    key: 'expiring_batches',
    sourceQueryId: 'dash/expiring_batches@v1',
    label: 'Batches expiring within 90 days',
    definition:
      'Active batches with stock on hand whose expiry date falls within ninety days of today. ' +
      'Computed from the expiry date on each read, so nothing goes stale between job runs.',
    unit: 'batches',
    classification: 'ACTUAL',
    reads: ['supply.inventory_batch'],
    sections: ['supply', 'manager'],
    permission: 'inventory.read',
    async compute(client, params) {
      const horizon = new Date(params.now.getTime() + 90 * 86_400_000);
      const count = await client.inventoryBatch.count({
        where: {
          facilityId: params.facilityId,
          status: 'ACTIVE',
          quantityOnHand: { gt: 0 },
          expiryDate: { not: null, lte: horizon },
        },
      });
      return { value: count, sampleSize: count };
    },
    async rows(client, params, limit) {
      const horizon = new Date(params.now.getTime() + 90 * 86_400_000);
      const where = {
        facilityId: params.facilityId,
        status: 'ACTIVE' as const,
        quantityOnHand: { gt: 0 },
        expiryDate: { not: null, lte: horizon },
      };
      const [rows, totalCount] = await Promise.all([
        client.inventoryBatch.findMany({
          where,
          orderBy: { expiryDate: 'asc' },
          take: limit,
          select: {
            id: true,
            batchNumber: true,
            expiryDate: true,
            quantityOnHand: true,
            unitCostMinor: true,
            inventoryItem: { select: { code: true, name: true } },
          },
        }),
        client.inventoryBatch.count({ where }),
      ]);

      return {
        totalCount,
        note: 'Soonest first, with the value at risk if nothing is done.',
        rows: rows.map((row) => ({
          id: row.id,
          label: `${row.inventoryItem.code} — batch ${row.batchNumber}`,
          detail: {
            expires: row.expiryDate?.toISOString().slice(0, 10) ?? null,
            onHand: Number(row.quantityOnHand),
            valueAtRisk: money(BigInt(Math.round(Number(row.quantityOnHand))) * row.unitCostMinor),
            daysToExpiry: row.expiryDate
              ? Math.ceil((row.expiryDate.getTime() - params.now.getTime()) / 86_400_000)
              : null,
          },
          href: null,
        })),
      };
    },
  },

  // ---------------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------------
  {
    key: 'staff_blocked',
    sourceQueryId: 'dash/staff_blocked@v1',
    label: 'Staff blocked from practice',
    definition:
      'Staff holding a credential that has expired or been suspended, and who may therefore not ' +
      'practise under it today. Derived from the expiry date at the moment of asking.',
    unit: 'people',
    classification: 'ACTUAL',
    reads: ['people.staff', 'people.staff_credential'],
    sections: ['people', 'manager', 'quality'],
    permission: 'hr.read',
    async compute(client, params) {
      const staff = await client.staff.findMany({
        where: { facilityId: params.facilityId, status: { not: 'EXITED' }, deletedAt: null },
        select: {
          id: true,
          credentials: { select: { status: true, expiresOn: true } },
        },
      });

      const blocked = staff.filter((person) =>
        person.credentials.some(
          (credential) =>
            credential.status === 'SUSPENDED' ||
            (credential.expiresOn !== null && credential.expiresOn <= params.now),
        ),
      );

      return { value: blocked.length, sampleSize: staff.length };
    },
    async rows(client, params, limit) {
      const staff = await client.staff.findMany({
        where: { facilityId: params.facilityId, status: { not: 'EXITED' }, deletedAt: null },
        select: {
          id: true,
          staffNumber: true,
          givenName: true,
          familyName: true,
          cadre: true,
          credentials: { select: { credentialType: true, status: true, expiresOn: true } },
        },
      });

      const blocked = staff
        .map((person) => ({
          person,
          offending: person.credentials.filter(
            (credential) =>
              credential.status === 'SUSPENDED' ||
              (credential.expiresOn !== null && credential.expiresOn <= params.now),
          ),
        }))
        .filter((entry) => entry.offending.length > 0);

      return {
        totalCount: blocked.length,
        note: 'Each row is a person who holds a credential that does not permit practice today.',
        rows: blocked.slice(0, limit).map(({ person, offending }) => ({
          id: person.id,
          label: `${person.givenName} ${person.familyName} (${person.staffNumber})`,
          detail: {
            cadre: person.cadre,
            credential: offending[0].credentialType,
            status: offending[0].status,
            expired: offending[0].expiresOn?.toISOString().slice(0, 10) ?? null,
          },
          href: `/api/v1/staff/${person.id}/credentials`,
        })),
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Quality
  // ---------------------------------------------------------------------------
  {
    key: 'incidents_open',
    sourceQueryId: 'dash/incidents_open@v1',
    label: 'Incidents open',
    definition: 'Incidents reported and not yet closed, whenever they occurred.',
    unit: 'incidents',
    classification: 'ACTUAL',
    reads: ['qual.incident'],
    sections: ['quality', 'manager'],
    permission: 'quality.read',
    async compute(client, params) {
      const count = await client.incident.count({
        where: { facilityId: params.facilityId, status: { not: 'CLOSED' } },
      });
      return { value: count, sampleSize: count };
    },
    async rows(client, params, limit) {
      const where = { facilityId: params.facilityId, status: { not: 'CLOSED' as const } };
      const [rows, totalCount] = await Promise.all([
        client.incident.findMany({
          where,
          orderBy: [{ severity: 'desc' }, { occurredAt: 'asc' }],
          take: limit,
          select: {
            id: true,
            reference: true,
            incidentType: true,
            severity: true,
            status: true,
            occurredAt: true,
            patientAffected: true,
          },
        }),
        client.incident.count({ where }),
      ]);

      return {
        totalCount,
        note: 'Most severe first, then oldest. The description is not included here: it often names people.',
        rows: rows.map((row) => ({
          id: row.id,
          label: row.reference,
          detail: {
            type: row.incidentType,
            severity: row.severity,
            status: row.status,
            occurred: row.occurredAt.toISOString(),
            patientAffected: row.patientAffected ? 'yes' : 'no',
          },
          href: null,
        })),
      };
    },
  },

  {
    key: 'actions_overdue',
    sourceQueryId: 'dash/actions_overdue@v1',
    label: 'Corrective actions overdue',
    definition:
      'Corrective actions past their due date and not completed. Overdue is computed from the date ' +
      'at the moment of asking, so the list is never stale.',
    unit: 'actions',
    classification: 'ACTUAL',
    reads: ['qual.corrective_action'],
    sections: ['quality', 'manager'],
    permission: 'quality.read',
    async compute(client, params) {
      const overdue = await client.correctiveAction.count({
        where: {
          facilityId: params.facilityId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          dueDate: { not: null, lt: params.now },
        },
      });
      const total = await client.correctiveAction.count({
        where: { facilityId: params.facilityId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      });
      return { value: overdue, sampleSize: total };
    },
    async rows(client, params, limit) {
      const where = {
        facilityId: params.facilityId,
        status: { notIn: ['COMPLETED' as const, 'CANCELLED' as const] },
        dueDate: { not: null, lt: params.now },
      };
      const [rows, totalCount] = await Promise.all([
        client.correctiveAction.findMany({
          where,
          orderBy: { dueDate: 'asc' },
          take: limit,
          select: { id: true, description: true, dueDate: true, ownerUserId: true, incidentId: true },
        }),
        client.correctiveAction.count({ where }),
      ]);

      return {
        totalCount,
        note: 'What was promised after an incident and has not happened.',
        rows: rows.map((row) => ({
          id: row.id,
          label: row.description,
          detail: {
            due: row.dueDate?.toISOString().slice(0, 10) ?? null,
            daysOverdue: row.dueDate
              ? Math.floor((params.now.getTime() - row.dueDate.getTime()) / 86_400_000)
              : null,
            owner: row.ownerUserId,
          },
          href: null,
        })),
      };
    },
  },

  {
    key: 'complaints_open',
    sourceQueryId: 'dash/complaints_open@v1',
    label: 'Complaints open',
    definition: 'Complaints received and not yet resolved or closed.',
    unit: 'complaints',
    classification: 'ACTUAL',
    reads: ['qual.complaint'],
    sections: ['quality', 'manager'],
    permission: 'quality.read',
    async compute(client, params) {
      const count = await client.complaint.count({
        where: { facilityId: params.facilityId, status: { notIn: ['RESOLVED', 'CLOSED'] } },
      });
      return { value: count, sampleSize: count };
    },
    async rows(client, params, limit) {
      const where = { facilityId: params.facilityId, status: { notIn: ['RESOLVED' as const, 'CLOSED' as const] } };
      const [rows, totalCount] = await Promise.all([
        client.complaint.findMany({
          where,
          orderBy: { receivedAt: 'asc' },
          take: limit,
          select: { id: true, reference: true, subject: true, receivedAt: true, status: true, isAnonymous: true },
        }),
        client.complaint.count({ where }),
      ]);

      return {
        totalCount,
        note: 'Oldest first. The complainant is not named here even where they gave their name.',
        rows: rows.map((row) => ({
          id: row.id,
          label: `${row.reference} — ${row.subject}`,
          detail: {
            received: row.receivedAt.toISOString(),
            status: row.status,
            daysOpen: Math.floor((params.now.getTime() - row.receivedAt.getTime()) / 86_400_000),
            anonymous: row.isAnonymous ? 'yes' : 'no',
          },
          href: null,
        })),
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Implementation
  // ---------------------------------------------------------------------------
  {
    key: 'capital_spent',
    sourceQueryId: 'dash/capital_spent@v1',
    label: 'Capital spent',
    definition:
      'Recorded expenditure against capital projects, whenever it was incurred. Read from project ' +
      'expense records, each of which names the payment behind it.',
    unit: 'NGN',
    classification: 'ACTUAL',
    reads: ['exec.project_expense'],
    sections: ['project', 'government'],
    permission: 'project.read',
    async compute(client, params) {
      const result = await client.projectExpense.aggregate({
        where: { facilityId: params.facilityId },
        _sum: { amountMinor: true },
        _count: { _all: true },
      });
      return { value: money(result._sum.amountMinor ?? 0n), sampleSize: result._count._all };
    },
    async rows(client, params, limit) {
      const where = { facilityId: params.facilityId };
      const [rows, totalCount] = await Promise.all([
        client.projectExpense.findMany({
          where,
          orderBy: { incurredOn: 'desc' },
          take: limit,
          select: {
            id: true,
            description: true,
            amountMinor: true,
            incurredOn: true,
            paymentId: true,
            project: { select: { id: true, reference: true, name: true } },
          },
        }),
        client.projectExpense.count({ where }),
      ]);

      return {
        totalCount,
        note: 'Each row is one expense against one project, and names the payment that settled it where there was one.',
        rows: rows.map((row) => ({
          id: row.id,
          label: `${row.project.reference} — ${row.description}`,
          detail: {
            amount: money(row.amountMinor),
            incurred: row.incurredOn.toISOString().slice(0, 10),
            project: row.project.name,
          },
          href: row.paymentId ? `/api/v1/lineage/payment/${row.paymentId}/upstream` : null,
        })),
      };
    },
  },

  {
    key: 'assets_not_commissioned',
    sourceQueryId: 'dash/assets_not_commissioned@v1',
    label: 'Assets received but not commissioned',
    definition:
      'Equipment received into the facility with no commissioning record. This is the gap between ' +
      'money spent and a service a patient can actually receive, and it is the question a government ' +
      'reviewer asks first.',
    unit: 'assets',
    classification: 'ACTUAL',
    reads: ['exec.equipment_asset', 'exec.commissioning_record'],
    sections: ['project', 'government', 'manager'],
    permission: 'asset.read',
    async compute(client, params) {
      const assets = await client.equipmentAsset.findMany({
        where: { facilityId: params.facilityId },
        select: { id: true, commissioning: { select: { id: true } } },
      });

      const uncommissioned = assets.filter((asset) => asset.commissioning.length === 0);
      return { value: uncommissioned.length, sampleSize: assets.length };
    },
    async rows(client, params, limit) {
      const assets = await client.equipmentAsset.findMany({
        where: { facilityId: params.facilityId },
        select: {
          id: true,
          assetTag: true,
          name: true,
          commissioningStatus: true,
          costMinor: true,
          commissioning: { select: { id: true } },
        },
      });

      const uncommissioned = assets.filter((asset) => asset.commissioning.length === 0);

      return {
        totalCount: uncommissioned.length,
        note: 'Equipment in the building that no service depends on yet.',
        rows: uncommissioned.slice(0, limit).map((asset) => ({
          id: asset.id,
          label: `${asset.assetTag} — ${asset.name}`,
          detail: {
            status: asset.commissioningStatus,
            cost: asset.costMinor === null ? null : money(asset.costMinor),
          },
          href: `/api/v1/lineage/asset/${asset.id}/upstream`,
        })),
      };
    },
  },

  {
    key: 'baseline_sealed_at',
    sourceQueryId: 'dash/baseline_sealed_at@v1',
    label: 'Days since Day 0',
    definition:
      'Days since the baseline snapshot was sealed. Everything on this page is measured against a ' +
      'starting point taken on that date and never since altered.',
    unit: 'days',
    classification: 'ACTUAL',
    reads: ['assess.baseline_snapshot'],
    sections: ['government', 'manager'],
    permission: 'kpi.read',
    noDrillDownReason:
      'This is a single sealed snapshot, not an aggregate. Its own contents are reached through the ' +
      'baseline endpoint rather than by drilling into a total.',
    async compute(client, params) {
      const snapshot = await client.baselineSnapshot.findFirst({
        where: { facilityId: params.facilityId },
        orderBy: { sequence: 'asc' },
        select: { sealedAt: true },
      });

      if (!snapshot) {
        return {
          value: null,
          sampleSize: 0,
          note: 'No baseline has been sealed for this facility, so there is no Day 0 to measure from.',
        };
      }

      return {
        value: Math.floor((params.now.getTime() - snapshot.sealedAt.getTime()) / 86_400_000),
        sampleSize: 1,
      };
    },
  },
];

export const DASHBOARD_FIGURES: ReadonlyMap<string, DashboardFigureQuery> = new Map(
  QUERIES.map((query) => [query.key, query]),
);

export function figuresForSection(section: string): DashboardFigureQuery[] {
  return QUERIES.filter((query) => query.sections.includes(section));
}

export function listDashboardFigures() {
  return QUERIES.map(
    ({ key, sourceQueryId, label, definition, unit, classification, reads, sections, permission }) => ({
      key,
      sourceQueryId,
      label,
      definition,
      unit,
      classification,
      reads,
      sections,
      permission,
    }),
  );
}
