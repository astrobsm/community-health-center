import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AssessmentProgress,
  CreateAssessment,
  CreateFinding,
  ReadinessScore,
  SaveResponse,
  ScoringRule,
} from '@chc/contracts';

import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';

import { computeProgress, evaluateSubmission, type ProgressItem, type ProgressResponse } from './domain/completion';
import {
  DEFAULT_PRIORITY_BANDS,
  DEFAULT_PRIORITY_WEIGHTS,
  computePriority,
  resolvePriority,
} from './domain/prioritisation';
import { computeReadiness, type ScoreableItem, type ScoreableResponse } from './domain/scoring';

@Injectable()
export class AssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private now(): Date {
    return new Date();
  }

  async create(input: CreateAssessment) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(input.facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const template = await this.prisma.assessmentTemplate.findUnique({
      where: { code: input.templateCode },
      select: {
        id: true,
        name: true,
        versions: {
          where: { status: 'PUBLISHED' },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { id: true, versionNumber: true },
        },
      },
    });

    const version = template?.versions[0];
    if (!template || !version) {
      throw new NotFoundException(
        `No published version of template "${input.templateCode}". Run the reference-data seed.`,
      );
    }

    const context = tryGetContext();

    const assessment = await this.prisma.facilityAssessment.create({
      data: {
        // The client may supply the id so the record has its identity before it
        // ever reaches us — essential for offline capture.
        id: input.id ?? randomUUID(),
        facilityId: input.facilityId,
        organisationId,
        // Pinning the VERSION, not the template: a response must always be
        // interpretable against the exact instrument used to capture it.
        templateVersionId: version.id,
        assessmentType: input.assessmentType,
        status: 'DRAFT',
        title: input.title ?? `${template.name} — ${new Date().toISOString().slice(0, 10)}`,
        startedAt: this.now(),
        leadAssessorId: input.leadAssessorId ?? context?.userId,
        createdBy: context?.userId,
      },
      select: { id: true, title: true, status: true, assessmentType: true, startedAt: true },
    });

    await this.audit.record({
      action: 'assessment.create',
      entityType: 'facility_assessment',
      entityId: assessment.id,
      facilityId: input.facilityId,
      newValue: { assessmentType: input.assessmentType, templateVersion: version.versionNumber },
    });

    return assessment;
  }

  /** The full instrument plus any answers so far — what the field app renders. */
  async getWithTemplate(assessmentId: string) {
    const assessment = await this.load(assessmentId);

    const sections = await this.prisma.assessmentSection.findMany({
      where: { templateVersionId: assessment.templateVersionId },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        sequence: true,
        weight: true,
        items: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            code: true,
            question: true,
            helpText: true,
            responseType: true,
            options: true,
            unit: true,
            sequence: true,
            weight: true,
            isRequired: true,
            evidenceRequired: true,
          },
        },
      },
    });

    const responses = await this.prisma.assessmentResponse.findMany({
      where: { assessmentId, amendedBy: { none: {} } },
      select: {
        id: true,
        itemId: true,
        answer: true,
        note: true,
        classification: true,
        isVerified: true,
        score: true,
        updatedAt: true,
        evidence: { select: { evidenceId: true } },
      },
    });

    return {
      assessment: {
        id: assessment.id,
        facilityId: assessment.facilityId,
        assessmentType: assessment.assessmentType,
        status: assessment.status,
        title: assessment.title,
        completionPercent: Number(assessment.completionPercent),
        startedAt: assessment.startedAt,
        submittedAt: assessment.submittedAt,
      },
      sections: sections.map((section) => ({
        ...section,
        weight: Number(section.weight),
        items: section.items.map((item) => ({ ...item, weight: Number(item.weight) })),
      })),
      responses: responses.map((response) => ({
        id: response.id,
        itemId: response.itemId,
        answer: response.answer,
        note: response.note,
        classification: response.classification,
        isVerified: response.isVerified,
        evidenceIds: response.evidence.map((e) => e.evidenceId),
        updatedAt: response.updatedAt,
      })),
    };
  }

  /**
   * Save a batch of answers.
   *
   * Batched because a field device draining its outbox sends many at once, and
   * because one rejected answer must not block the rest of a day's work.
   *
   * An existing answer is AMENDED, not overwritten: the original row is
   * retained and the new one points back at it, so a change of mind in the
   * field is visible rather than silent.
   */
  async saveResponses(assessmentId: string, responses: SaveResponse[]) {
    const assessment = await this.load(assessmentId);

    if (assessment.status === 'SEALED') {
      throw new ConflictException(
        'This assessment has been sealed into a baseline and can no longer be edited. Start a follow-up assessment instead.',
      );
    }

    const validItemIds = new Set(
      (
        await this.prisma.assessmentItem.findMany({
          where: { section: { templateVersionId: assessment.templateVersionId } },
          select: { id: true },
        })
      ).map((item) => item.id),
    );

    const context = tryGetContext();
    const results: Array<{ id: string; status: 'saved' | 'amended' | 'rejected'; reason?: string }> = [];

    for (const response of responses) {
      if (!validItemIds.has(response.itemId)) {
        results.push({
          id: response.id,
          status: 'rejected',
          reason: 'That item does not belong to this assessment\'s template version.',
        });
        continue;
      }

      try {
        const existing = await this.prisma.assessmentResponse.findFirst({
          where: { assessmentId, itemId: response.itemId, amendedBy: { none: {} } },
          select: { id: true, answer: true, version: true },
        });

        const data = {
          assessmentId,
          itemId: response.itemId,
          organisationId: assessment.organisationId,
          facilityId: assessment.facilityId,
          // Omitted rather than set to null: Prisma requires DbNull for a
          // nullable Json column, and an omitted field lands as SQL NULL.
          answer: response.notApplicable ? undefined : (response.answer as never),
          notApplicable: response.notApplicable,
          note: response.note,
          classification: response.classification,
          deviceId: response.deviceId ?? context?.deviceId,
          deviceCreatedAt: response.deviceCreatedAt ? new Date(response.deviceCreatedAt) : undefined,
          createdBy: context?.userId,
        };

        if (existing) {
          const created = await this.prisma.assessmentResponse.create({
            data: { ...data, id: response.id, amendsId: existing.id, amendmentReason: 'Answer revised in the field.' },
            select: { id: true },
          });
          await this.linkEvidence(created.id, response.evidenceIds);
          results.push({ id: response.id, status: 'amended' });
        } else {
          const created = await this.prisma.assessmentResponse.create({
            data: { ...data, id: response.id },
            select: { id: true },
          });
          await this.linkEvidence(created.id, response.evidenceIds);
          results.push({ id: response.id, status: 'saved' });
        }
      } catch (error) {
        // One bad record must not strand the other forty-nine (doc 10 §3).
        results.push({ id: response.id, status: 'rejected', reason: (error as Error).message });
      }
    }

    await this.refreshCompletion(assessmentId);

    return { results, progress: await this.progress(assessmentId) };
  }

  private async linkEvidence(responseId: string, evidenceIds: string[]): Promise<void> {
    for (const evidenceId of evidenceIds) {
      await this.prisma.assessmentEvidence.upsert({
        where: { responseId_evidenceId: { responseId, evidenceId } },
        create: { responseId, evidenceId, linkedBy: tryGetContext()?.userId },
        update: {},
      });
    }
  }

  async progress(assessmentId: string): Promise<AssessmentProgress> {
    const assessment = await this.load(assessmentId);

    const items = await this.prisma.assessmentItem.findMany({
      where: { section: { templateVersionId: assessment.templateVersionId } },
      select: {
        id: true,
        isRequired: true,
        evidenceRequired: true,
        section: { select: { id: true, code: true, name: true, sequence: true } },
      },
    });

    const responses = await this.prisma.assessmentResponse.findMany({
      where: { assessmentId, amendedBy: { none: {} } },
      select: { itemId: true, answer: true, notApplicable: true, _count: { select: { evidence: true } } },
    });

    const progressItems: ProgressItem[] = items.map((item) => ({
      itemId: item.id,
      sectionId: item.section.id,
      sectionCode: item.section.code,
      sectionName: item.section.name,
      sectionSequence: item.section.sequence,
      isRequired: item.isRequired,
      evidenceRequired: item.evidenceRequired,
    }));

    const progressResponses: ProgressResponse[] = responses.map((response) => ({
      itemId: response.itemId,
      answered: response.answer !== null && response.answer !== undefined,
      notApplicable: response.notApplicable,
      evidenceCount: response._count.evidence,
    }));

    return computeProgress(assessmentId, progressItems, progressResponses, this.now());
  }

  /** Facility condition index (spec §17). Computed on demand, never stored raw. */
  async readiness(assessmentId: string): Promise<ReadinessScore> {
    const assessment = await this.load(assessmentId);

    const items = await this.prisma.assessmentItem.findMany({
      where: { section: { templateVersionId: assessment.templateVersionId } },
      select: {
        id: true,
        weight: true,
        scoringRule: true,
        responseType: true,
        options: true,
        section: { select: { code: true, name: true, weight: true } },
      },
    });

    const responses = await this.prisma.assessmentResponse.findMany({
      where: { assessmentId, amendedBy: { none: {} } },
      select: { itemId: true, answer: true, notApplicable: true },
    });

    const scoreableItems: ScoreableItem[] = items.map((item) => ({
      itemId: item.id,
      sectionCode: item.section.code,
      sectionName: item.section.name,
      sectionWeight: Number(item.section.weight),
      itemWeight: Number(item.weight),
      scoringRule: this.resolveScoringRule(item),
    }));

    const scoreableResponses: ScoreableResponse[] = responses.map((response) => ({
      itemId: response.itemId,
      answer: response.answer as ScoreableResponse['answer'],
      notApplicable: response.notApplicable,
    }));

    const score = computeReadiness(scoreableItems, scoreableResponses, this.now());

    await this.persistScores(assessment, score);
    return score;
  }

  /**
   * An item's explicit scoring rule, or a sensible default derived from its
   * response type.
   *
   * Deriving a default means a template author does not have to write a rule
   * for every yes/no question — but TEXT and DATE deliberately fall through to
   * NOT_SCORED rather than being forced into a number.
   */
  private resolveScoringRule(item: {
    scoringRule: unknown;
    responseType: string;
    options: unknown;
  }): ScoringRule | null {
    if (item.scoringRule) return item.scoringRule as ScoringRule;

    switch (item.responseType) {
      case 'BOOLEAN':
        return { kind: 'BOOLEAN', trueScore: 1 };
      case 'SCALE': {
        const options = item.options as { min?: number; max?: number } | null;
        if (typeof options?.min === 'number' && typeof options?.max === 'number') {
          return { kind: 'SCALE', min: options.min, max: options.max, inverted: false };
        }
        return { kind: 'NOT_SCORED' };
      }
      default:
        // NUMBER has no defensible default target, and a count without one
        // would be scored against a number nobody chose.
        return { kind: 'NOT_SCORED' };
    }
  }

  private async persistScores(
    assessment: { id: string; organisationId: string; facilityId: string },
    score: ReadinessScore,
  ): Promise<void> {
    for (const domain of score.domains) {
      await this.prisma.assessmentScore.upsert({
        where: { assessmentId_domainCode: { assessmentId: assessment.id, domainCode: domain.domainCode } },
        create: {
          assessmentId: assessment.id,
          organisationId: assessment.organisationId,
          facilityId: assessment.facilityId,
          domainCode: domain.domainCode,
          rawScore: domain.rawScore,
          maxScore: domain.maxScore,
          weight: domain.weight,
          normalisedScore: domain.normalisedScore ?? 0,
          excludedItemCount: domain.excludedItems,
        },
        update: {
          rawScore: domain.rawScore,
          maxScore: domain.maxScore,
          normalisedScore: domain.normalisedScore ?? 0,
          excludedItemCount: domain.excludedItems,
          computedAt: this.now(),
        },
      });
    }
  }

  async submit(assessmentId: string, options: { acknowledgeIncomplete: boolean; note?: string }) {
    const assessment = await this.load(assessmentId);

    if (assessment.status !== 'DRAFT' && assessment.status !== 'IN_PROGRESS') {
      throw new ConflictException(`This assessment is already ${assessment.status}.`);
    }

    const progress = await this.progress(assessmentId);
    const minimum = await this.config.number(
      'assessment.minimumCompletionPercent',
      80,
      assessment.facilityId,
    );

    const gate = evaluateSubmission(progress, {
      minimumCompletionPercent: minimum,
      acknowledgedIncomplete: options.acknowledgeIncomplete,
    });

    if (!gate.canSubmit) {
      throw new BadRequestException(gate.blockers.join(' '));
    }

    const context = tryGetContext();

    const updated = await this.prisma.facilityAssessment.update({
      where: { id: assessmentId },
      data: {
        status: 'SUBMITTED',
        submittedAt: this.now(),
        submittedBy: context?.userId,
        completionPercent: progress.completionPercent,
        notes: options.note,
      },
      select: { id: true, status: true, submittedAt: true, completionPercent: true },
    });

    await this.audit.record({
      action: 'assessment.submit',
      entityType: 'facility_assessment',
      entityId: assessmentId,
      facilityId: assessment.facilityId,
      newValue: { completionPercent: progress.completionPercent, warnings: gate.warnings },
      reason: options.note,
      severity: 'NOTICE',
    });

    return { ...updated, completionPercent: Number(updated.completionPercent), warnings: gate.warnings };
  }

  /**
   * Raise a finding.
   *
   * The priority score is computed from its inputs and both are stored, so a
   * later reviewer sees the argument and not just the conclusion (spec §18).
   */
  async createFinding(input: CreateFinding) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(input.facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const weights = await this.config.json('findings.priorityWeights', DEFAULT_PRIORITY_WEIGHTS, input.facilityId);
    const bands = await this.config.json('findings.priorityBands', DEFAULT_PRIORITY_BANDS, input.facilityId);

    const computed = input.priorityInputs
      ? computePriority(input.priorityInputs, weights, bands)
      : null;

    let priorityClass = computed?.computedClass ?? 'P3';
    let overridden = false;

    if (computed && input.priorityOverride) {
      try {
        const resolved = resolvePriority(computed, {
          priorityClass: input.priorityOverride,
          reason: input.priorityOverrideReason,
        });
        priorityClass = resolved.priorityClass;
        overridden = resolved.overridden;
      } catch (error) {
        // The domain layer refuses an unjustified override. That is a caller
        // error, not a server fault, and must read as one.
        throw new BadRequestException((error as Error).message);
      }
    } else if (!computed && input.priorityOverride) {
      // No inputs to compute from, so the human's judgement is all there is —
      // and it still needs a reason.
      if (!input.priorityOverrideReason || input.priorityOverrideReason.trim().length < 10) {
        throw new BadRequestException(
          'Setting a priority without the scoring inputs requires a reason of at least 10 characters.',
        );
      }
      priorityClass = input.priorityOverride;
      overridden = true;
    }

    const reference = await this.nextFindingReference(input.facilityId);
    const context = tryGetContext();

    const finding = await this.prisma.assessmentFinding.create({
      data: {
        id: input.id ?? randomUUID(),
        responseId: input.responseId,
        organisationId,
        facilityId: input.facilityId,
        reference,
        title: input.title,
        description: input.description,
        severity: input.severity,
        priorityClass,
        priorityScore: computed?.score,
        priorityInputs: computed
          ? ({ inputs: input.priorityInputs, contributions: computed.contributions, weights, bands } as never)
          : undefined,
        priorityOverrideReason: overridden ? input.priorityOverrideReason : undefined,
        estimatedCostMinor: input.estimatedCostMinor !== undefined ? BigInt(input.estimatedCostMinor) : undefined,
        // A cost with no quotation behind it is an estimate, and says so.
        costClassification: 'ESTIMATED',
        recommendationText: input.recommendationText,
        createdBy: context?.userId,
      },
      select: { id: true, reference: true, title: true, priorityClass: true, priorityScore: true },
    });

    for (const evidenceId of input.evidenceIds) {
      await this.prisma.findingEvidence.upsert({
        where: { findingId_evidenceId: { findingId: finding.id, evidenceId } },
        create: { findingId: finding.id, evidenceId, linkedBy: context?.userId },
        update: {},
      });
    }

    await this.audit.record({
      action: 'assessment.finding.create',
      entityType: 'assessment_finding',
      entityId: finding.id,
      facilityId: input.facilityId,
      newValue: { reference, priorityClass, overridden },
      reason: overridden ? input.priorityOverrideReason : undefined,
    });

    return { ...finding, priorityScore: finding.priorityScore ? Number(finding.priorityScore) : null };
  }

  async listFindings(facilityId: string) {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const findings = await this.prisma.assessmentFinding.findMany({
      where: { facilityId },
      orderBy: [{ priorityClass: 'asc' }, { priorityScore: 'desc' }],
      select: {
        id: true,
        reference: true,
        title: true,
        description: true,
        severity: true,
        priorityClass: true,
        priorityScore: true,
        estimatedCostMinor: true,
        costClassification: true,
        recommendationText: true,
        createdAt: true,
        _count: { select: { evidence: true, needs: true } },
      },
    });

    return findings.map((finding) => ({
      ...finding,
      priorityScore: finding.priorityScore ? Number(finding.priorityScore) : null,
      estimatedCost: finding.estimatedCostMinor
        ? {
            amountMinor: finding.estimatedCostMinor.toString(),
            currency: 'NGN',
            classification: finding.costClassification,
          }
        : null,
      estimatedCostMinor: undefined,
    }));
  }

  private async nextFindingReference(facilityId: string): Promise<string> {
    const count = await this.prisma.assessmentFinding.count({ where: { facilityId } });
    return `F-${String(count + 1).padStart(4, '0')}`;
  }

  private async refreshCompletion(assessmentId: string): Promise<void> {
    const progress = await this.progress(assessmentId);

    await this.prisma.facilityAssessment.update({
      where: { id: assessmentId },
      data: {
        completionPercent: progress.completionPercent,
        status: progress.answeredRequired > 0 ? 'IN_PROGRESS' : undefined,
      },
    });
  }

  private async load(assessmentId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const assessment = await this.prisma.facilityAssessment.findFirst({
      where: { id: assessmentId, organisationId },
      select: {
        id: true,
        facilityId: true,
        organisationId: true,
        templateVersionId: true,
        assessmentType: true,
        status: true,
        title: true,
        completionPercent: true,
        startedAt: true,
        submittedAt: true,
      },
    });

    if (!assessment || !facilityIds.includes(assessment.facilityId)) {
      throw new NotFoundException('No such assessment, or it is not visible to you.');
    }

    return assessment;
  }
}
