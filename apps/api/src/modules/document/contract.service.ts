import { createHash } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentSection, ExecuteContract, GenerateContract, Provenance } from '@chc/contracts';
import { DRAFT_LEGAL_BANNER, LEGAL_REVIEW_NOTICE } from '@chc/contracts';

import type { Env } from '../../config/env';
import { BusinessRuleError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../evidence/storage.service';

import { assessCompleteness } from './domain/completeness';
import { renderWithHash } from './domain/render';

/**
 * Contracts and the MOU generator (spec §52, doc 16 §8).
 *
 * The financial and operational clauses are assembled from the partnership
 * configuration the system actually holds — the waterfall steps, the
 * obligations, the parties — so the agreement and the software cannot diverge.
 * A clause that stated a percentage the waterfall does not use would be worse
 * than no clause at all.
 *
 * Two rules that are not negotiable:
 *
 *  - Every generated copy carries the draft banner until the contract is
 *    marked executed with the signed file and the signatories recorded. The
 *    renderer takes a claim about the contract, not a request to hide it.
 *  - No clause asserts a legal conclusion. Regulatory clauses point at the
 *    configurable compliance register rather than stating what the law
 *    requires (spec §83).
 */
@Injectable()
export class ContractService {
  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date();
  }

  async generate(input: GenerateContract) {
    const { organisationId, facilityIds } = getTenantScope();

    const partnership = await this.prisma.partnership.findFirst({
      where: { id: input.partnershipId, organisationId },
      select: {
        id: true,
        facilityId: true,
        name: true,
        commencementDate: true,
        termMonths: true,
        facility: { select: { name: true, code: true } },
        parties: {
          orderBy: { partyRole: 'asc' },
          select: { id: true, partyRole: true, legalName: true, representative: true, title: true, address: true },
        },
        obligations: {
          orderBy: { reference: 'asc' },
          select: { reference: true, description: true, dueDate: true, partyId: true },
        },
        revenueModels: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: {
            name: true,
            shareType: true,
            versionNumber: true,
            effectiveFrom: true,
            steps: {
              orderBy: { sequence: 'asc' },
              select: {
                sequence: true,
                label: true,
                basis: true,
                rate: true,
                fixedAmountMinor: true,
                capMinor: true,
                floorMinor: true,
                isCapitalRecovery: true,
                beneficiaryPartyId: true,
              },
            },
          },
        },
      },
    });

    if (!partnership) throw new NotFoundException('No such partnership, or it is not visible to you.');
    if (!facilityIds.includes(partnership.facilityId)) {
      throw new NotFoundException('No such partnership, or it is not visible to you.');
    }

    if (partnership.parties.length < 2) {
      // An agreement between one party is not an agreement. Generating it
      // would produce a document whose first clause is already wrong.
      throw new BadRequestException(
        'This partnership has fewer than two parties recorded. Record the parties to the agreement before generating it.',
      );
    }

    const revenueModel = partnership.revenueModels[0];
    const context = tryGetContext();

    const sections = this.clauses(partnership, revenueModel, input.contractType);

    const existing = await this.prisma.contract.findFirst({
      where: { partnershipId: partnership.id, contractType: input.contractType },
      select: { id: true, reference: true, status: true, executedAt: true, versions: { select: { versionNumber: true }, orderBy: { versionNumber: 'desc' }, take: 1 } },
    });

    if (existing?.executedAt) {
      // An executed agreement is what the parties signed. A new draft is an
      // amendment, which is a different contract type and a fresh negotiation.
      throw new BusinessRuleError(
        'contract-executed',
        'Contract already executed',
        `${existing.reference} was executed on ${existing.executedAt.toISOString().slice(0, 10)} and cannot be redrafted. ` +
          'Generate an AMENDMENT instead.',
      );
    }

    const reference = existing?.reference ?? (await this.nextReference(organisationId, input.contractType));
    const versionNumber = (existing?.versions[0]?.versionNumber ?? 0) + 1;
    const title = input.title ?? `${humanise(input.contractType)} — ${partnership.facility.name}`;

    const provenance: Provenance = {
      documentType: input.contractType === 'MANAGEMENT_AGREEMENT' ? 'MANAGEMENT_AGREEMENT' : 'MOU',
      title,
      reference,
      versionNumber,
      supersedesVersion: versionNumber > 1 ? versionNumber - 1 : null,
      status: 'DRAFT',
      generatedAt: this.now().toISOString(),
      generatedBy: context?.userId ?? null,
      approvedBy: null,
      approvedAt: null,
      reportingPeriodStart: null,
      reportingPeriodEnd: null,
      sourceDatasets: [
        { name: `partnership#${partnership.id.slice(0, 8)}`, detail: partnership.name },
        revenueModel
          ? {
              name: 'revenue_share_model',
              detail: `${revenueModel.name} v${revenueModel.versionNumber}, ${revenueModel.steps.length} waterfall step(s)`,
            }
          : { name: 'revenue_share_model', detail: 'none agreed — the revenue clause states that it is outstanding' },
        { name: 'partnership_obligation', detail: `${partnership.obligations.length} obligation(s)` },
      ],
      financialModel: null,
      contentHash: '',
      completeness: assessCompleteness(sections),
    };

    // isExecutedCopy is false here and cannot be otherwise: this is a draft by
    // definition, and the banner is therefore present on every page.
    const { html, contentHash } = renderWithHash(provenance, sections, { isExecutedCopy: false });

    // Written before the row is created, not after. A contract version is
    // immutable the moment it exists, so there is no second chance to record
    // where its artefact lives — and an orphaned object is a far smaller
    // problem than a version row that can never be completed.
    const key = this.storage.buildKey(partnership.facilityId, 'document', 'html');
    await this.storage.putObject({
      bucket: this.env.STORAGE_BUCKET_DOCUMENTS,
      key,
      body: html,
      contentType: 'text/html; charset=utf-8',
    });

    const contract = await this.prisma.$transaction(async (tx) => {
      const record = existing
        ? await tx.contract.update({
            where: { id: existing.id },
            data: { status: 'DRAFT', title, updatedBy: context?.userId },
            select: { id: true, reference: true, title: true, contractType: true, status: true },
          })
        : await tx.contract.create({
            data: {
              partnershipId: partnership.id,
              organisationId,
              facilityId: partnership.facilityId,
              contractType: input.contractType,
              reference,
              title,
              createdBy: context?.userId,
            },
            select: { id: true, reference: true, title: true, contractType: true, status: true },
          });

      await tx.contractVersion.create({
        data: {
          contractId: record.id,
          organisationId,
          versionNumber,
          content: { sections, provenance: { ...provenance, contentHash } } as never,
          storageKey: key,
          contentHash,
          changeSummary: input.changeSummary,
          createdBy: context?.userId,
        },
      });

      return record;
    });

    await this.audit.record({
      action: 'contract.generate',
      entityType: 'contract_version',
      entityId: contract.id,
      facilityId: partnership.facilityId,
      newValue: { contractType: input.contractType, versionNumber, clauses: sections.length, contentHash },
      severity: 'NOTICE',
    });

    return {
      contractId: contract.id,
      reference,
      title,
      contractType: input.contractType,
      versionNumber,
      status: 'DRAFT' as const,
      contentHash,
      clauseCount: sections.reduce((sum, section) => sum + section.clauses.length, 0),
      // Repeated in the response so a caller cannot render this anywhere
      // without the banner travelling with it.
      banner: DRAFT_LEGAL_BANNER,
      notice: LEGAL_REVIEW_NOTICE,
    };
  }

  /** The drafted agreement as it stands, with the banner unless it is executed. */
  async content(contractId: string, versionNumber?: number) {
    const contract = await this.load(contractId);

    const version = versionNumber
      ? contract.versions.find((candidate) => candidate.versionNumber === versionNumber)
      : contract.versions[0];

    if (!version) throw new NotFoundException('This contract has no such version.');

    const stored = version.content as { sections: DocumentSection[]; provenance: Provenance };
    const isExecutedCopy = version.isExecutedCopy && contract.executedAt !== null;

    const { html } = renderWithHash(
      { ...stored.provenance, status: contract.status === 'EXECUTED' ? 'APPROVED' : 'DRAFT' },
      stored.sections,
      { isExecutedCopy },
    );

    return {
      html,
      versionNumber: version.versionNumber,
      status: contract.status,
      contentHash: version.contentHash,
      isExecutedCopy,
      ...(isExecutedCopy ? {} : { banner: DRAFT_LEGAL_BANNER }),
    };
  }

  /**
   * Record that the agreement was signed.
   *
   * Requires the signed file and at least two signatories. Without them there
   * is nothing to distinguish an executed agreement from a draft somebody
   * decided to call final — and the banner would come off a document that
   * nobody had actually signed.
   */
  async execute(contractId: string, input: ExecuteContract) {
    const contract = await this.load(contractId);
    const context = tryGetContext();

    if (contract.executedAt) {
      throw new BusinessRuleError(
        'contract-executed',
        'Contract already executed',
        `${contract.reference} was executed on ${contract.executedAt.toISOString().slice(0, 10)}.`,
      );
    }

    const version = contract.versions[0];
    if (!version) throw new BadRequestException('This contract has no drafted version to execute.');

    const executedAt = this.now();
    const stored = version.content as { sections: DocumentSection[]; provenance: Provenance };

    const signatureHash = createHash('sha256')
      .update(JSON.stringify(input.signatories))
      .digest('hex');

    await this.prisma.$transaction([
      this.prisma.contract.update({
        where: { id: contract.id },
        data: {
          status: 'EXECUTED',
          executedAt,
          effectiveFrom: new Date(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : undefined,
          updatedBy: context?.userId,
        },
      }),
      // A new, immutable version holding the executed copy. The drafted
      // version is not overwritten: what was negotiated and what was signed
      // are both part of the record (doc 03 class 4).
      this.prisma.contractVersion.create({
        data: {
          contractId: contract.id,
          organisationId: contract.organisationId,
          versionNumber: version.versionNumber + 1,
          content: stored as never,
          storageKey: input.storageKey,
          contentHash: `sha256:${signatureHash}`,
          changeSummary: `Executed copy, signed by ${input.signatories.length} signatories.`,
          isExecutedCopy: true,
          signatories: input.signatories as never,
          createdBy: context?.userId,
        },
      }),
    ]);

    await this.audit.record({
      action: 'contract.execute',
      entityType: 'contract',
      entityId: contract.id,
      facilityId: contract.facilityId,
      oldValue: { status: contract.status },
      newValue: {
        status: 'EXECUTED',
        signatories: input.signatories.map((signatory) => `${signatory.name} (${signatory.title})`),
        effectiveFrom: input.effectiveFrom,
      },
      severity: 'CRITICAL',
    });

    return {
      contractId: contract.id,
      reference: contract.reference,
      status: 'EXECUTED' as const,
      executedAt,
      versionNumber: version.versionNumber + 1,
      note: 'Copies generated from the executed version no longer carry the draft banner.',
    };
  }

  // ---------------------------------------------------------------------------

  /**
   * The clause set (doc 16 §8).
   *
   * Every clause that states a figure reads it from the partnership
   * configuration. Where the configuration does not yet hold it, the clause
   * says so rather than proposing a number nobody agreed.
   */
  private clauses(
    partnership: LoadedPartnership,
    revenueModel: LoadedRevenueModel | undefined,
    contractType: string,
  ): DocumentSection[] {
    const partyName = (id: string | null): string =>
      id ? (partnership.parties.find((party) => party.id === id)?.legalName ?? 'a party to this agreement') : 'the facility';

    const government = partnership.parties.find((party) => party.partyRole === 'GOVERNMENT');
    const operator = partnership.parties.find((party) => party.partyRole === 'PARTNER');

    const sections: DocumentSection[] = [];
    let sequence = 1;
    let clauseNumber = 1;

    const add = (heading: string, clauses: Array<{ heading: string; text: string }>) => {
      sections.push({
        key: heading.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        heading,
        sequence: sequence++,
        clauses: clauses.map((clause) => ({ number: String(clauseNumber++), heading: clause.heading, text: clause.text })),
        fields: [],
      });
    };

    add('Parties and purpose', [
      {
        heading: 'Parties',
        text: partnership.parties
          .map(
            (party) =>
              `${party.legalName} (${party.partyRole.toLowerCase()})` +
              (party.representative ? `, represented by ${party.representative}${party.title ? `, ${party.title}` : ''}` : '') +
              (party.address ? `, of ${party.address}` : ''),
          )
          .join('\n\n'),
      },
      {
        heading: 'Purpose',
        text:
          `This ${humanise(contractType).toLowerCase()} records the intentions of the parties in respect of ` +
          `${partnership.facility.name} (${partnership.facility.code}).\n\n${LEGAL_REVIEW_NOTICE}.`,
      },
      {
        heading: 'Facility',
        text: `${partnership.facility.name}, reference ${partnership.facility.code}.`,
      },
    ]);

    add('Term', [
      {
        heading: 'Commencement and duration',
        text: partnership.commencementDate
          ? `Commencing ${partnership.commencementDate.toISOString().slice(0, 10)}` +
            (partnership.termMonths ? ` for a term of ${partnership.termMonths} months.` : ', for a term to be agreed.')
          : 'The commencement date and term are not yet agreed and are to be inserted before execution.',
      },
    ]);

    add('Revenue and financial arrangements', [
      {
        heading: 'Revenue sharing',
        text: revenueModel
          ? `Revenue is applied in the order set out below, being ${revenueModel.name} version ` +
            `${revenueModel.versionNumber}, effective from ${revenueModel.effectiveFrom.toISOString().slice(0, 10)}. ` +
            'This order is the one the operating system applies; the two cannot differ.\n\n' +
            revenueModel.steps
              .map((step) => {
                const amount =
                  step.basis === 'FIXED'
                    ? `${formatMinor(step.fixedAmountMinor)} `
                    : step.rate !== null
                      ? `${formatRate(step.rate)} of ${describeBasis(step.basis)}`
                      : `the balance then remaining`;

                const bounds = [
                  step.capMinor !== null ? `capped at ${formatMinor(step.capMinor)}` : null,
                  step.floorMinor !== null ? `subject to a minimum of ${formatMinor(step.floorMinor)}` : null,
                  step.isCapitalRecovery ? 'limited to the capital then outstanding' : null,
                ].filter(Boolean);

                return (
                  `${step.sequence}. ${step.label}: ${amount}` +
                  (bounds.length > 0 ? `, ${bounds.join(', ')}` : '') +
                  (step.beneficiaryPartyId ? `, to ${partyName(step.beneficiaryPartyId)}` : '') +
                  '.'
                );
              })
              .join('\n')
          : 'No revenue sharing arrangement has yet been agreed. This clause is to be completed before execution; ' +
            'the system holds no terms to state here, and none are proposed.',
      },
      {
        heading: 'Government benefit',
        text: government
          ? `Amounts due to ${government.legalName} are those produced by the order above, computed from the posted ` +
            'accounts for each period and open to inspection by either party.'
          : 'No government party has been recorded, so the amounts due to government cannot be stated.',
      },
      {
        heading: 'Capital recovery',
        text: operator
          ? `Capital contributed by ${operator.legalName} is recoverable only to the extent it was actually paid, ` +
            'evidenced by the payment record in each case, and only through the order set out above.'
          : 'No operating partner has been recorded, so capital recovery cannot be stated.',
      },
    ]);

    add('Obligations of the parties', [
      {
        heading: 'Agreed obligations',
        text:
          partnership.obligations.length > 0
            ? partnership.obligations
                .map(
                  (obligation) =>
                    `${obligation.reference}. ${partyName(obligation.partyId)} shall ${lowerFirst(obligation.description)}` +
                    (obligation.dueDate ? ` by ${obligation.dueDate.toISOString().slice(0, 10)}` : '') +
                    '.',
                )
                .join('\n')
            : 'No obligations have been recorded. They are to be agreed and inserted before execution.',
      },
    ]);

    add('Governance, staffing and operations', [
      {
        heading: 'Management',
        text: 'Day-to-day management arrangements are to be agreed between the parties and recorded here before execution.',
      },
      {
        heading: 'Staffing',
        text: 'Staffing arrangements, including any secondment of existing staff, are to be agreed and recorded here before execution.',
      },
      {
        heading: 'Ownership of assets',
        text: 'The ownership of existing and newly contributed assets is to be agreed and recorded here before execution.',
      },
    ]);

    add('Records, audit and data protection', [
      {
        heading: 'Records and audit',
        text:
          'Each party may inspect the records from which amounts due under this agreement are computed. ' +
          'Those records are maintained in the operating system, are append-only, and carry an audit trail.',
      },
      {
        heading: 'Data protection',
        text:
          'Personal data is processed in accordance with applicable data-protection requirements, including the ' +
          'principles of minimisation, access control, retention and breach notification. The specific obligations ' +
          `applying to the parties are a matter for professional advice. ${LEGAL_REVIEW_NOTICE}.`,
      },
      {
        heading: 'Regulatory compliance',
        text:
          'The requirements applying to the facility, the authorities responsible for them, and the evidence held ' +
          'against each are maintained in the compliance register within the operating system. This agreement does ' +
          'not determine which requirements apply, nor whether they are met.',
      },
    ]);

    add('Term, termination and exit', [
      {
        heading: 'Termination',
        text: 'The circumstances in which either party may terminate are to be agreed and recorded here before execution.',
      },
      {
        heading: 'Exit and handover',
        text:
          'On termination or expiry, the arrangements for handover of operations, records, assets and outstanding ' +
          'balances are to be agreed and recorded here before execution.',
      },
      {
        heading: 'Dispute resolution',
        text: 'The manner of resolving disputes is to be agreed and recorded here before execution.',
      },
      {
        heading: 'Status of this document',
        text:
          // Deliberately does NOT repeat the draft banner. The banner is applied
          // by the renderer according to whether the contract is executed; baking
          // it into a clause would leave draft language in the body of a signed
          // agreement.
          'This document is generated from the configuration held in the operating system. It is not legal ' +
          'advice and does not state what any law requires. Until it has been reviewed by the parties and their ' +
          'advisers, approved by the responsible authorities, and signed, it has no effect. ' +
          `${LEGAL_REVIEW_NOTICE}.`,
      },
    ]);

    return sections;
  }

  private async nextReference(organisationId: string, contractType: string): Promise<string> {
    const count = await this.prisma.contract.count({ where: { organisationId, contractType: contractType as never } });
    const prefix = contractType === 'MOU' ? 'MOU' : contractType === 'AMENDMENT' ? 'AMD' : 'AGR';
    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }

  private async load(contractId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, organisationId },
      select: {
        id: true,
        organisationId: true,
        facilityId: true,
        reference: true,
        title: true,
        contractType: true,
        status: true,
        executedAt: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: { id: true, versionNumber: true, content: true, contentHash: true, isExecutedCopy: true, signatories: true },
        },
      },
    });

    if (!contract || !facilityIds.includes(contract.facilityId)) {
      throw new NotFoundException('No such contract, or it is not visible to you.');
    }

    return contract;
  }
}

