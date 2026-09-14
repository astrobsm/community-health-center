import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateRisk } from '@chc/contracts';

import { ReasonRequiredError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Risk and compliance registers (spec §§20, 83).
 *
 * Both are registers, not verdicts. The risk register records likelihood and
 * impact as somebody judged them; the compliance register records
 * requirements and the evidence held against them. Neither decides that a
 * facility is safe or lawfully compliant — those are judgements for a
 * regulator and a professional adviser, and a green tick here must never be
 * mistaken for one.
 */
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

  // ---------------------------------------------------------------------------
  // Risk register (spec §20)
  // ---------------------------------------------------------------------------

  async createRisk(input: CreateRisk) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const reference = await this.nextOrgReference('risk', 'RISK');
    const context = tryGetContext();

    const risk = await this.prisma.risk.create({
      data: {
        id: input.id ?? randomUUID(),
        organisationId,
        facilityId: input.facilityId,
        projectId: input.projectId,
        reference,
        title: input.title,
        description: input.description,
        category: input.category,
        likelihood: input.likelihood,
        impact: input.impact,
        // Computed here and constrained in the database, so the register can
        // be sorted by score without the score ever disagreeing with its inputs.
        riskScore: input.likelihood * input.impact,
        mitigation: input.mitigation,
        contingency: input.contingency,
        ownerUserId: input.ownerUserId,
        reviewDate: input.reviewDate ? new Date(input.reviewDate) : undefined,
        createdBy: context?.userId,
      },
      select: { id: true, reference: true, title: true, likelihood: true, impact: true, riskScore: true, status: true },
    });

    await this.audit.record({
      action: 'planning.risk.create',
      entityType: 'risk',
      entityId: risk.id,
      facilityId: input.facilityId,
      newValue: { reference, riskScore: risk.riskScore },
    });

    return { ...risk, band: riskBand(risk.riskScore) };
  }

  async listRisks(facilityId: string) {
    this.assertFacilityVisible(facilityId);

    const risks = await this.prisma.risk.findMany({
      where: { facilityId },
      orderBy: [{ status: 'asc' }, { riskScore: 'desc' }],
      select: {
        id: true,
        reference: true,
        title: true,
        description: true,
        category: true,
        likelihood: true,
        impact: true,
        riskScore: true,
        mitigation: true,
        contingency: true,
        ownerUserId: true,
        status: true,
        reviewDate: true,
        createdAt: true,
      },
    });

    const today = this.now();

    return risks.map((risk) => ({
      ...risk,
      band: riskBand(risk.riskScore),
      // Derived on read, never stored: a review does not become overdue
      // because somebody ran a job, it becomes overdue because time passed.
      reviewOverdue: Boolean(risk.reviewDate && risk.status === 'OPEN' && risk.reviewDate < today),
      // A risk with no mitigation is not a managed risk, and the register
      // should say so rather than leaving a blank column to be skimmed past.
      unmitigated: !risk.mitigation && risk.status === 'OPEN',
    }));
  }

  // ---------------------------------------------------------------------------
  // Compliance register (spec §83)
  //
  // The system records requirements and evidence. It does NOT assert that a
  // facility is lawfully compliant — that is a judgement for a regulator and a
  // professional adviser, and a green tick here must never be mistaken for one.
  // ---------------------------------------------------------------------------

  async listCompliance(facilityId: string) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(facilityId);

    const requirements = await this.prisma.complianceRequirement.findMany({
      where: { OR: [{ organisationId }, { organisationId: null }] },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        responsibleAuthority: true,
        renewalIntervalMonths: true,
        statuses: {
          where: { facilityId },
          select: {
            id: true,
            state: true,
            evidenceNote: true,
            certificateNumber: true,
            issuedOn: true,
            expiresOn: true,
            actionRequired: true,
            assessedAt: true,
            assessedBy: true,
          },
        },
      },
    });

    const today = this.now();

    return {
      // Repeated on the payload so no caller can render this register without
      // it (spec §83).
      disclaimer:
        'This register records requirements and the evidence held against them. ' +
        'It is not a legal opinion and does not determine compliance. ' +
        'SUBJECT TO APPLICABLE LAW, GOVERNMENT APPROVAL AND PROFESSIONAL REVIEW.',
      requirements: requirements.map((requirement) => {
        const status = requirement.statuses[0] ?? null;
        const expired = Boolean(status?.expiresOn && status.expiresOn < today);

        return {
          id: requirement.id,
          code: requirement.code,
          name: requirement.name,
          description: requirement.description,
          responsibleAuthority: requirement.responsibleAuthority,
          renewalIntervalMonths: requirement.renewalIntervalMonths,
          status: status
            ? {
                ...status,
                issuedOn: status.issuedOn,
                // Expiry is a fact about a date, computed on read. Storing
                // EXPIRED would make the register correct only as recently as
                // the last time something ran (§10).
                effectiveState: expired && status.state === 'COMPLIANT' ? 'EXPIRED' : status.state,
                expired,
                daysUntilExpiry: status.expiresOn
                  ? Math.ceil((status.expiresOn.getTime() - today.getTime()) / 86_400_000)
                  : null,
              }
            : null,
          // Distinguishes "we looked and it is not in place" from "nobody has
          // looked" — the two are very different on a proposal.
          assessed: status !== null && status.state !== 'NOT_ASSESSED',
        };
      }),
    };
  }

  async setComplianceStatus(input: {
    requirementId: string;
    facilityId: string;
    state: 'NOT_ASSESSED' | 'COMPLIANT' | 'PARTIAL' | 'NON_COMPLIANT' | 'NOT_APPLICABLE';
    evidenceNote?: string;
    certificateNumber?: string;
    issuedOn?: string;
    expiresOn?: string;
    actionRequired?: string;
  }) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const requirement = await this.prisma.complianceRequirement.findFirst({
      where: { id: input.requirementId, OR: [{ organisationId }, { organisationId: null }] },
      select: { id: true, code: true, name: true },
    });

    if (!requirement) throw new NotFoundException('No such compliance requirement.');

    // Claiming compliance with nothing behind it is the exact failure mode
    // §83 exists to prevent.
    if (input.state === 'COMPLIANT' && !input.evidenceNote && !input.certificateNumber) {
      throw new BadRequestException(
        `Recording "${requirement.name}" as compliant requires evidence: a certificate number, or a note ` +
          'describing what was seen and by whom.',
      );
    }

    if (input.state === 'NOT_APPLICABLE' && !input.evidenceNote) {
      throw new ReasonRequiredError(`Marking "${requirement.name}" as not applicable`);
    }

    const context = tryGetContext();

    const data = {
      organisationId,
      state: input.state,
      evidenceNote: input.evidenceNote,
      certificateNumber: input.certificateNumber,
      issuedOn: input.issuedOn ? new Date(input.issuedOn) : null,
      expiresOn: input.expiresOn ? new Date(input.expiresOn) : null,
      actionRequired: input.actionRequired,
      assessedBy: context?.userId,
      assessedAt: this.now(),
    };

    const status = await this.prisma.complianceStatus.upsert({
      where: { requirementId_facilityId: { requirementId: requirement.id, facilityId: input.facilityId } },
      create: { ...data, requirementId: requirement.id, facilityId: input.facilityId, createdBy: context?.userId },
      update: data,
      select: { id: true, state: true, expiresOn: true, assessedAt: true },
    });

    await this.audit.record({
      action: 'planning.compliance.set',
      entityType: 'compliance_status',
      entityId: status.id,
      facilityId: input.facilityId,
      newValue: { requirement: requirement.code, state: input.state },
      severity: 'NOTICE',
    });

    return status;
  }

  private async nextOrgReference(entity: 'risk', prefix: string): Promise<string> {
    const { organisationId } = getTenantScope();
    const count = entity === 'risk' ? await this.prisma.risk.count({ where: { organisationId } }) : 0;

    return `${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
}

/** The usual 5x5 bands. Configurable thresholds belong with the matrix, not here. */
function riskBand(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
  if (score >= 15) return 'EXTREME';
  if (score >= 10) return 'HIGH';
  if (score >= 5) return 'MEDIUM';
  return 'LOW';
}
