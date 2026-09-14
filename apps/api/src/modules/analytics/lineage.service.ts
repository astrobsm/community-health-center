import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DataClassification, Permission } from '@chc/contracts';
import { weakest } from '@chc/contracts';

import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * The lineage service (doc 22, acceptance criterion M).
 *
 * Given any reported figure or any record, walk to what produced it and to what
 * it went on to affect. This is a first-class API, not a debugging
 * convenience: it is the thing a finance officer uses when they dispute a
 * number and a government reviewer uses when they ask what the money bought.
 *
 * Two rules shape it.
 *
 * **Permission is re-evaluated at every hop.** A caller who may see an
 * encounter is not thereby entitled to the patient behind it. Where a hop is
 * beyond their access the link is *absent* with a stated reason, not present
 * and disabled — a disabled link still tells you the record exists.
 *
 * **A broken link is reported, never smoothed over.** A charge whose encounter
 * was deleted, a payment allocated to nothing: the walk says so. Silently
 * returning a shorter chain would make a hole look like the end of the chain.
 */

export interface LineageNode {
  entityType: string;
  id: string | null;
  label: string;
  /** What this record is, for a reader who does not know the schema. */
  description: string;
  classification: DataClassification | null;
  /** Where to continue the walk, or null where the caller may not go there. */
  href: string | null;
  /** Set when the hop exists but is beyond the caller's permissions. */
  withheldReason?: string;
  /** Set when the link is genuinely broken in the data. */
  brokenLinkReason?: string;
  detail?: Record<string, string | number | null>;
}

export interface LineageWalk {
  origin: LineageNode;
  direction: 'upstream' | 'downstream';
  /** Ordered from the origin outwards. */
  chain: LineageNode[];
  /** The weakest classification anywhere in the chain. */
  classification: DataClassification;
  /** Hops the caller could not follow, and why. */
  withheld: string[];
  /** Links the data itself does not have. */
  broken: string[];
  explanation: string;
}

type EntityType =
  | 'payment'
  | 'invoice'
  | 'charge'
  | 'encounter'
  | 'patient'
  | 'journal_entry'
  | 'asset'
  | 'project'
  | 'kpi_result';

const SUPPORTED: readonly EntityType[] = [
  'payment',
  'invoice',
  'charge',
  'encounter',
  'patient',
  'journal_entry',
  'asset',
  'project',
  'kpi_result',
];

@Injectable()
export class LineageService {
  constructor(private readonly prisma: PrismaService) {}

  private held(): ReadonlySet<Permission> {
    return tryGetContext()?.permissions ?? new Set<Permission>();
  }

  private can(permission: Permission): boolean {
    return this.held().has(permission);
  }

