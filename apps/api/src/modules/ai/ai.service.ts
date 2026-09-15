import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AiAsk, AiReview, Permission } from '@chc/contracts';

import type { Env } from '../../config/env';
import type { MetricQueryParams } from '../../common/metric-query';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DASHBOARD_FIGURES } from '../analytics/dashboard-queries';
import { AuditService } from '../audit/audit.service';

import { buildEnvelope, hashPrompt } from './domain/context';
import { noApprovedQuery, validateGrounding } from './domain/grounding';
import type { LlmProvider } from './llm-provider';

/**
 * The grounded generation pipeline (doc 17 §4, spec §53).
 *
 *   1 INTENT      the question is matched to a named capability
 *   2 AUTHORISE   the caller's own permissions and tenant scope are applied
 *   3 RETRIEVE    pre-approved queries run — never model-generated SQL
 *   4 CONTEXT     a compact, sanitised JSON context is built and hashed
 *   5 PROMPT      system prompt + boundaries + question
 *   6 GENERATE    the provider is called
 *   7 VALIDATE    every figure in the output must appear in the context
 *   8 LABEL       persisted as AI_GENERATED with its full provenance
 *   9 PRESENT     returned with the source figures beside it
 *
 * Step 3 is the one that matters most. The model never writes SQL. Text to SQL
 * against a clinical and financial database produces a confident, plausible,
 * wrong number from a subtly wrong join, and nobody catches it.
 *
 * Step 7 is the backstop for everything step 3 misses. A response containing a
 * figure not present in the retrieved context is discarded, not shown, and
 * recorded as a grounding failure.
 */

/**
 * The capabilities a question can be routed to.
 *
 * Each names the dashboard figures that ground it and the permission the caller
 * must hold. A question that matches none of them gets the refusal, not an
 * attempt.
 */
interface Capability {
  id: string;
  /** What a person might ask, for the refusal message's list of alternatives. */
  question: string;
  keywords: readonly string[];
  figureKeys: readonly string[];
  permission: Permission;
  insightType: 'SUMMARY' | 'ANSWER' | 'DATA_GAP';
  /**
   * Whether this capability puts free text people wrote into the context.
   *
   * Only the quality capability does, because what went wrong is a sentence
   * and not a count. That text is sanitised on the way in and is the reason
   * the injection defence exists at all.
   */
  includesFreeText?: boolean;
}

