import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateNeed, CreateRecommendation } from '@chc/contracts';

import { ReasonRequiredError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Needs and recommendations (spec §§17-18).
 *
 * The first two links of the chain this platform exists to keep intact:
 *
 *   finding -> need -> recommendation -> capex line -> budget -> spend
 *
 * Each link is a foreign key, so at any point someone can ask "why are we
 * spending this?" and follow it back to something an assessor actually
 * observed. A need with no finding is allowed but must say why; the database
 * enforces that, not just this service.
 */
@Injectable()
export class NeedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertFacilityVisible(facilityId: string): void {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }
  }

  // ---------------------------------------------------------------------------
  // Needs
  // ---------------------------------------------------------------------------

  async createNeed(input: CreateNeed) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    if (input.findingId) {
      const finding = await this.prisma.assessmentFinding.findFirst({
        where: { id: input.findingId, organisationId },
        select: { id: true, facilityId: true, reference: true },
      });

      if (!finding) {
        throw new NotFoundException('No such finding, or it is not visible to you.');
      }

      // A need at facility A citing a finding at facility B would read as
      // evidence for spending that nobody ever observed there.
      if (finding.facilityId !== input.facilityId) {
        throw new BadRequestException(
          `Finding ${finding.reference} was recorded at a different facility and cannot justify a need here.`,
        );
      }
    } else if (!input.unlinkedReason || input.unlinkedReason.trim().length < 10) {
      throw new ReasonRequiredError('Creating a need with no finding behind it');
    }

    const reference = await this.nextReference('need', input.facilityId, 'N');
    const context = tryGetContext();

    const need = await this.prisma.need.create({
      data: {
        id: input.id ?? randomUUID(),
        organisationId,
        facilityId: input.facilityId,
        findingId: input.findingId,
        reference,
        title: input.title,
        description: input.description,
        domainCode: input.domainCode,
        unlinkedReason: input.findingId ? undefined : input.unlinkedReason,
        createdBy: context?.userId,
      },
      select: { id: true, reference: true, title: true, findingId: true, createdAt: true },
    });

    await this.audit.record({
      action: 'planning.need.create',
      entityType: 'need',
      entityId: need.id,
      facilityId: input.facilityId,
      newValue: { reference, findingId: input.findingId ?? null },
      reason: input.findingId ? undefined : input.unlinkedReason,
    });

    return need;
  }

  /**
   * Every need with its provenance and what it has produced.
   *
   * `basis` is the honest answer to "where did this come from?" — either a
   * finding reference or the stated reason for having none. A reader should
   * never have to guess which.
   */
  async listNeeds(facilityId: string) {
    this.assertFacilityVisible(facilityId);

    const needs = await this.prisma.need.findMany({
      where: { facilityId },
      orderBy: { reference: 'asc' },
      select: {
        id: true,
        reference: true,
        title: true,
        description: true,
        domainCode: true,
        unlinkedReason: true,
        createdAt: true,
        finding: {
          select: { id: true, reference: true, title: true, severity: true, priorityClass: true },
        },
        recommendations: {
          orderBy: { reference: 'asc' },
          select: {
            id: true,
            reference: true,
            title: true,
            priorityClass: true,
            priorityScore: true,
            _count: { select: { capexLines: true } },
          },
        },
      },
    });

    return needs.map((need) => ({
      ...need,
      basis: need.finding
        ? { kind: 'FINDING' as const, reference: need.finding.reference, title: need.finding.title }
        : { kind: 'UNLINKED' as const, reason: need.unlinkedReason },
      recommendations: need.recommendations.map((recommendation) => ({
        ...recommendation,
        priorityScore: recommendation.priorityScore ? Number(recommendation.priorityScore) : null,
        capexLineCount: recommendation._count.capexLines,
        _count: undefined,
      })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Recommendations
  // ---------------------------------------------------------------------------

  /**
   * A recommendation inherits its priority from the finding that produced it.
   *
   * The finding's priority was computed from stated inputs and is auditable
   * (spec §18). Re-deciding it here, by hand, at one remove from the evidence,
   * would quietly discard that work — so an explicit priority is accepted but
   * recorded as the deliberate override it is.
   */
  async createRecommendation(input: CreateRecommendation) {
    const { organisationId } = getTenantScope();

    const need = await this.prisma.need.findFirst({
      where: { id: input.needId, organisationId },
      select: {
        id: true,
        facilityId: true,
        reference: true,
        finding: { select: { priorityClass: true, priorityScore: true } },
      },
    });

    if (!need) throw new NotFoundException('No such need, or it is not visible to you.');
    this.assertFacilityVisible(need.facilityId);

    const inherited = need.finding?.priorityClass;
    const priorityClass = input.priorityClass ?? inherited ?? 'P3';
    const overridesInherited = Boolean(input.priorityClass && inherited && input.priorityClass !== inherited);

    const reference = await this.nextReference('recommendation', need.facilityId, 'R');
    const context = tryGetContext();

    const recommendation = await this.prisma.recommendation.create({
      data: {
        id: input.id ?? randomUUID(),
        needId: need.id,
        organisationId,
        facilityId: need.facilityId,
        reference,
        title: input.title,
        description: input.description,
        expectedOutcome: input.expectedOutcome,
        priorityClass,
        // Carried across only when the priority is the inherited one — a
        // hand-set class has no computed score behind it, and showing one
        // would misrepresent where the number came from.
        priorityScore: overridesInherited || input.priorityClass ? null : need.finding?.priorityScore,
        priorityInputs: inherited
          ? ({ source: 'finding', needReference: need.reference, inheritedClass: inherited } as never)
          : ({ source: 'manual', needReference: need.reference } as never),
        createdBy: context?.userId,
      },
      select: { id: true, reference: true, title: true, priorityClass: true, needId: true },
    });

    await this.audit.record({
      action: 'planning.recommendation.create',
      entityType: 'recommendation',
      entityId: recommendation.id,
      facilityId: need.facilityId,
      newValue: { reference, priorityClass, inherited: inherited ?? null, overridesInherited },
    });

    return recommendation;
  }

  /**
   * Next human reference for a facility-scoped record.
   *
   * A count is adequate here and deliberately simple: references are for
   * humans reading a printed plan, and the database's unique constraint is
   * what actually guarantees no two records collide. A concurrent insert fails
   * that constraint and is retried rather than silently duplicating.
   */
  private async nextReference(
    entity: 'need' | 'recommendation',
    facilityId: string,
    prefix: string,
  ): Promise<string> {
    const count =
      entity === 'need'
        ? await this.prisma.need.count({ where: { facilityId } })
        : await this.prisma.recommendation.count({ where: { facilityId } });

    return `${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
}
