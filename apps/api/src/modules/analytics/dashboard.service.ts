import { Injectable, NotFoundException } from '@nestjs/common';
import {
  dashboardSchema,
  type DashboardQuery,
  type DrillDownQuery,
  type Figure,
  type Permission,
} from '@chc/contracts';

import type { MetricQueryParams } from '../../common/metric-query';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';

import {
  DASHBOARD_FIGURES,
  figuresForSection,
  listDashboardFigures,
  type DashboardFigureQuery,
} from './dashboard-queries';
import { assessBalance } from './domain/project-health';

/**
 * Role-specific dashboards (spec §§36-37, 42, 71; criterion M).
 *
 * Two properties hold for everything this service returns.
 *
 * **Nothing is a bare number.** Every figure carries its classification, the
 * moment it was computed, its denominator, the named query that produced it and
 * the tables that query read. This is not enforced by review: the whole payload
 * is parsed through `dashboardSchema` on the way out, and a figure missing any
 * of it fails the request rather than rendering.
 *
 * **Every figure is clickable down to its rows,** or says in words why it is
 * not. The contract schema refuses a figure that does neither, so there is no
 * quiet third option where a number simply sits there.
 *
 * Sections are chosen by the caller's permissions rather than by a role name.
 * A government observer sees the aggregate section and no clinical one — not
 * a greyed-out tab, an absent one.
 */

/**
 * The permission needed to open a section at all.
 *
 * A figure carries its own permission on top of this, so a reader who can open
 * the manager's overview still sees only the figures they are entitled to.
 * A section left with no visible figures is dropped rather than shown empty.
 */
const SECTION_PERMISSION: Record<string, Permission> = {
  clinical: 'clinical.read',
  finance: 'finance.read',
  supply: 'inventory.read',
  people: 'hr.read',
  quality: 'quality.read',
  project: 'project.read',
  government: 'kpi.read',
  manager: 'analytics.read',
  balance: 'analytics.read',
};

