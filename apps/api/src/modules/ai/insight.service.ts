import { Injectable, NotFoundException } from '@nestjs/common';
import type { AiForecast, Permission } from '@chc/contracts';

import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigService } from '../config/config.service';

import { detectConcentration, detectOutliers, type Observation } from './domain/anomaly';
import { forecast, projectDepletion, type SeriesPoint } from './domain/forecast';

/**
 * Forecasts and anomalies (spec §54, doc 17 §§8-9).
 *
 * Both are arithmetic. Neither involves a language model, and neither is in
 * the AI module because it needs one — they are here because they answer the
 * questions people ask an assistant, and because keeping them beside the
 * grounding rules makes the boundary obvious: the statistics decide, the model
 * at most describes.
 *
 * Every forecast carries its interval and refuses below its minimum history.
 * Every anomaly is a flag for a person, carries the records behind it, and
 * carries at least one ordinary explanation — a detector that only ever reports
 * suspicion trains people to dismiss it.
 */
@Injectable()
export class InsightService {
  // No Env dependency, deliberately. Forecasting and anomaly detection are
  // arithmetic over the facility's own records; they do not consult AI_ENABLED
  // because switching the AI layer off must not take away the ability to see
  // that a medicine runs out in nine days.
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

  private held(): ReadonlySet<Permission> {
    return tryGetContext()?.permissions ?? new Set<Permission>();
  }

  /**
   * Forecasting is available with the AI layer off.
   *
   * It is statistics over the facility's own records; nothing about it needs a
   * model or a network. Switching AI off should not take away the ability to
   * see that a medicine will run out in nine days.
   */
  async forecast(input: AiForecast) {
    this.assertFacilityVisible(input.facilityId);

    const days = input.days ?? 56;
    const from = new Date(this.now().getTime() - days * 86_400_000);

    const series = await this.dailySeries(input.facilityId, input.measure, from);

    const minimumPoints = await this.config.number('forecast.minimumPoints', 8, input.facilityId);

    const result = forecast(series, {
      seasonLength: input.seasonLength ?? 7,
      horizon: input.horizon ?? 7,
      minimumPoints,
      futurePeriods: Array.from({ length: input.horizon ?? 7 }, (_, index) =>
        new Date(this.now().getTime() + (index + 1) * 86_400_000).toISOString().slice(0, 10),
      ),
    });

    return {
      facilityId: input.facilityId,
      measure: input.measure,
      observedFrom: from.toISOString().slice(0, 10),
      computedAt: this.now().toISOString(),
      // Statistics, not a model. Said on the payload so nobody has to wonder.
      method: 'deterministic',
      languageModelUsed: false,
      ...result,
    };
  }

  /** Days to stock-out for every item that has moved (doc 17 §8). */
  async stockDepletion(facilityId: string, windowDays = 28) {
    this.assertFacilityVisible(facilityId);

    const from = new Date(this.now().getTime() - windowDays * 86_400_000);

    const items = await this.prisma.inventoryItem.findMany({
      where: { facilityId, status: 'ACTIVE' },
      select: {
        id: true,
        code: true,
        name: true,
        batches: {
          where: { status: 'ACTIVE' },
          select: {
            quantityOnHand: true,
            transactions: {
              where: { occurredAt: { gte: from }, quantity: { lt: 0 } },
              select: { quantity: true },
            },
          },
        },
        reorderRule: { select: { leadTimeDays: true } },
      },
    });

    const projections = items.map((item) => {
      const onHand = item.batches.reduce((sum, batch) => sum + Number(batch.quantityOnHand), 0);
      const consumed = item.batches.reduce(
        (sum, batch) =>
          sum +
          batch.transactions.reduce(
            (inner, transaction) => inner + Math.abs(Number(transaction.quantity)),
            0,
          ),
        0,
      );

      return projectDepletion({
        itemCode: item.code,
        itemName: item.name,
        quantityOnHand: onHand,
        consumedInWindow: consumed,
        windowDays,
        leadTimeDays: item.reorderRule?.leadTimeDays ?? null,
      });
    });

    return {
      facilityId,
      windowDays,
      computedAt: this.now().toISOString(),
      classification: 'PROJECTED' as const,
      languageModelUsed: false,
      note:
        'Projected from the consumption recorded in the window, which assumes the period ahead ' +
        'resembles the period behind. An outbreak or an outreach campaign breaks that assumption.',
      items: projections
        .filter((projection) => projection.daysToStockOut !== null)
        .sort((a, b) => (a.daysToStockOut ?? 1e9) - (b.daysToStockOut ?? 1e9)),
      unprojectable: projections.filter((projection) => projection.daysToStockOut === null),
    };
  }