interface LoadedPartnership {
  id: string;
  name: string;
  commencementDate: Date | null;
  termMonths: number | null;
  facility: { name: string; code: string };
  parties: Array<{
    id: string;
    partyRole: string;
    legalName: string;
    representative: string | null;
    title: string | null;
    address: string | null;
  }>;
  obligations: Array<{ reference: string; description: string; dueDate: Date | null; partyId: string | null }>;
}

interface LoadedRevenueModel {
  name: string;
  versionNumber: number;
  effectiveFrom: Date;
  steps: Array<{
    sequence: number;
    label: string;
    basis: string;
    rate: unknown;
    fixedAmountMinor: bigint | null;
    capMinor: bigint | null;
    floorMinor: bigint | null;
    isCapitalRecovery: boolean;
    beneficiaryPartyId: string | null;
  }>;
}

function describeBasis(basis: string): string {
  switch (basis) {
    case 'GROSS_REVENUE':
      return 'gross revenue';
    case 'OPERATING_SURPLUS':
      return 'the operating surplus';
    case 'RESIDUAL':
      return 'the balance then remaining';
    default:
      return basis.toLowerCase();
  }
}

function formatRate(rate: unknown): string {
  return `${(Number(rate) * 100).toFixed(2).replace(/\.00$/, '')}%`;
}

function formatMinor(minor: bigint | null): string {
  if (minor === null) return 'an amount to be agreed';
  return `NGN ${(Number(minor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

const CONTRACT_TYPE_NAMES: Record<string, string> = {
  MOU: 'Memorandum of Understanding',
  MANAGEMENT_AGREEMENT: 'Management Agreement',
  SERVICE_AGREEMENT: 'Service Agreement',
  AMENDMENT: 'Amendment',
};

function humanise(value: string): string {
  return (
    CONTRACT_TYPE_NAMES[value] ??
    value
      .split('_')
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ')
  );
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
