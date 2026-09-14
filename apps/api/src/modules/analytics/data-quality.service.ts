import { Injectable, NotFoundException } from '@nestjs/common';
import type { DataQualityIssue, SearchQuery } from '@chc/contracts';

import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigService } from '../config/config.service';

import { qualityBand, scoreDataQuality, type DimensionInput } from './domain/data-quality';

/**
 * The data quality engine (spec §47) and global search (spec §60).
 *
 * Both are here because both are about finding things: one finds the records
 * that are wrong, the other finds the record you are looking for.
 *
 * Every data quality check counts something specific and gives a way to reach
 * the offending rows. A score with no list of what to fix is a number that
 * makes people feel bad and changes nothing.
 */
@Injectable()
export class DataQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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

  async assess(facilityId: string, periodStart: string, periodEnd: string) {
    this.assertFacilityVisible(facilityId);

    const from = startOfDay(new Date(periodStart));
    const to = endOfDay(new Date(periodEnd));
    const now = this.now();

    const weights = await this.config.json<Record<string, number>>('dataQuality.weights', {
      COMPLETENESS: 1,
      DUPLICATES: 1,
      VALIDITY: 1,
      RECONCILIATION: 1.5,
      TIMELINESS: 0.5,
    });

    const inputs: DimensionInput[] = [
      await this.completeness(facilityId, from, to, weights.COMPLETENESS ?? 1),
      await this.duplicates(facilityId, weights.DUPLICATES ?? 1),
      await this.validity(facilityId, from, to, weights.VALIDITY ?? 1),
      await this.reconciliation(facilityId, weights.RECONCILIATION ?? 1.5),
      await this.timeliness(facilityId, from, to, now, weights.TIMELINESS ?? 0.5),
    ];

    const result = scoreDataQuality(inputs);

    return {
      facilityId,
      periodStart,
      periodEnd,
      computedAt: now.toISOString(),
      classification: 'ACTUAL' as const,
      overallScore: result.overallScore,
      band: qualityBand(result.overallScore),
      dimensions: result.dimensions,
      unmeasured: result.unmeasured,
      recordsAssessed: result.recordsAssessed,
      issues: result.issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
      explanation: result.explanation,
      weights,
    };
  }

  // ---------------------------------------------------------------------------
  // The dimensions
  // ---------------------------------------------------------------------------

  /** Closed encounters carrying a diagnosis or a stated reason for having none. */
  private async completeness(
    facilityId: string,
    from: Date,
    to: Date,
    weight: number,
  ): Promise<DimensionInput> {
    const encounters = await this.prisma.encounter.findMany({
      where: { facilityId, startedAt: { gte: from, lt: to }, status: 'CLOSED' },
      select: { id: true, noDiagnosisReason: true, _count: { select: { diagnoses: true } } },
    });

    const undocumented = encounters.filter(
      (encounter) => encounter._count.diagnoses === 0 && !encounter.noDiagnosisReason,
    );

    const issues: DataQualityIssue[] = [];
    if (undocumented.length > 0) {
      issues.push({
        dimension: 'COMPLETENESS',
        code: 'encounter-no-diagnosis',
        description:
          `${undocumented.length} encounter(s) were closed with neither a diagnosis nor a recorded ` +
          'reason for having none. Nothing is known about what was wrong with those patients.',
        affectedCount: undocumented.length,
        outOf: encounters.length,
        severity: undocumented.length / Math.max(encounters.length, 1) > 0.1 ? 'HIGH' : 'MEDIUM',
        href: `/api/v1/analytics/drill-down?figure=undocumented_encounters&facilityId=${facilityId}`,
      });
    }

    return {
      dimension: 'COMPLETENESS',
      good: encounters.length - undocumented.length,
      outOf: encounters.length,
      weight,
      issues,
    };
  }

  /** Patients flagged as possible duplicates and not yet resolved. */
  private async duplicates(facilityId: string, weight: number): Promise<DimensionInput> {
    const [patients, unresolved] = await Promise.all([
      this.prisma.patient.count({ where: { facilityId, deletedAt: null } }),
      // Unreviewed: nobody has yet decided whether these are the same person.
      this.prisma.duplicateCandidate.count({ where: { facilityId, reviewedAt: null } }),
    ]);

    const issues: DataQualityIssue[] = [];
    if (unresolved > 0) {
      issues.push({
        dimension: 'DUPLICATES',
        code: 'unresolved-duplicate-candidates',
        description:
          `${unresolved} pair(s) of patient records look like the same person and nobody has decided. ` +
          'Until somebody does, that person has two histories and neither is complete.',
        affectedCount: unresolved,
        outOf: patients,
        severity: 'HIGH',
        href: '/api/v1/patients/duplicates',
      });
    }

    // Each unresolved candidate implicates two records.
    return {
      dimension: 'DUPLICATES',
      good: Math.max(patients - unresolved * 2, 0),
      outOf: patients,
      weight,
      issues,
    };
  }

  /** Values a record should not be able to hold. */
  private async validity(
    facilityId: string,
    from: Date,
    to: Date,
    weight: number,
  ): Promise<DimensionInput> {
    const issues: DataQualityIssue[] = [];

    const [triages, impossibleVitals, futureBirths, patients] = await Promise.all([
      this.prisma.triage.count({ where: { facilityId, recordedAt: { gte: from, lt: to } } }),
      this.prisma.triage.count({
        where: {
          facilityId,
          recordedAt: { gte: from, lt: to },
          OR: [
            { temperatureC: { lt: 25 } },
            { temperatureC: { gt: 45 } },
            { pulse: { lt: 20 } },
            { pulse: { gt: 250 } },
          ],
        },
      }),
      this.prisma.patient.count({ where: { facilityId, deletedAt: null, dateOfBirth: { gt: this.now() } } }),
      this.prisma.patient.count({ where: { facilityId, deletedAt: null } }),
    ]);

    if (impossibleVitals > 0) {
      issues.push({
        dimension: 'VALIDITY',
        code: 'impossible-vitals',
        description:
          `${impossibleVitals} set(s) of observations record a temperature or pulse outside anything ` +
          'survivable. These are almost certainly typing errors, and they are in the clinical record.',
        affectedCount: impossibleVitals,
        outOf: triages,
        severity: 'HIGH',
        href: null,
      });
    }

    if (futureBirths > 0) {
      issues.push({
        dimension: 'VALIDITY',
        code: 'birth-date-in-future',
        description: `${futureBirths} patient(s) have a date of birth in the future.`,
        affectedCount: futureBirths,
        outOf: patients,
        severity: 'MEDIUM',
        href: null,
      });
    }

    const assessed = triages + patients;
    return {
      dimension: 'VALIDITY',
      good: assessed - impossibleVitals - futureBirths,
      outOf: assessed,
      weight,
      issues,
    };
  }

  /**
   * Whether the stock cache still agrees with the ledger that maintains it.
   *
   * The one deliberate derived column in the schema (doc 14 §2). If it drifts
   * from the transactions, the ledger is right and the cache is wrong — and
   * the only way anybody finds out is a check like this one.
   */
  private async reconciliation(facilityId: string, weight: number): Promise<DimensionInput> {
    const batches = await this.prisma.inventoryBatch.findMany({
      where: { facilityId },
      select: {
        id: true,
        batchNumber: true,
        quantityOnHand: true,
        inventoryItem: { select: { code: true, name: true } },
        transactions: { select: { quantity: true } },
      },
    });

    const drifted = batches.filter((batch) => {
      const fromLedger = batch.transactions.reduce(
        (sum, transaction) => sum + Number(transaction.quantity),
        0,
      );
      return Math.abs(fromLedger - Number(batch.quantityOnHand)) > 0.001;
    });

    const issues: DataQualityIssue[] = [];
    if (drifted.length > 0) {
      issues.push({
        dimension: 'RECONCILIATION',
        code: 'stock-cache-drift',
        description:
          `${drifted.length} batch(es) hold a quantity that disagrees with the sum of their own stock ` +
          'movements. The ledger is authoritative; the cached quantity is wrong and must be corrected ' +
          `from it. First: ${drifted[0].inventoryItem.code} batch ${drifted[0].batchNumber}.`,
        affectedCount: drifted.length,
        outOf: batches.length,
        severity: 'HIGH',
        href: null,
      });
    }

    return {
      dimension: 'RECONCILIATION',
      good: batches.length - drifted.length,
      outOf: batches.length,
      weight,
      issues,
    };
  }

  /** Records entered long after the event they describe. */
  private async timeliness(
    facilityId: string,
    from: Date,
    to: Date,
    now: Date,
    weight: number,
  ): Promise<DimensionInput> {
    const encounters = await this.prisma.encounter.findMany({
      where: { facilityId, startedAt: { gte: from, lt: to } },
      select: { id: true, startedAt: true, createdAt: true, enteredRetrospectively: true },
    });

    const lateThresholdHours = await this.config.number('dataQuality.lateEntryHours', 24, facilityId);

    // A record marked retrospective is not late; it is honest about being
    // written up afterwards. What counts here is a record written up late
    // without saying so.
    const late = encounters.filter(
      (encounter) =>
        !encounter.enteredRetrospectively &&
        encounter.createdAt.getTime() - encounter.startedAt.getTime() >
          lateThresholdHours * 3_600_000,
    );

    const issues: DataQualityIssue[] = [];
    if (late.length > 0) {
      issues.push({
        dimension: 'TIMELINESS',
        code: 'late-entry-not-declared',
        description:
          `${late.length} encounter(s) were entered more than ${lateThresholdHours} hours after the ` +
          'care they describe, without being marked as written up retrospectively. A record written ' +
          'from memory days later should say so on its face.',
        affectedCount: late.length,
        outOf: encounters.length,
        severity: 'MEDIUM',
        href: null,
      });
    }

    void now;

    return {
      dimension: 'TIMELINESS',
      good: encounters.length - late.length,
      outOf: encounters.length,
      weight,
      issues,
    };
  }

  // ---------------------------------------------------------------------------
  // Global search (spec §60)
  // ---------------------------------------------------------------------------

  /**
   * One box, several kinds of record.
   *
   * Every result is filtered by the caller's tenant scope and by the permission
   * that governs its kind. A patient the caller may not read does not appear as
   * a locked row; it does not appear.
   */
  async search(query: SearchQuery) {
    const { facilityIds } = getTenantScope();
    const permissions = tryGetContext()?.permissions ?? new Set();

    const scope = query.facilityId ? [query.facilityId] : [...facilityIds];
    if (query.facilityId) this.assertFacilityVisible(query.facilityId);

    const term = query.q.trim();
    const contains = { contains: term, mode: 'insensitive' as const };

    const groups: Array<{
      kind: string;
      permission: string;
      results: Array<{ id: string; label: string; detail: string; href: string }>;
    }> = [];

    if (permissions.has('patient.read')) {
      const identified = permissions.has('patient.read_identified');

      const patients = await this.prisma.patient.findMany({
        where: {
          facilityId: { in: scope },
          deletedAt: null,
          OR: [{ mrn: contains }, { givenName: contains }, { familyName: contains }],
        },
        take: query.limit,
        select: { id: true, mrn: true, givenName: true, familyName: true, dateOfBirth: true },
      });

      groups.push({
        kind: 'patient',
        permission: 'patient.read',
        results: patients.map((patient) => ({
          id: patient.id,
          // A search result is a disclosure. Without the identity permission
          // the caller gets the record number and nothing that names a person.
          label: identified ? `${patient.givenName} ${patient.familyName}` : patient.mrn,
          detail: identified
            ? `${patient.mrn}${patient.dateOfBirth ? ` · born ${patient.dateOfBirth.toISOString().slice(0, 10)}` : ''}`
            : 'Name withheld: requires patient.read_identified.',
          href: `/api/v1/patients/${patient.id}`,
        })),
      });
    }

    if (permissions.has('hr.read')) {
      const staff = await this.prisma.staff.findMany({
        where: {
          facilityId: { in: scope },
          deletedAt: null,
          OR: [{ staffNumber: contains }, { givenName: contains }, { familyName: contains }],
        },
        take: query.limit,
        select: { id: true, staffNumber: true, givenName: true, familyName: true, cadre: true },
      });

      groups.push({
        kind: 'staff',
        permission: 'hr.read',
        results: staff.map((person) => ({
          id: person.id,
          label: `${person.givenName} ${person.familyName}`,
          detail: `${person.staffNumber} · ${person.cadre}`,
          href: `/api/v1/staff/${person.id}/credentials`,
        })),
      });
    }

    if (permissions.has('inventory.read')) {
      const items = await this.prisma.inventoryItem.findMany({
        where: { facilityId: { in: scope }, OR: [{ code: contains }, { name: contains }] },
        take: query.limit,
        select: { id: true, code: true, name: true, unitOfMeasure: true },
      });

      groups.push({
        kind: 'inventory_item',
        permission: 'inventory.read',
        results: items.map((item) => ({
          id: item.id,
          label: item.name,
          detail: `${item.code} · ${item.unitOfMeasure}`,
          href: `/api/v1/inventory/items/${item.id}`,
        })),
      });
    }

    if (permissions.has('asset.read')) {
      const assets = await this.prisma.equipmentAsset.findMany({
        where: {
          facilityId: { in: scope },
          deletedAt: null,
          OR: [{ assetTag: contains }, { name: contains }, { serialNumber: contains }],
        },
        take: query.limit,
        select: { id: true, assetTag: true, name: true, commissioningStatus: true },
      });

      groups.push({
        kind: 'asset',
        permission: 'asset.read',
        results: assets.map((asset) => ({
          id: asset.id,
          label: asset.name,
          detail: `${asset.assetTag} · ${asset.commissioningStatus}`,
          href: `/api/v1/lineage/asset/${asset.id}/upstream`,
        })),
      });
    }

    if (permissions.has('billing.read')) {
      const invoices = await this.prisma.invoice.findMany({
        where: { facilityId: { in: scope }, reference: contains },
        take: query.limit,
        select: { id: true, reference: true, totalMinor: true, status: true },
      });

      groups.push({
        kind: 'invoice',
        permission: 'billing.read',
        results: invoices.map((invoice) => ({
          id: invoice.id,
          label: invoice.reference,
          detail: `NGN ${(Number(invoice.totalMinor) / 100).toFixed(2)} · ${invoice.status}`,
          href: `/api/v1/lineage/invoice/${invoice.id}/upstream`,
        })),
      });
    }

    const total = groups.reduce((sum, group) => sum + group.results.length, 0);

    return {
      query: term,
      total,
      groups: groups.filter((group) => group.results.length > 0),
      // Said rather than implied: a caller who searches and finds nothing
      // should know whether that means "no such record" or "not your access".
      note:
        `Searched ${groups.length} kind(s) of record that your permissions reach. ` +
        'Kinds you do not hold a permission for were not searched at all, so an empty result here does ' +
        'not mean the record does not exist.',
      searchedKinds: groups.map((group) => group.kind),
    };
  }
}

function severityRank(severity: 'LOW' | 'MEDIUM' | 'HIGH'): number {
  return severity === 'HIGH' ? 3 : severity === 'MEDIUM' ? 2 : 1;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = startOfDay(date);
  copy.setUTCDate(copy.getUTCDate() + 1);
  return copy;
}