  /**
   * Run the deterministic detectors over the period.
   *
   * Each returns flags for a person, never an action. The response says what
   * each detector could and could not run, because a detector that declined and
   * a detector that found nothing look identical in a list of zero anomalies.
   */
  async anomalies(facilityId: string, days = 60) {
    this.assertFacilityVisible(facilityId);

    const from = new Date(this.now().getTime() - days * 86_400_000);
    const permissions = this.held();

    const detectors = [];

    if (permissions.has('clinical.read')) {
      const series = await this.dailySeries(facilityId, 'ENCOUNTERS', from);
      detectors.push({
        domain: 'clinical',
        measure: 'Daily encounters',
        ...detectOutliers(toObservations(series), {
          detector: 'clinical.attendance',
          unit: 'encounters',
          benignExplanations: [
            'An outreach day brings a month of attendance into one morning.',
            'A market day, a public holiday or a funeral changes who comes and when.',
          ],
        }),
      });
    }

    if (permissions.has('finance.read')) {
      const series = await this.dailySeries(facilityId, 'REVENUE', from);
      detectors.push({
        domain: 'financial',
        measure: 'Daily collections',
        ...detectOutliers(toObservations(series), {
          detector: 'finance.collections',
          unit: 'naira',
          benignExplanations: [
            'A single large settlement from an HMO lands on one day.',
            'A day with no banking is a day with no recorded collection, not a day with no income.',
          ],
        }),
      });
    }

    if (permissions.has('procurement.read')) {
      const { organisationId } = getTenantScope();
      const orders = await this.prisma.purchaseOrder.groupBy({
        by: ['supplierId'],
        where: { organisationId, facilityId, orderedOn: { gte: from } },
        _sum: { totalMinor: true },
      });

      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: orders.map((order) => order.supplierId) } },
        select: { id: true, name: true },
      });

      const byId = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));

      detectors.push({
        domain: 'procurement',
        measure: 'Supplier share of ordered value',
        ...detectConcentration(
          orders.map((order) => ({
            key: byId.get(order.supplierId) ?? order.supplierId,
            value: Number(order._sum?.totalMinor ?? 0n) / 100,
          })),
          { subject: 'supplier', detector: 'procurement.concentration' },
        ),
      });
    }

    const anomalies = detectors.flatMap((detector) =>
      detector.anomalies.map((anomaly) => ({ ...anomaly, domain: detector.domain })),
    );

    return {
      facilityId,
      observedFrom: from.toISOString().slice(0, 10),
      computedAt: this.now().toISOString(),
      languageModelUsed: false,
      classification: 'ACTUAL' as const,
      note:
        'Every item here is a flag for a person to look at, not a finding and not an action. Detection ' +
        'is arithmetic over the records; whether something is actually wrong is a judgement nobody has ' +
        'made yet.',
      detectors: detectors.map((detector) => ({
        domain: detector.domain,
        measure: detector.measure,
        observations: detector.observations,
        mean: detector.mean,
        standardDeviation: detector.standardDeviation,
        ran: detector.note === undefined,
        // Distinguishes "looked and found nothing" from "could not look".
        declinedReason: detector.note ?? null,
        found: detector.anomalies.length,
      })),
      anomalies,
      // Detectors the caller's permissions kept out of the run, named rather
      // than silently skipped.
      notRun: ['clinical.read', 'finance.read', 'procurement.read']
        .filter((permission) => !permissions.has(permission as Permission))
        .map((permission) => `Requires ${permission}, which you do not hold.`),
    };
  }

  // ---------------------------------------------------------------------------
  // Series
  // ---------------------------------------------------------------------------

  private async dailySeries(
    facilityId: string,
    measure: 'ENCOUNTERS' | 'REVENUE',
    from: Date,
  ): Promise<SeriesPoint[]> {
    if (measure === 'ENCOUNTERS') {
      const rows = await this.prisma.encounter.findMany({
        where: { facilityId, startedAt: { gte: from }, status: { not: 'CANCELLED' } },
        select: { startedAt: true },
      });

      return bucketByDay(rows.map((row) => ({ at: row.startedAt, value: 1 })), from, this.now());
    }

    const rows = await this.prisma.payment.findMany({
      where: { facilityId, direction: 'INBOUND', receivedAt: { gte: from } },
      select: { receivedAt: true, amountMinor: true },
    });

    return bucketByDay(
      rows.map((row) => ({ at: row.receivedAt, value: Number(row.amountMinor) / 100 })),
      from,
      this.now(),
    );
  }

}

function toObservations(series: readonly SeriesPoint[]): Observation[] {
  return series.map((point) => ({ key: point.period, value: point.value }));
}

/**
 * One bucket per day, including the days on which nothing happened.
 *
 * A series that silently omits empty days tells a detector the facility was
 * consistently busy when it was in fact shut on Sundays.
 */
function bucketByDay(
  events: ReadonlyArray<{ at: Date; value: number }>,
  from: Date,
  to: Date,
): SeriesPoint[] {
  const buckets = new Map<string, number>();

  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor <= end) {
    buckets.set(cursor.toISOString().slice(0, 10), 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const event of events) {
    const key = event.at.toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + event.value);
  }

  return [...buckets.entries()].map(([period, value]) => ({ period, value }));
}