  private assertVisible(facilityId: string): void {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such record, or it is not visible to you.');
    }
  }

  supported() {
    return {
      entityTypes: SUPPORTED,
      note:
        'Every hop below is a foreign key, not a guess. Where a chain stops, it stops because the ' +
        'data has no further link or because you may not follow it — and the response says which.',
    };
  }

  async upstream(entityType: string, id: string): Promise<LineageWalk> {
    const type = this.parseType(entityType);
    const chain: LineageNode[] = [];
    const withheld: string[] = [];
    const broken: string[] = [];

    const origin = await this.load(type, id);
    await this.walkUp(type, id, chain, withheld, broken);

    return this.finish(origin, 'upstream', chain, withheld, broken);
  }

  async downstream(entityType: string, id: string): Promise<LineageWalk> {
    const type = this.parseType(entityType);
    const chain: LineageNode[] = [];
    const withheld: string[] = [];
    const broken: string[] = [];

    const origin = await this.load(type, id);
    await this.walkDown(type, id, chain, withheld, broken);

    return this.finish(origin, 'downstream', chain, withheld, broken);
  }

  // ---------------------------------------------------------------------------
  // Upstream: what produced this
  // ---------------------------------------------------------------------------

  private async walkUp(
    type: EntityType,
    id: string,
    chain: LineageNode[],
    withheld: string[],
    broken: string[],
  ): Promise<void> {
    switch (type) {
      case 'payment': {
        const payment = await this.prisma.payment.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            allocations: { select: { invoiceId: true, amountMinor: true } },
          },
        });
        if (!payment) return;
        this.assertVisible(payment.facilityId);

        if (payment.allocations.length === 0) {
          broken.push(
            'This payment is not allocated to any invoice, so the chain stops here. An unallocated ' +
              'payment is money received against nothing in particular.',
          );
          return;
        }

        // Pushed, not unshifted: the chain reads outward from the origin, so
        // the first entry is what produced this payment and the last is where
        // the trail ends.
        for (const allocation of payment.allocations) {
          chain.push(await this.load('invoice', allocation.invoiceId));
          await this.walkUp('invoice', allocation.invoiceId, chain, withheld, broken);
        }
        return;
      }

      case 'invoice': {
        const invoice = await this.prisma.invoice.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            items: { select: { chargeId: true } },
          },
        });
        if (!invoice) return;
        this.assertVisible(invoice.facilityId);

        const chargeIds = invoice.items
          .map((item) => item.chargeId)
          .filter((chargeId): chargeId is string => chargeId !== null);

        if (chargeIds.length === 0) {
          broken.push('This invoice has no line linked to a charge, so what was billed cannot be traced.');
          return;
        }

        for (const chargeId of chargeIds) {
          chain.push(await this.load('charge', chargeId));
          await this.walkUp('charge', chargeId, chain, withheld, broken);
        }
        return;
      }

      case 'charge': {
        const charge = await this.prisma.charge.findFirst({
          where: { id },
          select: { id: true, facilityId: true, encounterId: true, description: true },
        });
        if (!charge) return;
        this.assertVisible(charge.facilityId);

        if (!charge.encounterId) {
          broken.push(
            `"${charge.description}" is not linked to an encounter, so it cannot be traced to the care ` +
              'that produced it.',
          );
          return;
        }

        chain.push(await this.load('encounter', charge.encounterId));
        await this.walkUp('encounter', charge.encounterId, chain, withheld, broken);
        return;
      }

      case 'encounter': {
        const encounter = await this.prisma.encounter.findFirst({
          where: { id },
          select: { id: true, facilityId: true, patientId: true, reference: true },
        });
        if (!encounter) return;
        this.assertVisible(encounter.facilityId);

        // The hop where permission actually bites. A government observer
        // reaches the encounter and stops; the patient node is absent, not
        // greyed out.
        if (!this.can('patient.read')) {
          withheld.push(
            `The patient behind ${encounter.reference} is not shown: reaching a patient record requires ` +
              'patient.read, which you do not hold. The chain is complete; this hop is closed to you.',
          );
          return;
        }

        chain.push(await this.load('patient', encounter.patientId));
        return;
      }

      case 'journal_entry': {
        const entry = await this.prisma.journalEntry.findFirst({
          where: { id },
          select: { id: true, facilityId: true, sourceType: true, sourceId: true, reference: true },
        });
        if (!entry) return;
        this.assertVisible(entry.facilityId);

        if (!entry.sourceId || !entry.sourceType) {
          broken.push(
            `Journal entry ${entry.reference} names no source, so what caused it cannot be traced. ` +
              'Every posting should name its cause.',
          );
          return;
        }

        const sourceType = entry.sourceType.toLowerCase();
        if (sourceType === 'payment' || sourceType === 'charge' || sourceType === 'invoice') {
          chain.push(await this.load(sourceType as EntityType, entry.sourceId));
          await this.walkUp(sourceType as EntityType, entry.sourceId, chain, withheld, broken);
          return;
        }

        chain.push({
          entityType: entry.sourceType,
          id: entry.sourceId,
          label: `${entry.sourceType} ${entry.sourceId.slice(0, 8)}`,
          description: `The ${entry.sourceType.toLowerCase()} this posting was raised from.`,
          classification: null,
          href: null,
          withheldReason: undefined,
          brokenLinkReason: undefined,
        });
        return;
      }

      case 'asset': {
        const asset = await this.prisma.equipmentAsset.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            assetTag: true,
            goodsReceiptLine: {
              select: {
                id: true,
                goodsReceipt: {
                  select: {
                    id: true,
                    reference: true,
                    purchaseOrder: {
                      select: { id: true, reference: true, projectId: true },
                    },
                  },
                },
              },
            },
          },
        });
        if (!asset) return;
        this.assertVisible(asset.facilityId);

        if (!asset.goodsReceiptLine) {
          broken.push(
            `Asset ${asset.assetTag} is not linked to a goods receipt, so it cannot be traced to what ` +
              'was bought or to the money that bought it.',
          );
          return;
        }

        if (!this.can('procurement.read')) {
          withheld.push(
            `The purchase behind ${asset.assetTag} is not shown: it requires procurement.read.`,
          );
          return;
        }

        const receipt = asset.goodsReceiptLine.goodsReceipt;
        chain.push({
          entityType: 'goods_receipt',
          id: receipt.id,
          label: receipt.reference,
          description: 'The delivery in which this equipment arrived, and what was checked on arrival.',
          classification: 'ACTUAL',
          href: null,
        });

        const order = receipt.purchaseOrder;
        chain.push({
          entityType: 'purchase_order',
          id: order.id,
          label: order.reference,
          description: 'The order that was placed, against which the delivery was matched.',
          classification: 'ACTUAL',
          href: null,
        });

        if (order.projectId) {
          chain.push(await this.load('project', order.projectId));
          await this.walkUp('project', order.projectId, chain, withheld, broken);
        } else {
          broken.push(
            `Purchase order ${order.reference} is not linked to a capital project, so this asset cannot ` +
              'be traced back to the need that justified it.',
          );
        }
        return;
      }

      case 'project': {
        const project = await this.prisma.capitalProject.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            reference: true,
            unplannedReason: true,
            recommendation: {
              select: {
                id: true,
                title: true,
                need: {
                  select: {
                    id: true,
                    title: true,
                    findingId: true,
                  },
                },
              },
            },
          },
        });
        if (!project) return;
        this.assertVisible(project.facilityId);

        if (!project.recommendation) {
          chain.push({
            entityType: 'unplanned',
            id: null,
            label: 'No originating recommendation',
            description:
              project.unplannedReason ??
              'This project was raised without a recommendation and without a recorded reason.',
            classification: 'REPORTED',
            href: null,
            brokenLinkReason:
              'The chain from observation to spending stops here. The project states why it was ' +
              'unplanned; it cannot be traced to an assessment finding.',
          });
          broken.push(`${project.reference} was raised without a recommendation behind it.`);
          return;
        }

        chain.push({
          entityType: 'recommendation',
          id: project.recommendation.id,
          label: project.recommendation.title,
          description: 'The costed recommendation this project delivers.',
          classification: 'ACTUAL',
          href: null,
        });

        if (project.recommendation.need) {
          chain.push({
            entityType: 'need',
            id: project.recommendation.need.id,
            label: project.recommendation.need.title,
            description: 'The need the recommendation answers.',
            classification: 'ACTUAL',
            href: null,
          });

          const findingId = project.recommendation.need.findingId;
          if (findingId) {
            if (!this.can('assessment.read')) {
              withheld.push('The assessment finding behind this need requires assessment.read.');
              return;
            }

            const finding = await this.prisma.assessmentFinding.findFirst({
              where: { id: findingId },
              select: { id: true, title: true, severity: true },
            });

            chain.push({
              entityType: 'assessment_finding',
              id: findingId,
              label: finding?.title ?? 'Finding',
              description:
                'The thing somebody saw at the facility, with its evidence. This is where the chain ' +
                'from observation to spending begins.',
              classification: 'VERIFIED',
              href: null,
              detail: finding ? { severity: finding.severity } : undefined,
            });
          } else {
            broken.push('This need does not cite an assessment finding.');
          }
        }
        return;
      }

      case 'kpi_result': {
        const result = await this.prisma.kpiResult.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            inputs: true,
            kpiAssignment: {
              select: {
                kpi: { select: { code: true, name: true, sourceQueryId: true, definition: true } },
                baselineSnapshot: { select: { id: true, label: true, sealedAt: true, contentHash: true } },
              },
            },
          },
        });
        if (!result) return;
        this.assertVisible(result.facilityId);

        chain.push({
          entityType: 'named_query',
          id: null,
          label: result.kpiAssignment.kpi.sourceQueryId,
          description: result.kpiAssignment.kpi.definition,
          classification: 'ACTUAL',
          href: null,
          detail: (result.inputs as Record<string, string | number | null>) ?? undefined,
        });

        if (result.kpiAssignment.baselineSnapshot) {
          chain.push({
            entityType: 'baseline_snapshot',
            id: result.kpiAssignment.baselineSnapshot.id,
            label: result.kpiAssignment.baselineSnapshot.label,
            description:
              'The sealed Day 0 snapshot this result is compared with. It is never recomputed, which ' +
              'is what stops the baseline and the current value being confused.',
            classification: 'VERIFIED',
            href: null,
            detail: {
              sealedAt: result.kpiAssignment.baselineSnapshot.sealedAt.toISOString(),
              contentHash: result.kpiAssignment.baselineSnapshot.contentHash.slice(0, 16),
            },
          });
        }
        return;
      }

      case 'patient':
        // The end of the chain. A patient is not produced by anything.
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Downstream: what this went on to affect
  // ---------------------------------------------------------------------------

  private async walkDown(
    type: EntityType,
    id: string,
    chain: LineageNode[],
    withheld: string[],
    broken: string[],
  ): Promise<void> {
    switch (type) {
      case 'encounter': {
        const encounter = await this.prisma.encounter.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            reference: true,
            charges: { select: { id: true, description: true, amountMinor: true, status: true } },
          },
        });
        if (!encounter) return;
        this.assertVisible(encounter.facilityId);

        if (!this.can('billing.read')) {
          withheld.push('What this encounter billed requires billing.read.');
          return;
        }

        if (encounter.charges.length === 0) {
          broken.push(
            `${encounter.reference} raised no charge. That may be correct — a free service, a waiver ` +
              'recorded elsewhere — or it may be care given and never billed.',
          );
          return;
        }

        for (const charge of encounter.charges) {
          chain.push({
            entityType: 'charge',
            id: charge.id,
            label: charge.description,
            description: 'What this encounter billed.',
            classification: 'ACTUAL',
            href: `/api/v1/lineage/charge/${charge.id}/downstream`,
            detail: { amount: Number(charge.amountMinor) / 100, status: charge.status },
          });

          // Carried on to the invoice, the payment and the ledger entry, so
          // "care creates revenue" is a chain somebody can actually read
          // rather than two links and an assurance.
          await this.walkDown('charge', charge.id, chain, withheld, broken);
        }
        return;
      }

      case 'charge': {
        const charge = await this.prisma.charge.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            description: true,
            invoiceItem: { select: { invoiceId: true } },
          },
        });
        if (!charge) return;
        this.assertVisible(charge.facilityId);

        if (!charge.invoiceItem) {
          broken.push(`"${charge.description}" has not been invoiced, so no money has been asked for.`);
          return;
        }

        chain.push(await this.load('invoice', charge.invoiceItem.invoiceId));
        await this.walkDown('invoice', charge.invoiceItem.invoiceId, chain, withheld, broken);
        return;
      }

      case 'invoice': {
        const invoice = await this.prisma.invoice.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            reference: true,
            allocations: { select: { paymentId: true, amountMinor: true } },
          },
        });
        if (!invoice) return;
        this.assertVisible(invoice.facilityId);

        if (invoice.allocations.length === 0) {
          broken.push(`Invoice ${invoice.reference} has been issued and nothing has been paid against it.`);
          return;
        }

        for (const allocation of invoice.allocations) {
          chain.push(await this.load('payment', allocation.paymentId));
          await this.walkDown('payment', allocation.paymentId, chain, withheld, broken);
        }
        return;
      }

      case 'payment': {
        const payment = await this.prisma.payment.findFirst({
          where: { id },
          select: { id: true, facilityId: true, reference: true },
        });
        if (!payment) return;
        this.assertVisible(payment.facilityId);

        if (!this.can('finance.read')) {
          withheld.push('The ledger entries this payment produced require finance.read.');
          return;
        }

        const entries = await this.prisma.journalEntry.findMany({
          // Lower case, as the posting engine writes it. A near-miss here
          // returns an empty list, which reads as "this payment never reached
          // the ledger" — the most alarming thing the chain can say, and it
          // would have been wrong.
          where: { sourceType: 'payment', sourceId: payment.id },
          select: { id: true, reference: true, description: true, status: true },
        });

        if (entries.length === 0) {
          broken.push(
            `Payment ${payment.reference} produced no journal entry. Money received that the ledger ` +
              'does not know about is a reconciliation failure, not a rounding one.',
          );
          return;
        }

        for (const entry of entries) {
          chain.push({
            entityType: 'journal_entry',
            id: entry.id,
            label: entry.reference,
            description: entry.description ?? 'The double-entry posting this payment produced.',
            classification: 'ACTUAL',
            href: `/api/v1/lineage/journal_entry/${entry.id}/upstream`,
            detail: { status: entry.status },
          });
        }
        return;
      }

      case 'patient': {
        const patient = await this.prisma.patient.findFirst({
          where: { id },
          select: { id: true, facilityId: true },
        });
        if (!patient) return;
        this.assertVisible(patient.facilityId);

        if (!this.can('encounter.read')) {
          withheld.push('This patient’s encounters require encounter.read.');
          return;
        }

        const encounters = await this.prisma.encounter.findMany({
          where: { patientId: patient.id },
          orderBy: { startedAt: 'desc' },
          take: 50,
          select: { id: true, reference: true, encounterType: true, startedAt: true },
        });

        for (const encounter of encounters) {
          chain.push({
            entityType: 'encounter',
            id: encounter.id,
            label: encounter.reference,
            description: 'An episode of care for this patient.',
            classification: 'ACTUAL',
            href: `/api/v1/lineage/encounter/${encounter.id}/downstream`,
            detail: { type: encounter.encounterType, started: encounter.startedAt.toISOString() },
          });
        }
        return;
      }

      case 'project': {
        const project = await this.prisma.capitalProject.findFirst({
          where: { id },
          select: { id: true, facilityId: true, reference: true },
        });
        if (!project) return;
        this.assertVisible(project.facilityId);

        // Straight down the foreign keys: an asset exists because a receipt
        // line exists, because an order exists, because this project raised it.
        const assets = await this.prisma.equipmentAsset.findMany({
          where: {
            facilityId: project.facilityId,
            goodsReceiptLine: { goodsReceipt: { purchaseOrder: { projectId: project.id } } },
          },
          select: { id: true, assetTag: true, name: true, commissioningStatus: true },
        });

        for (const asset of assets) {
          chain.push({
            entityType: 'asset',
            id: asset.id,
            label: `${asset.assetTag} — ${asset.name}`,
            description: 'Equipment this project bought.',
            classification: 'ACTUAL',
            href: `/api/v1/lineage/asset/${asset.id}/upstream`,
            detail: { commissioning: asset.commissioningStatus },
          });
        }

        if (assets.length === 0) {
          broken.push(
            `${project.reference} has produced no asset yet. Money committed and nothing yet in the ` +
              'building is the ordinary state of a project mid-way, and the honest thing to report.',
          );
        }
        return;
      }

      case 'asset':
      case 'journal_entry':
      case 'kpi_result':
        broken.push(
          'Downstream tracing is not implemented for this record type. It is not that nothing follows ' +
            'from it; it is that this walk cannot show you, and saying so is better than an empty list.',
        );
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private parseType(entityType: string): EntityType {
    if (!SUPPORTED.includes(entityType as EntityType)) {
      throw new BadRequestException(
        `Lineage is not implemented for "${entityType}". Supported: ${SUPPORTED.join(', ')}.`,
      );
    }
    return entityType as EntityType;
  }

  private finish(
    origin: LineageNode,
    direction: 'upstream' | 'downstream',
    chain: LineageNode[],
    withheld: string[],
    broken: string[],
  ): LineageWalk {
    const classifications = [origin, ...chain]
      .map((node) => node.classification)
      .filter((classification): classification is DataClassification => classification !== null);

    return {
      origin,
      direction,
      chain,
      classification: weakest(classifications),
      withheld,
      broken,
      explanation:
        `${chain.length} hop(s) ${direction} of ${origin.label}. Every hop is a foreign key in the ` +
        'database, not an inference.' +
        (withheld.length > 0
          ? ` ${withheld.length} hop(s) are closed to your permissions and are named above rather than hidden.`
          : '') +
        (broken.length > 0
          ? ` ${broken.length} link(s) the data does not have are reported rather than passed over.`
          : ''),
    };
  }

  private async load(type: EntityType, id: string): Promise<LineageNode> {
    switch (type) {
      case 'payment': {
        const row = await this.prisma.payment.findFirst({
          where: { id },
          select: { id: true, facilityId: true, reference: true, amountMinor: true, method: true, receivedAt: true },
        });
        if (!row) return this.missing('payment', id);
        this.assertVisible(row.facilityId);
        return {
          entityType: 'payment',
          id: row.id,
          label: row.reference,
          description: 'Money actually received.',
          classification: 'ACTUAL',
          href: `/api/v1/lineage/payment/${row.id}/upstream`,
          detail: {
            amount: Number(row.amountMinor) / 100,
            method: row.method,
            received: row.receivedAt.toISOString(),
          },
        };
      }

      case 'invoice': {
        const row = await this.prisma.invoice.findFirst({
          where: { id },
          select: { id: true, facilityId: true, reference: true, totalMinor: true, paidMinor: true, status: true },
        });
        if (!row) return this.missing('invoice', id);
        this.assertVisible(row.facilityId);
        return {
          entityType: 'invoice',
          id: row.id,
          label: row.reference,
          description: 'What was asked for.',
          classification: 'ACTUAL',
          href: `/api/v1/lineage/invoice/${row.id}/upstream`,
          detail: {
            total: Number(row.totalMinor) / 100,
            paid: Number(row.paidMinor) / 100,
            status: row.status,
          },
        };
      }

      case 'charge': {
        const row = await this.prisma.charge.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            description: true,
            amountMinor: true,
            serviceDate: true,
            classification: true,
          },
        });
        if (!row) return this.missing('charge', id);
        this.assertVisible(row.facilityId);
        return {
          entityType: 'charge',
          id: row.id,
          label: row.description,
          description: 'What was done, priced by the tariff in force on the service date.',
          classification: row.classification,
          href: `/api/v1/lineage/charge/${row.id}/upstream`,
          detail: {
            amount: Number(row.amountMinor) / 100,
            serviceDate: row.serviceDate.toISOString().slice(0, 10),
          },
        };
      }

      case 'encounter': {
        const row = await this.prisma.encounter.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            reference: true,
            encounterType: true,
            status: true,
            startedAt: true,
          },
        });
        if (!row) return this.missing('encounter', id);
        this.assertVisible(row.facilityId);
        return {
          entityType: 'encounter',
          id: row.id,
          label: row.reference,
          description: 'An episode of care.',
          classification: 'ACTUAL',
          href: `/api/v1/lineage/encounter/${row.id}/upstream`,
          detail: {
            type: row.encounterType,
            status: row.status,
            started: row.startedAt.toISOString(),
          },
        };
      }

      case 'patient': {
        if (!this.can('patient.read')) {
          return {
            entityType: 'patient',
            id: null,
            label: 'Patient',
            description: 'A patient record exists at this hop.',
            classification: null,
            href: null,
            withheldReason: 'Reaching a patient record requires patient.read.',
          };
        }

        const row = await this.prisma.patient.findFirst({
          where: { id },
          select: { id: true, facilityId: true, mrn: true, givenName: true, familyName: true },
        });
        if (!row) return this.missing('patient', id);
        this.assertVisible(row.facilityId);

        // Identity is a second permission beyond reading the record at all.
        const identified = this.can('patient.read_identified');

        return {
          entityType: 'patient',
          id: row.id,
          label: identified ? `${row.givenName} ${row.familyName}` : row.mrn,
          description: identified
            ? 'The patient this care was given to.'
            : 'The patient, by record number only. Their name requires patient.read_identified.',
          classification: 'ACTUAL',
          href: `/api/v1/lineage/patient/${row.id}/downstream`,
          withheldReason: identified
            ? undefined
            : 'The name is withheld: it requires patient.read_identified.',
        };
      }

      case 'journal_entry': {
        const row = await this.prisma.journalEntry.findFirst({
          where: { id },
          select: { id: true, facilityId: true, reference: true, description: true, status: true, entryDate: true },
        });
        if (!row) return this.missing('journal_entry', id);
        this.assertVisible(row.facilityId);
        return {
          entityType: 'journal_entry',
          id: row.id,
          label: row.reference,
          description: row.description ?? 'A double-entry posting.',
          classification: 'ACTUAL',
          href: `/api/v1/lineage/journal_entry/${row.id}/upstream`,
          detail: { status: row.status, date: row.entryDate.toISOString().slice(0, 10) },
        };
      }

      case 'asset': {
        const row = await this.prisma.equipmentAsset.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            assetTag: true,
            name: true,
            commissioningStatus: true,
            classification: true,
          },
        });
        if (!row) return this.missing('asset', id);
        this.assertVisible(row.facilityId);
        return {
          entityType: 'asset',
          id: row.id,
          label: `${row.assetTag} — ${row.name}`,
          description: 'Equipment in the building.',
          classification: row.classification,
          href: `/api/v1/lineage/asset/${row.id}/upstream`,
          detail: { commissioning: row.commissioningStatus },
        };
      }

      case 'project': {
        const row = await this.prisma.capitalProject.findFirst({
          where: { id },
          select: { id: true, facilityId: true, reference: true, name: true, status: true },
        });
        if (!row) return this.missing('project', id);
        this.assertVisible(row.facilityId);
        return {
          entityType: 'project',
          id: row.id,
          label: `${row.reference} — ${row.name}`,
          description: 'A capital project.',
          classification: 'ACTUAL',
          href: `/api/v1/lineage/project/${row.id}/downstream`,
          detail: { status: row.status },
        };
      }

      case 'kpi_result': {
        const row = await this.prisma.kpiResult.findFirst({
          where: { id },
          select: {
            id: true,
            facilityId: true,
            value: true,
            periodStart: true,
            periodEnd: true,
            classification: true,
            computedAt: true,
            kpiAssignment: { select: { kpi: { select: { code: true, name: true } } } },
          },
        });
        if (!row) return this.missing('kpi_result', id);
        this.assertVisible(row.facilityId);
        return {
          entityType: 'kpi_result',
          id: row.id,
          label: row.kpiAssignment.kpi.name,
          description: 'A computed indicator value for one period.',
          classification: row.classification,
          href: `/api/v1/kpis/results/${row.id}`,
          detail: {
            code: row.kpiAssignment.kpi.code,
            value: row.value === null ? null : Number(row.value),
            period: `${row.periodStart.toISOString().slice(0, 10)} to ${row.periodEnd.toISOString().slice(0, 10)}`,
            computedAt: row.computedAt.toISOString(),
          },
        };
      }
    }
  }

  private missing(entityType: string, id: string): LineageNode {
    return {
      entityType,
      id,
      label: `${entityType} ${id.slice(0, 8)}`,
      description: 'This record does not exist, or it is not visible to you.',
      classification: null,
      href: null,
      brokenLinkReason:
        'The chain names this record but it could not be read. That is either a permission boundary ' +
        'or a broken link, and both are worth knowing about.',
    };
  }
}