const SECTION_TITLE: Record<string, { title: string; subtitle: string }> = {
  manager: {
    title: 'The facility today',
    subtitle: 'What a person walking in this morning needs to know first.',
  },
  clinical: { title: 'Care', subtitle: 'What was done, and what is unfinished.' },
  finance: { title: 'Money', subtitle: 'Collected, owed and given away, each from the ledger.' },
  supply: { title: 'Supplies', subtitle: 'What has run out and what is about to expire.' },
  people: { title: 'People', subtitle: 'Who is here and who may lawfully work.' },
  quality: { title: 'Safety and complaints', subtitle: 'What went wrong and what was done about it.' },
  project: { title: 'Implementation', subtitle: 'What the money bought and whether it is in use.' },
  government: {
    title: 'Public value',
    subtitle: 'Aggregate only. No patient is identifiable from this section.',
  },
  balance: {
    title: 'Care against money',
    subtitle: 'Whether the pursuit of revenue is crowding out care — and what these figures cannot tell you.',
  },
};

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

  private held(): ReadonlySet<Permission> {
    return tryGetContext()?.permissions ?? new Set<Permission>();
  }

  /** The figure catalogue itself, so a reader can audit what is measurable. */
  catalogue() {
    return {
      note:
        'Every number on every dashboard comes from one of these queries. There is no path by which a ' +
        'figure can be typed in.',
      figures: listDashboardFigures(),
    };
  }

  async build(query: DashboardQuery) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(query.facilityId);

    const facility = await this.prisma.facility.findFirst({
      where: { id: query.facilityId },
      select: { id: true, name: true, code: true },
    });

    if (!facility) throw new NotFoundException('No such facility.');

    const permissions = this.held();
    const now = this.now();

    const params: MetricQueryParams = {
      organisationId,
      facilityId: query.facilityId,
      periodStart: new Date(query.periodStart),
      periodEnd: new Date(query.periodEnd),
      now,
    };

    const visibleSections = Object.keys(SECTION_TITLE).filter((section) =>
      permissions.has(SECTION_PERMISSION[section]),
    );

    const sections = [];
    const caveats: string[] = [];

    for (const section of visibleSections) {
      const queries = figuresForSection(section);
      if (queries.length === 0) continue;

      const permitted = queries.filter((figureQuery) =>
        permissions.has(figureQuery.permission as Permission),
      );

      // Not rendered empty, and not rendered with a lock: a section whose
      // every figure is beyond the reader simply is not part of their page.
      if (permitted.length === 0) continue;

      const figures: Figure[] = [];
      for (const figureQuery of permitted) {
        figures.push(await this.computeFigure(figureQuery, params, query));
      }

      sections.push({
        title: SECTION_TITLE[section].title,
        subtitle: SECTION_TITLE[section].subtitle,
        figures,
      });
    }

    // The balance section is not a set of counts; it is an argument about them,
    // and it carries its own limits.
    if (permissions.has('analytics.read')) {
      const balance = await this.balance(params);
      caveats.push(...balance.limits);
      if (balance.concerns.length > 0) caveats.push(...balance.concerns);
    }

    if (sections.length === 0) {
      caveats.push(
        'You hold no permission that reaches any section of this dashboard. Nothing has been withheld ' +
          'quietly: there is nothing here for your access.',
      );
      // A dashboard with no sections would fail the schema, which requires at
      // least one. Saying so explicitly is better than an empty page.
      sections.push({
        title: 'Nothing available',
        subtitle: 'No section of this dashboard is within your access.',
        figures: [],
      });
    }

    const payload = {
      role: (tryGetContext()?.roleCodes ?? []).join(', ') || 'unknown',
      facilityId: facility.id,
      facilityName: facility.name,
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      generatedAt: now.toISOString(),
      sections,
      caveats,
    };

    // The guarantee, made mechanical. A figure without a classification, a
    // computation time, a named query or a way down to its rows fails here
    // rather than reaching a screen where somebody would believe it.
    return dashboardSchema.parse(payload);
  }

  /**
   * The rows behind one figure (spec §71).
   *
   * Permission is re-evaluated here, not inherited from the dashboard request:
   * a caller who can see a total is not thereby entitled to the records in it.
   */
  async drillDown(query: DrillDownQuery) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(query.facilityId);

    const figureQuery = DASHBOARD_FIGURES.get(query.figure);
    if (!figureQuery) {
      throw new NotFoundException(
        `No figure "${query.figure}". The catalogue at /analytics/figures lists every one that exists.`,
      );
    }

    // Checked again here against the figure's own permission. A caller who can
    // see a total on a page is not thereby entitled to the records inside it,
    // and this endpoint is reachable directly.
    if (!this.held().has(figureQuery.permission as Permission)) {
      throw new NotFoundException('No such figure, or it is not visible to you.');
    }

    if (!figureQuery.rows) {
      throw new NotFoundException(
        `"${figureQuery.label}" has no rows beneath it. ${figureQuery.noDrillDownReason ?? ''}`.trim(),
      );
    }

    const now = this.now();
    const params: MetricQueryParams = {
      organisationId,
      facilityId: query.facilityId,
      periodStart: new Date(query.periodStart),
      periodEnd: new Date(query.periodEnd),
      now,
    };

    const result = await figureQuery.rows(this.prisma, params, query.limit);

    await this.audit.record({
      action: 'analytics.drill_down',
      entityType: 'figure',
      entityId: figureQuery.key,
      facilityId: query.facilityId,
      newValue: { figure: figureQuery.key, returned: result.rows.length, of: result.totalCount },
    });

    return {
      figure: figureQuery.key,
      label: figureQuery.label,
      definition: figureQuery.definition,
      sourceQueryId: figureQuery.sourceQueryId,
      reads: figureQuery.reads,
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      computedAt: now.toISOString(),
      totalCount: result.totalCount,
      returned: result.rows.length,
      // Said plainly. A reader who sees 100 rows under a figure of 412 and is
      // not told so will believe the figure is wrong.
      truncated: result.totalCount > result.rows.length,
      note: result.note,
      rows: result.rows,
    };
  }

  /**
   * The daily trend, read from the materialised rollup (doc 22 §1).
   *
   * The one cached figure in the system, and it travels with the moment it was
   * last rebuilt. A dashboard that shows a stale number as though it were
   * current is worse than one that takes a second longer to load, so `stale`
   * is computed here and said out loud rather than left to the reader.
   */
  async trend(facilityId: string, periodStart: string, periodEnd: string) {
    this.assertFacilityVisible(facilityId);

    const maxAgeMinutes = await this.config.number('analytics.maxCacheAgeMinutes', 60, facilityId);

    // Read inside a tenant-scoped transaction: the barrier view filters on the
    // same settings the RLS policies read, and returns nothing without them.
    const { rows, refresh } = await this.prisma.withTenantScope(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          business_date: Date;
          collected_minor: bigint;
          invoiced_minor: bigint;
          charged_minor: bigint;
          waived_minor: bigint;
          encounters: bigint;
        }>
      >`
        SELECT business_date, collected_minor, invoiced_minor, charged_minor, waived_minor, encounters
          FROM analytics.daily_financial
         WHERE facility_id = ${facilityId}::uuid
           AND business_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
         ORDER BY business_date
      `;

      const refresh = await tx.$queryRaw<Array<{ refreshed_at: Date; row_count: bigint }>>`
        SELECT refreshed_at, row_count FROM analytics.view_refresh WHERE view_name = 'mv_daily_financial'
      `;

      return { rows, refresh };
    });

    const refreshedAt = refresh[0]?.refreshed_at ?? null;
    const ageMinutes =
      refreshedAt === null ? null : Math.floor((this.now().getTime() - refreshedAt.getTime()) / 60_000);

    return {
      facilityId,
      periodStart,
      periodEnd,
      source: 'analytics.mv_daily_financial',
      classification: 'ACTUAL' as const,
      refreshedAt: refreshedAt?.toISOString() ?? null,
      cacheAgeMinutes: ageMinutes,
      stale: ageMinutes === null || ageMinutes > maxAgeMinutes,
      staleNote:
        ageMinutes === null
          ? 'This rollup has never been rebuilt, so nothing here can be relied upon.'
          : ageMinutes > maxAgeMinutes
            ? `Rebuilt ${ageMinutes} minutes ago, beyond the ${maxAgeMinutes}-minute limit. Anything recorded ` +
              'since is not in these figures. Refresh before quoting them.'
            : undefined,
      provenance:
        'These are cached daily totals, rebuilt from fin.payment, fin.invoice, fin.charge and ' +
        'clinical.encounter. Nothing writes to the cache; it can only ever hold what those tables ' +
        'produce, and analytics.reconcile_daily_financial() checks that it does.',
      days: rows.map((row) => ({
        date: row.business_date.toISOString().slice(0, 10),
        collected: Number(row.collected_minor) / 100,
        invoiced: Number(row.invoiced_minor) / 100,
        charged: Number(row.charged_minor) / 100,
        waived: Number(row.waived_minor) / 100,
        encounters: Number(row.encounters),
      })),
    };
  }

  /** Rebuild the rollup, and say how long it took and what it now holds. */
  async refresh() {
    const started = this.now();

    await this.prisma.$executeRaw`SELECT analytics.refresh_views(true)`;

    const refresh = await this.prisma.$queryRaw<
      Array<{ refreshed_at: Date; duration_ms: number; row_count: bigint }>
    >`SELECT refreshed_at, duration_ms, row_count FROM analytics.view_refresh WHERE view_name = 'mv_daily_financial'`;

    // Checked immediately, not on somebody's promise that a refresh is always
    // correct. A disagreement here means the cache and the ledger differ, and
    // the ledger is right.
    const drift = await this.prisma.$queryRaw<
      Array<{ facility_id: string; business_date: Date; field: string; cached: bigint; recomputed: bigint }>
    >`SELECT * FROM analytics.reconcile_daily_financial()`;

    await this.audit.record({
      action: 'analytics.refresh',
      entityType: 'materialised_view',
      entityId: 'mv_daily_financial',
      newValue: { rows: Number(refresh[0]?.row_count ?? 0), disagreements: drift.length },
      severity: drift.length > 0 ? 'WARNING' : 'INFO',
    });

    return {
      view: 'mv_daily_financial',
      refreshedAt: refresh[0]?.refreshed_at?.toISOString() ?? started.toISOString(),
      durationMs: refresh[0]?.duration_ms ?? null,
      rowCount: Number(refresh[0]?.row_count ?? 0),
      reconciled: drift.length === 0,
      disagreements: drift.map((row) => ({
        facilityId: row.facility_id,
        date: row.business_date.toISOString().slice(0, 10),
        field: row.field,
        cached: Number(row.cached),
        recomputed: Number(row.recomputed),
      })),
      note:
        drift.length === 0
          ? 'The cache agrees with the base tables on every day it holds.'
          : `${drift.length} disagreement(s) between the cache and the base tables. The base tables are ` +
            'correct. Do not quote the trend until this is resolved.',
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async computeFigure(
    figureQuery: DashboardFigureQuery,
    params: MetricQueryParams,
    query: DashboardQuery,
  ): Promise<Figure> {
    const outcome = await figureQuery.compute(this.prisma, params);

    const threshold = await this.config.number('analytics.smallCellThreshold', 5, params.facilityId);

    // A count of people is not a small cell; a rate over people is. Only the
    // rate-like figures are withheld, and the rule says which.
    const suppressed =
      outcome.value !== null &&
      outcome.sampleSize !== null &&
      outcome.sampleSize > 0 &&
      outcome.sampleSize < threshold &&
      figureQuery.unit === '%';

    const drillDown =
      figureQuery.rows !== undefined
        ? {
            href:
              `/api/v1/analytics/drill-down?facilityId=${params.facilityId}` +
              `&figure=${figureQuery.key}&periodStart=${query.periodStart}&periodEnd=${query.periodEnd}`,
            level: 'TRANSACTION' as const,
            label: `The records behind ${figureQuery.label.toLowerCase()}`,
          }
        : null;

    return {
      key: figureQuery.key,
      label: figureQuery.label,
      value: suppressed ? null : outcome.value,
      unit: figureQuery.unit ?? undefined,
      classification: outcome.classification ?? figureQuery.classification,
      computedAt: params.now.toISOString(),
      sourceQueryId: figureQuery.sourceQueryId,
      sourceRef: figureQuery.sourceQueryId,
      definition: figureQuery.definition,
      reads: [...figureQuery.reads],
      sampleSize: outcome.sampleSize ?? undefined,
      suppressed: suppressed || undefined,
      suppressionReason: suppressed
        ? `Withheld: fewer than ${threshold} observations. A rate over so few people can identify them.`
        : undefined,
      weakenedBy: outcome.weakenedBy,
      drillDown,
      noDrillDownReason: drillDown === null ? (figureQuery.noDrillDownReason ?? null) : null,
    };
  }

  /** The clinical-versus-financial balance (spec §42). */
  private async balance(params: MetricQueryParams) {
    const encounters = await DASHBOARD_FIGURES.get('encounters')!.compute(this.prisma, params);
    const revenue = await DASHBOARD_FIGURES.get('revenue_collected')!.compute(this.prisma, params);
    const waived = await DASHBOARD_FIGURES.get('waived')!.compute(this.prisma, params);

    const consent = await this.consentRate(params);

    return assessBalance({
      encounters: encounters.value ?? 0,
      revenueMinor: Math.round((revenue.value ?? 0) * 100),
      waivedMinor: Math.round((waived.value ?? 0) * 100),
      // Not recorded anywhere in this system yet, and reported as such rather
      // than shown as nought. See the engine's own note.
      refusedForPaymentCount: null,
      consentRate: consent,
      incidentRate: null,
    });
  }

  private async consentRate(params: MetricQueryParams): Promise<number | null> {
    const encounters = await this.prisma.encounter.findMany({
      where: {
        facilityId: params.facilityId,
        startedAt: { gte: params.periodStart, lte: params.periodEnd },
        status: { not: 'CANCELLED' },
      },
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

    if (encounters.length === 0) return null;

    const covered = encounters.filter((encounter) =>
      encounter.patient.consents.some(
        (consent) =>
          consent.grantedAt <= encounter.startedAt &&
          (consent.withdrawnAt === null || consent.withdrawnAt > encounter.startedAt),
      ),
    );

    return Math.round((covered.length / encounters.length) * 10_000) / 10_000;
  }
}
