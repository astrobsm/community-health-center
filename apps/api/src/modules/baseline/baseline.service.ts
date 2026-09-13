import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { BaselineMetric, SealBaseline } from '@chc/contracts';

import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { EvidenceService } from '../evidence/evidence.service';

import { BASELINE_METRIC_SOURCES } from './baseline-metrics.config';
import {
  computeContentHash,
  deriveMetrics,
  evaluateSeal,
  verifyContentHash,
  type SourceResponse,
} from './domain/seal';

@Injectable()
export class BaselineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly evidence: EvidenceService,
  ) {}

  /**
   * Show exactly what sealing would produce, before committing to it.
   *
   * Sealing is irreversible, so the assessor sees every metric and every gap
   * first. A preview that hides the gaps would defeat the point.
   */
  async preview(assessmentId: string) {
    const assessment = await this.loadAssessment(assessmentId);
    const { metrics, gaps } = await this.derive(assessmentId, assessment.facilityId);

    const minimum = await this.config.number(
      'baseline.minimumCompletionPercent',
      90,
      assessment.facilityId,
    );

    const [pendingMedia, unverified, existing] = await Promise.all([
      this.evidence.countPendingMedia(assessment.facilityId),
      this.evidence.countUnverified(assessment.facilityId),
      this.prisma.baselineSnapshot.findFirst({
        where: { facilityId: assessment.facilityId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      }),
    ]);

    const gate = evaluateSeal({
      assessmentStatus: assessment.status,
      completionPercent: Number(assessment.completionPercent),
      minimumCompletionPercent: minimum,
      unverifiedEvidenceCount: unverified,
      pendingMediaCount: pendingMedia,
      derivationGapCount: gaps.length,
      existingSequence: existing?.sequence ?? null,
    });

    return {
      assessmentId,
      facilityId: assessment.facilityId,
      nextSequence: (existing?.sequence ?? 0) + 1,
      metrics,
      gaps,
      gate,
      summary: {
        metricsDerived: metrics.length,
        metricsExpected: BASELINE_METRIC_SOURCES.length,
        gaps: gaps.length,
        pendingMedia,
        unverifiedEvidence: unverified,
      },
    };
  }

  /**
   * Seal the baseline. Day 0.
   *
   * After this the snapshot and its metrics can never be edited or deleted —
   * enforced by a database trigger, not by this code. Every later comparison in
   * the product is measured against it.
   */
  async seal(assessmentId: string, input: SealBaseline) {
    const assessment = await this.loadAssessment(assessmentId);
    const preview = await this.preview(assessmentId);

    if (!preview.gate.canSeal) {
      throw new BadRequestException(preview.gate.blockers.join(' '));
    }

    const { organisationId } = getTenantScope();
    const context = tryGetContext();
    const sequence = preview.nextSequence;
    const contentHash = computeContentHash(
      assessment.facilityId,
      sequence,
      input.asOfDate,
      preview.metrics,
    );

    const snapshot = await this.prisma.$transaction(async (tx) => {
      const created = await tx.baselineSnapshot.create({
        data: {
          facilityId: assessment.facilityId,
          organisationId,
          assessmentId,
          sequence,
          label: input.label,
          asOfDate: new Date(input.asOfDate),
          sealedBy: context?.userId,
          contentHash,
          notes: input.notes,
        },
        select: { id: true, sequence: true, label: true, asOfDate: true, sealedAt: true, contentHash: true },
      });

      for (const metric of preview.metrics) {
        await tx.baselineMetric.create({
          data: {
            snapshotId: created.id,
            organisationId,
            facilityId: assessment.facilityId,
            metricCode: metric.metricCode,
            metricName: metric.metricName,
            domainCode: metric.domainCode,
            numericValue: metric.numericValue,
            textValue: metric.textValue,
            unit: metric.unit,
            classification: metric.classification,
            sourceReference: metric.sourceReference,
            evidenceCount: metric.evidenceCount,
          },
        });
      }

      // The assessment becomes read-only: its answers are now the frozen
      // reference point, and editing them afterwards would break the hash.
      await tx.facilityAssessment.update({
        where: { id: assessmentId },
        data: { status: 'SEALED' },
      });

      // Day 0 on the facility itself, set once.
      if (sequence === 1) {
        await tx.facility.update({
          where: { id: assessment.facilityId },
          data: { baselineDate: new Date(input.asOfDate) },
        });
      }

      return created;
    });

    await this.audit.record({
      action: 'baseline.seal',
      entityType: 'baseline_snapshot',
      entityId: snapshot.id,
      facilityId: assessment.facilityId,
      newValue: {
        sequence,
        contentHash,
        metricCount: preview.metrics.length,
        gapCount: preview.gaps.length,
      },
      reason: input.notes,
      severity: 'CRITICAL',
    });

    return {
      ...snapshot,
      asOfDate: snapshot.asOfDate.toISOString().slice(0, 10),
      metricCount: preview.metrics.length,
      gaps: preview.gaps,
      warnings: preview.gate.warnings,
    };
  }

  async get(snapshotId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const snapshot = await this.prisma.baselineSnapshot.findFirst({
      where: { id: snapshotId, organisationId },
      select: {
        id: true,
        facilityId: true,
        sequence: true,
        label: true,
        asOfDate: true,
        sealedAt: true,
        sealedBy: true,
        contentHash: true,
        notes: true,
        metrics: {
          orderBy: { metricCode: 'asc' },
          select: {
            metricCode: true,
            metricName: true,
            domainCode: true,
            numericValue: true,
            textValue: true,
            unit: true,
            classification: true,
            sourceReference: true,
            evidenceCount: true,
          },
        },
      },
    });

    if (!snapshot || !facilityIds.includes(snapshot.facilityId)) {
      throw new NotFoundException('No such baseline, or it is not visible to you.');
    }

    const metrics: BaselineMetric[] = snapshot.metrics.map((metric) => ({
      ...metric,
      numericValue: metric.numericValue === null ? null : Number(metric.numericValue),
    }));

    // Verified on every read. A tampered baseline must be visible immediately,
    // not discovered during a partnership review two years later.
    const intact = verifyContentHash(
      snapshot.facilityId,
      snapshot.sequence,
      snapshot.asOfDate.toISOString().slice(0, 10),
      metrics,
      snapshot.contentHash,
    );

    return {
      ...snapshot,
      asOfDate: snapshot.asOfDate.toISOString().slice(0, 10),
      metrics,
      integrity: intact
        ? { intact: true as const }
        : {
            intact: false as const,
            message:
              'This baseline no longer matches the hash recorded when it was sealed. Its metrics have been altered since. Treat every comparison against it as unreliable and escalate immediately.',
          },
    };
  }

  async listForFacility(facilityId: string) {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const snapshots = await this.prisma.baselineSnapshot.findMany({
      where: { facilityId },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        sequence: true,
        label: true,
        asOfDate: true,
        sealedAt: true,
        contentHash: true,
        _count: { select: { metrics: true } },
      },
    });

    return snapshots.map((snapshot) => ({
      ...snapshot,
      asOfDate: snapshot.asOfDate.toISOString().slice(0, 10),
      metricCount: snapshot._count.metrics,
      isDayZero: snapshot.sequence === 1,
      _count: undefined,
    }));
  }

  /**
   * Attempting to modify a sealed baseline.
   *
   * There is no update method on this service, and the database refuses the
   * write regardless. This exists so the API can answer the attempt with an
   * explanation rather than a generic 500 from a trigger.
   */
  async rejectModification(snapshotId: string): Promise<never> {
    await this.get(snapshotId);
    throw new ConflictException(
      'A sealed baseline cannot be modified. It is the reference point for every comparison the system makes. ' +
        'If the facility has changed, run a follow-up assessment and seal a new snapshot — the original Day 0 is never replaced.',
    );
  }

  private async derive(assessmentId: string, facilityId: string) {
    const items = await this.prisma.assessmentResponse.findMany({
      where: { assessmentId, amendedBy: { none: {} } },
      select: {
        id: true,
        answer: true,
        notApplicable: true,
        classification: true,
        item: { select: { code: true } },
        _count: { select: { evidence: true } },
      },
    });

    const responses: SourceResponse[] = items.map((response) => ({
      itemCode: response.item.code,
      responseId: response.id,
      answer: response.answer,
      notApplicable: response.notApplicable,
      classification: response.classification,
      evidenceCount: response._count.evidence,
    }));

    void facilityId;
    return deriveMetrics(BASELINE_METRIC_SOURCES, responses);
  }

  private async loadAssessment(assessmentId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const assessment = await this.prisma.facilityAssessment.findFirst({
      where: { id: assessmentId, organisationId },
      select: { id: true, facilityId: true, status: true, completionPercent: true },
    });

    if (!assessment || !facilityIds.includes(assessment.facilityId)) {
      throw new NotFoundException('No such assessment, or it is not visible to you.');
    }

    return assessment;
  }
}