const CAPABILITIES: readonly Capability[] = [
  {
    id: 'ai/period_summary@v1',
    question: 'How did the facility do this period?',
    keywords: ['summary', 'summarise', 'how did', 'overview', 'performance', 'this month', 'period'],
    figureKeys: ['encounters', 'revenue_collected', 'billed', 'outstanding', 'waived'],
    permission: 'analytics.read',
    insightType: 'SUMMARY',
  },
  {
    id: 'ai/clinical_activity@v1',
    question: 'What clinical activity was recorded, and what is unfinished?',
    keywords: ['encounter', 'patients seen', 'clinical', 'documentation', 'diagnosis', 'unfinished'],
    figureKeys: ['encounters', 'encounters_open', 'undocumented_encounters'],
    permission: 'clinical.read',
    insightType: 'ANSWER',
  },
  {
    id: 'ai/money@v1',
    question: 'What was collected, what is owed, and what was waived?',
    keywords: ['revenue', 'money', 'collected', 'owed', 'outstanding', 'waiver', 'waived', 'income'],
    figureKeys: ['revenue_collected', 'billed', 'outstanding', 'waived'],
    permission: 'finance.read',
    insightType: 'ANSWER',
  },
  {
    id: 'ai/supply@v1',
    question: 'What has run out, and what is about to expire?',
    keywords: ['stock', 'supply', 'expiry', 'expiring', 'run out', 'stockout', 'medicine'],
    figureKeys: ['stock_out_items', 'expiring_batches'],
    permission: 'inventory.read',
    insightType: 'ANSWER',
  },
  {
    id: 'ai/quality@v1',
    question: 'What went wrong, and what was done about it?',
    keywords: ['incident', 'complaint', 'safety', 'quality', 'action', 'overdue'],
    figureKeys: ['incidents_open', 'actions_overdue', 'complaints_open'],
    permission: 'quality.read',
    insightType: 'ANSWER',
    includesFreeText: true,
  },
  {
    id: 'ai/implementation@v1',
    question: 'What did the money buy, and is it in use?',
    keywords: ['project', 'capital', 'asset', 'equipment', 'commission', 'spent', 'implementation'],
    figureKeys: ['capital_spent', 'assets_not_commissioned'],
    permission: 'project.read',
    insightType: 'ANSWER',
  },
];

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly provider: LlmProvider,
  ) {}

  private now(): Date {
    return new Date();
  }

  /**
   * The kill switch (doc 17 §10).
   *
   * Every AI path checks this first. With AI off the platform is fully
   * functional and this layer answers with a plain statement rather than an
   * error somebody has to interpret — which is the clearest possible statement
   * of where the truth lives.
   */
  private assertEnabled(): void {
    if (!this.env.AI_ENABLED) {
      throw new ServiceUnavailableException(
        'The AI layer is switched off for this deployment. Every other feature works without it: the ' +
          'dashboards, the lineage walk and the reports all compute from the records directly. Nothing ' +
          'here is required to run the facility.',
      );
    }
  }

  private held(): ReadonlySet<Permission> {
    return tryGetContext()?.permissions ?? new Set<Permission>();
  }

  private assertFacilityVisible(facilityId: string): void {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }
  }

  /** What this layer is, and what it may be asked. */
  status() {
    return {
      enabled: this.env.AI_ENABLED,
      provider: this.env.AI_ENABLED ? this.provider.id : null,
      modelId: this.env.AI_ENABLED ? this.provider.modelId : null,
      note: this.env.AI_ENABLED
        ? 'Answers are composed only from figures returned by the approved queries below. A response ' +
          'containing any other figure is discarded before anybody sees it.'
        : 'Switched off. Nothing else in the platform depends on this layer.',
      capabilities: CAPABILITIES.map((capability) => ({
        id: capability.id,
        question: capability.question,
        grounds: capability.figureKeys,
        permission: capability.permission,
      })),
      guarantees: [
        'The model never writes SQL. Questions route to reviewed, version-controlled queries.',
        'Every figure in an answer must appear in the retrieved data, or the answer is discarded.',
        'Free text from records is delivered as data inside boundaries, never as instruction.',
        'The AI role holds no write permission on any table. It cannot alter a record by any path.',
        'Every insight is stored with its model, prompt hash, source queries and context hash.',
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // The pipeline
  // ---------------------------------------------------------------------------

  async ask(input: AiAsk) {
    this.assertEnabled();

    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    // 1 — INTENT.
    const capability = this.route(input.question, input.capabilityId);

    if (!capability) {
      const available = CAPABILITIES.filter((candidate) =>
        this.held().has(candidate.permission),
      ).map((candidate) => candidate.question);

      await this.audit.record({
        action: 'ai.refuse',
        entityType: 'ai_insight',
        facilityId: input.facilityId,
        outcome: 'DENIED',
        newValue: { question: input.question.slice(0, 200), reason: 'no-approved-query' },
      });

      return {
        answered: false as const,
        content: noApprovedQuery(input.question, available),
        reason: 'no-approved-query',
        classification: 'AI_GENERATED' as const,
      };
    }

    // 2 — AUTHORISE. The caller's own permissions, not the AI's.
    if (!this.held().has(capability.permission)) {
      throw new ForbiddenException(
        `Answering that requires ${capability.permission}, which you do not hold. The AI layer cannot ` +
          'see anything you cannot see.',
      );
    }

    // 3 — RETRIEVE. Named queries only.
    const params: MetricQueryParams = {
      organisationId,
      facilityId: input.facilityId,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      now: this.now(),
    };

    const facility = await this.prisma.facility.findFirst({
      where: { id: input.facilityId },
      select: { name: true, code: true },
    });

    const figures = [];
    const queryIds: string[] = [];

    for (const key of capability.figureKeys) {
      const query = DASHBOARD_FIGURES.get(key);
      if (!query) continue;
      if (!this.held().has(query.permission as Permission)) continue;

      const outcome = await query.compute(this.prisma, params);
      queryIds.push(query.sourceQueryId);

      figures.push({
        key,
        label: query.label,
        value: outcome.value,
        unit: query.unit,
        definition: query.definition,
        sampleSize: outcome.sampleSize,
        note: outcome.note ?? null,
        classification: query.classification,
      });
    }

    if (figures.length === 0) {
      return {
        answered: false as const,
        content:
          'None of the queries behind that question are within your permissions, so there is nothing ' +
          'I can retrieve to answer it from.',
        reason: 'no-readable-figures',
        classification: 'AI_GENERATED' as const,
      };
    }

    // Free text, where the capability needs it. Sanitised by buildEnvelope
    // below, which is where the injection defence lives.
    const subjects = capability.includesFreeText
      ? await this.recentSubjects(input.facilityId)
      : undefined;

    // 4 & 5 — CONTEXT and PROMPT.
    const envelope = buildEnvelope({
      question: input.question,
      context: {
        facility: facility?.name ?? 'this facility',
        period: { from: input.periodStart, to: input.periodEnd },
        figures,
        ...(subjects ? { recentSubjects: subjects } : {}),
      },
      queryIds,
    });

    // 6 — GENERATE.
    let generated;
    try {
      generated = await this.provider.generate({
        prompt: envelope.prompt,
        context: envelope.context,
        maxTokens: this.env.AI_MAX_OUTPUT_TOKENS,
      });
    } catch (error) {
      this.logger.error(`AI provider failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'The model could not be reached. Nothing else is affected: every figure this answer would have ' +
          'used is on the dashboard already, computed from the records.',
      );
    }

    // 7 — VALIDATE. The backstop.
    const grounding = validateGrounding(generated.content, envelope.context, {
      // The period the caller themselves supplied. Its dates are in the
      // context, so they need no exception; nothing else is allowed one.
      allowedValues: [],
    });

    if (!grounding.ok) {
      await this.audit.record({
        action: 'ai.grounding_failure',
        entityType: 'ai_insight',
        facilityId: input.facilityId,
        outcome: 'FAILURE',
        severity: 'WARNING',
        newValue: {
          capability: capability.id,
          modelId: generated.modelId,
          offending: grounding.offending.map((failure) => failure.token),
          offendingDates: grounding.offendingDates,
          // The discarded text is kept in the audit trail. Somebody has to be
          // able to see what the model tried to say.
          discarded: generated.content.slice(0, 2000),
        },
      });

      return {
        answered: false as const,
        content:
          'The model produced an answer containing figures that are not in the retrieved data, so it ' +
          'has been discarded rather than shown. The figures it should have used are below.',
        reason: 'grounding-failure',
        classification: 'AI_GENERATED' as const,
        rejectedFigures: grounding.offending.map((failure) => failure.token),
        figures,
      };
    }

    // 8 — LABEL.
    const context = tryGetContext();
    const insight = await this.prisma.aiInsight.create({
      data: {
        id: randomUUID(),
        organisationId,
        facilityId: input.facilityId,
        insightType: capability.insightType,
        subjectType: 'facility',
        subjectId: input.facilityId,
        content: generated.content,
        classification: 'AI_GENERATED',
        modelId: generated.modelId,
        modelVersion: generated.modelVersion,
        promptHash: hashPrompt(envelope.prompt),
        contextQueryIds: queryIds,
        contextHash: envelope.contextHash,
        // Null unless statistically derived. A model's own sense of how sure it
        // is has never been a measurement (doc 17 §6).
        confidence: null,
        tokenUsage: generated.tokenUsage ?? undefined,
        generatedBy: context?.userId,
      },
      select: { id: true, generatedAt: true, reviewOutcome: true },
    });

    await this.audit.record({
      action: 'ai.generate',
      entityType: 'ai_insight',
      entityId: insight.id,
      facilityId: input.facilityId,
      newValue: {
        capability: capability.id,
        modelId: generated.modelId,
        queries: queryIds,
        figuresChecked: grounding.checked.length,
      },
    });

    // 9 — PRESENT.
    return {
      answered: true as const,
      insightId: insight.id,
      content: generated.content,
      classification: 'AI_GENERATED' as const,
      label: 'AI-GENERATED ANALYSIS — not a system record',
      capability: capability.id,
      modelId: generated.modelId,
      languageModelUsed: generated.languageModelUsed,
      generatedAt: insight.generatedAt.toISOString(),
      groundedIn: queryIds,
      contextHash: envelope.contextHash,
      figuresChecked: grounding.checked.length,
      sanitisationNotes: envelope.sanitisationNotes,
      // The source figures travel with the answer, so "verify" is a glance
      // rather than a journey.
      figures,
      reviewOutcome: insight.reviewOutcome,
    };
  }

  /**
   * Short free-text labels from the quality register.
   *
   * Subjects and types only — never the body of a complaint or the description
   * of an incident, both of which routinely name a patient or a member of
   * staff. Even these go through the sanitiser, because a subject line is
   * still something a person typed.
   */
  private async recentSubjects(facilityId: string) {
    const [complaints, incidents] = await Promise.all([
      this.prisma.complaint.findMany({
        where: { facilityId },
        orderBy: { receivedAt: 'desc' },
        take: 10,
        select: { reference: true, subject: true, status: true },
      }),
      this.prisma.incident.findMany({
        where: { facilityId },
        orderBy: { occurredAt: 'desc' },
        take: 10,
        select: { reference: true, incidentType: true, severity: true, status: true },
      }),
    ]);

    return {
      complaints: complaints.map((complaint) => ({
        reference: complaint.reference,
        subject: complaint.subject,
        status: complaint.status,
      })),
      incidents: incidents.map((incident) => ({
        reference: incident.reference,
        type: incident.incidentType,
        severity: incident.severity,
        status: incident.status,
      })),
    };
  }

  /**
   * Route a question to an approved capability.
   *
   * Deliberately crude keyword matching, and deliberately willing to fail. A
   * cleverer router that always finds something would answer the wrong
   * question confidently, which is the failure mode this whole layer is built
   * to avoid.
   */
  private route(question: string, capabilityId?: string): Capability | null {
    if (capabilityId) {
      return CAPABILITIES.find((capability) => capability.id === capabilityId) ?? null;
    }

    const text = question.toLowerCase();

    const scored = CAPABILITIES.map((capability) => ({
      capability,
      score: capability.keywords.filter((keyword) => text.includes(keyword)).length,
    })).filter((entry) => entry.score > 0);

    if (scored.length === 0) return null;

    scored.sort((a, b) => b.score - a.score);
    return scored[0].capability;
  }

  // ---------------------------------------------------------------------------
  // Review and history
  // ---------------------------------------------------------------------------

  async list(facilityId: string) {
    this.assertFacilityVisible(facilityId);

    const insights = await this.prisma.aiInsight.findMany({
      where: { facilityId },
      orderBy: { generatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        insightType: true,
        content: true,
        classification: true,
        modelId: true,
        modelVersion: true,
        contextQueryIds: true,
        contextHash: true,
        promptHash: true,
        confidence: true,
        generatedAt: true,
        generatedBy: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewOutcome: true,
      },
    });

    return {
      label: 'AI-GENERATED ANALYSIS — not a system record',
      note:
        'Each of these was composed from named queries over this facility’s records. The model, the ' +
        'prompt hash, the queries and a hash of the data it saw are stored with it, so a disputed ' +
        'statement can be re-examined months later.',
      insights: insights.map((insight) => ({
        ...insight,
        confidence: insight.confidence === null ? null : Number(insight.confidence),
        generatedAt: insight.generatedAt.toISOString(),
      })),
    };
  }

  /**
   * Record a human judgement on an insight.
   *
   * The point is not the flag; it is that somebody looked. A layer whose output
   * nobody ever reviews is a layer nobody is checking, and the review outcomes
   * are themselves a reportable figure.
   */
  async review(input: AiReview) {
    this.assertEnabled();

    const { facilityIds } = getTenantScope();

    const insight = await this.prisma.aiInsight.findFirst({
      where: { id: input.insightId, facilityId: { in: [...facilityIds] } },
      select: { id: true, facilityId: true, reviewOutcome: true, generatedBy: true },
    });

    if (!insight) throw new NotFoundException('No such insight, or it is not visible to you.');

    if (insight.reviewOutcome !== 'PENDING') {
      throw new BadRequestException(
        `This insight was already reviewed as ${insight.reviewOutcome.toLowerCase()}. Reviewing it ` +
          'again would overwrite somebody’s judgement.',
      );
    }

    const context = tryGetContext();

    const reviewed = await this.prisma.aiInsight.update({
      where: { id: insight.id },
      data: {
        reviewOutcome: input.outcome,
        reviewedBy: context?.userId,
        reviewedAt: this.now(),
      },
      select: { id: true, reviewOutcome: true, reviewedAt: true },
    });

    await this.audit.record({
      action: 'ai.review',
      entityType: 'ai_insight',
      entityId: insight.id,
      facilityId: insight.facilityId ?? undefined,
      oldValue: { reviewOutcome: 'PENDING' },
      newValue: { reviewOutcome: input.outcome, note: input.note },
      severity: input.outcome === 'REJECTED' ? 'WARNING' : 'INFO',
    });

    return reviewed;
  }
}
