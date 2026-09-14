import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Completeness, GenerateDocument, Provenance } from '@chc/contracts';

import type { Env } from '../../config/env';
import { DocumentIncompleteError, ReasonRequiredError, SegregationOfDutiesError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { StorageService } from '../evidence/storage.service';

import { assessCompleteness, checkSubmission } from './domain/completeness';
import { renderWithHash } from './domain/render';
import { DocumentContextService } from './document-context.service';

/**
 * Generated documents (spec §§49-50, doc 16).
 *
 * A document version is an artefact, not a record that gets edited. Generating
 * again produces a new version and supersedes the old one, which stays
 * retrievable forever — the database refuses to alter an approved version, so
 * this is a property of the system rather than of this service.
 *
 * The rendered artefact is HTML, stored in object storage and hashed. PDF and
 * DOCX production is not yet implemented: it needs the queued worker described
 * in doc 16 §2, and a synchronous browser render inside a request thread would
 * be a worse answer than an honest absence.
 */
@Injectable()
export class DocumentService {
  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly context: DocumentContextService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private now(): Date {
    return new Date();
  }

  /**
   * Produce a version of a document from current data.
   *
   * Always a new version: the figures move, and a document that silently
   * re-rendered under a reader would make every citation of it unreliable.
   */
  async generate(input: GenerateDocument) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(input.facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const resolved = await this.context.resolve({
      facilityId: input.facilityId,
      documentType: input.documentType,
      narratives: input.narratives ?? {},
      financialModelId: input.financialModelId,
      partnershipId: input.partnershipId,
    });

    const completeness = assessCompleteness(resolved.sections);
    const context = tryGetContext();
    const generatedAt = this.now();

    const existing = await this.prisma.generatedDocument.findFirst({
      where: { facilityId: input.facilityId, documentType: input.documentType },
      orderBy: { createdAt: 'asc' },
      select: { id: true, reference: true, currentVersion: true, title: true },
    });

    const reference = existing?.reference ?? (await this.nextReference(organisationId));
    const versionNumber = (existing?.currentVersion ?? 0) + 1;
    const title = input.title ?? resolved.title;

    const generatedBy = context?.userId
      ? await this.displayName(context.userId)
      : null;

    const provenance: Provenance = {
      documentType: input.documentType,
      title,
      reference,
      versionNumber,
      supersedesVersion: versionNumber > 1 ? versionNumber - 1 : null,
      status: 'DRAFT',
      generatedAt: generatedAt.toISOString(),
      generatedBy,
      approvedBy: null,
      approvedAt: null,
      reportingPeriodStart: input.reportingPeriodStart ?? null,
      reportingPeriodEnd: input.reportingPeriodEnd ?? null,
      sourceDatasets: resolved.sourceDatasets,
      financialModel: resolved.financialModel,
      contentHash: '',
      completeness,
    };

    const { html, contentHash } = renderWithHash(provenance, resolved.sections);

    const key = this.storage.buildKey(input.facilityId, 'document', 'html');
    const stored = await this.storage.putObject({
      bucket: this.env.STORAGE_BUCKET_DOCUMENTS,
      key,
      body: html,
      contentType: 'text/html; charset=utf-8',
    });

    const document = await this.prisma.$transaction(async (tx) => {
      const record = existing
        ? await tx.generatedDocument.update({
            where: { id: existing.id },
            data: { currentVersion: versionNumber, status: 'DRAFT', title },
            select: { id: true, reference: true, title: true, documentType: true, currentVersion: true, status: true },
          })
        : await tx.generatedDocument.create({
            data: {
              organisationId,
              facilityId: input.facilityId,
              documentType: input.documentType,
              title,
              reference,
              currentVersion: 1,
              createdBy: context?.userId,
            },
            select: { id: true, reference: true, title: true, documentType: true, currentVersion: true, status: true },
          });

      // The previous version becomes SUPERSEDED rather than disappearing. A
      // copy already sent to a government partner must remain retrievable and
      // must say what replaced it (spec §50).
      if (existing) {
        await tx.documentVersion.updateMany({
          where: { documentId: record.id, status: { not: 'APPROVED' }, supersededAt: null },
          data: { status: 'SUPERSEDED', supersededAt: generatedAt },
        });
        await tx.documentVersion.updateMany({
          where: { documentId: record.id, status: 'APPROVED', supersededAt: null },
          data: { supersededAt: generatedAt },
        });
      }

      await tx.documentVersion.create({
        data: {
          documentId: record.id,
          organisationId,
          versionNumber,
          status: 'DRAFT',
          storageKey: key,
          contentType: 'text/html; charset=utf-8',
          sizeBytes: stored.sizeBytes,
          contentHash,
          provenance: { ...provenance, contentHash } as never,
          classificationSummary: completeness.classificationSummary as never,
          completenessPercent: completeness.completenessPercent,
          missingDataNotes: completeness.gaps as never,
          reportingPeriodStart: input.reportingPeriodStart ? new Date(input.reportingPeriodStart) : undefined,
          reportingPeriodEnd: input.reportingPeriodEnd ? new Date(input.reportingPeriodEnd) : undefined,
          generatedBy: context?.userId,
          generatedAt,
        },
      });

      return record;
    });

    await this.audit.record({
      action: 'document.generate',
      entityType: 'document_version',
      entityId: document.id,
      facilityId: input.facilityId,
      newValue: {
        documentType: input.documentType,
        versionNumber,
        completenessPercent: completeness.completenessPercent,
        gaps: completeness.gaps.length,
        contentHash,
      },
    });

    const submission = checkSubmission(
      input.documentType,
      completeness,
      await this.thresholds(input.facilityId),
    );

    return {
      documentId: document.id,
      reference,
      title,
      documentType: input.documentType,
      versionNumber,
      status: 'DRAFT' as const,
      contentHash,
      sizeBytes: stored.sizeBytes,
      completeness,
      submission,
      // Stated on every generation rather than buried in a settings page: a
      // caller who expected a PDF needs to know immediately that they have
      // HTML, not discover it when they try to print it.
      format: {
        contentType: 'text/html; charset=utf-8',
        note: 'PDF and DOCX production is not yet implemented; it requires the queued render worker.',
      },
    };
  }

  async get(documentId: string) {
    const document = await this.load(documentId);

    return {
      ...document,
      versions: document.versions.map((version) => ({
        ...version,
        completenessPercent: version.completenessPercent === null ? null : Number(version.completenessPercent),
        isCurrent: version.versionNumber === document.currentVersion,
      })),
    };
  }

  /** The rendered artefact, read back from storage exactly as it was written. */
  async content(documentId: string, versionNumber?: number) {
    const document = await this.load(documentId);

    const version = versionNumber
      ? document.versions.find((candidate) => candidate.versionNumber === versionNumber)
      : document.versions.find((candidate) => candidate.versionNumber === document.currentVersion);

    if (!version) {
      throw new NotFoundException(
        versionNumber ? `This document has no version ${versionNumber}.` : 'This document has no versions.',
      );
    }

    if (!version.storageKey) {
      throw new NotFoundException('This version has no stored artefact.');
    }

    const html = await this.storage.getObject(this.env.STORAGE_BUCKET_DOCUMENTS, version.storageKey);

    await this.audit.record({
      action: 'document.read',
      entityType: 'document_version',
      entityId: document.id,
      facilityId: document.facilityId,
      newValue: { versionNumber: version.versionNumber },
    });

    return {
      html,
      versionNumber: version.versionNumber,
      status: version.status,
      contentHash: version.contentHash,
      // A reader can recompute this over the file and compare. If it differs,
      // the file has been altered since it was issued.
      verifyBy: 'sha256 over the document with the content-hash element emptied',
    };
  }

  /**
   * Send the current version for approval.
   *
   * Refused below the threshold for its type. A proposal that reaches a
   * government partner half-populated damages the credibility of every figure
   * in it, including the ones that were right (doc 16 §3).
   */
  async submit(documentId: string, input: { note?: string }) {
    const document = await this.load(documentId);
    const version = this.currentVersion(document);

    if (version.status !== 'DRAFT' && version.status !== 'REVISION') {
      throw new BadRequestException(
        `Version ${version.versionNumber} is ${version.status} and cannot be submitted again.`,
      );
    }

    // Read back from the version rather than recomputed: the decision must be
    // made about the artefact that exists, not about whatever the data says
    // now. Regenerating is how a document takes account of newer figures.
    const provenance = version.provenance as { completeness?: Completeness } | null;
    const completeness = provenance?.completeness;

    if (!completeness) {
      throw new BadRequestException(
        `Version ${version.versionNumber} has no recorded completeness. Generate it again before submitting.`,
      );
    }

    const submission = checkSubmission(
      document.documentType,
      completeness,
      await this.thresholds(document.facilityId),
    );

    if (!submission.canSubmit) {
      await this.audit.record({
        action: 'document.submit',
        entityType: 'document_version',
        entityId: document.id,
        facilityId: document.facilityId,
        outcome: 'DENIED',
        newValue: { versionNumber: version.versionNumber, completenessPercent: submission.completenessPercent },
      });

      throw new DocumentIncompleteError(submission.reason ?? 'This document is not complete enough to submit.', {
        threshold: submission.threshold,
        completenessPercent: submission.completenessPercent,
        gaps: submission.blockingGaps,
      });
    }

    const context = tryGetContext();

    await this.prisma.$transaction([
      this.prisma.documentVersion.update({
        where: { id: version.id },
        data: { status: 'PENDING_APPROVAL' },
      }),
      this.prisma.generatedDocument.update({
        where: { id: document.id },
        data: { status: 'PENDING_APPROVAL' },
      }),
    ]);

    await this.audit.record({
      action: 'document.submit',
      entityType: 'document_version',
      entityId: document.id,
      facilityId: document.facilityId,
      oldValue: { status: version.status },
      newValue: { status: 'PENDING_APPROVAL', versionNumber: version.versionNumber },
      reason: input.note,
    });

    return {
      documentId: document.id,
      versionNumber: version.versionNumber,
      status: 'PENDING_APPROVAL' as const,
      submittedBy: context?.userId ?? null,
    };
  }

  /**
   * Approve or reject the version awaiting decision.
   *
   * The person who generated it may not approve it: a document is an assertion
   * to somebody outside the organisation, and one pair of eyes is not a review.
   */
  async decide(documentId: string, input: { decision: 'APPROVED' | 'REJECTED'; reason?: string }) {
    const document = await this.load(documentId);
    const version = this.currentVersion(document);
    const context = tryGetContext();

    if (version.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Version ${version.versionNumber} is ${version.status}; only a version awaiting approval can be decided.`,
      );
    }

    if (version.generatedBy && context?.userId && version.generatedBy === context.userId) {
      throw new SegregationOfDutiesError(
        'The person who generated a document may not approve it. Ask a second approver.',
      );
    }

    if (input.decision === 'REJECTED' && (input.reason ?? '').trim().length < 10) {
      // A document sent back with no reason cannot be fixed.
      throw new ReasonRequiredError('Rejecting a document');
    }

    const decidedAt = this.now();
    const status = input.decision === 'APPROVED' ? 'APPROVED' : 'REVISION';

    await this.prisma.$transaction([
      this.prisma.documentVersion.update({
        where: { id: version.id },
        data: {
          status,
          ...(input.decision === 'APPROVED' ? { approvedBy: context?.userId, approvedAt: decidedAt } : {}),
        },
      }),
      this.prisma.generatedDocument.update({ where: { id: document.id }, data: { status } }),
      this.prisma.approval.create({
        data: {
          organisationId: document.organisationId,
          facilityId: document.facilityId,
          entityType: 'document_version',
          entityId: version.id,
          approverUserId: context?.userId,
          decision: input.decision,
          reason: input.reason,
          decidedAt,
          createdBy: context?.userId,
        },
      }),
    ]);

    await this.audit.record({
      action: input.decision === 'APPROVED' ? 'document.approve' : 'document.reject',
      entityType: 'document_version',
      entityId: document.id,
      facilityId: document.facilityId,
      oldValue: { status: 'PENDING_APPROVAL' },
      newValue: { status, versionNumber: version.versionNumber },
      reason: input.reason,
      severity: 'CRITICAL',
    });

    return {
      documentId: document.id,
      versionNumber: version.versionNumber,
      status,
      decidedAt,
      ...(input.decision === 'APPROVED'
        ? { note: 'This version is now immutable. Revising it produces a new version.' }
        : { note: 'Correct the document and generate a new version.' }),
    };
  }

  // ---------------------------------------------------------------------------

  private async thresholds(facilityId: string) {
    // Configurable per organisation and facility (§89); the defaults live
    // beside the logic that uses them.
    return this.config.json<Partial<Record<string, number>>>('documents.completenessThresholds', {}, facilityId);
  }

  private currentVersion(document: Awaited<ReturnType<DocumentService['load']>>) {
    const version = document.versions.find((candidate) => candidate.versionNumber === document.currentVersion);
    if (!version) throw new NotFoundException('This document has no current version.');
    return version;
  }

  private async displayName(userId: string): Promise<string | null> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { fullName: true, userRoles: { select: { role: { select: { name: true } } }, take: 1 } },
    });

    if (!user) return null;

    const role = user.userRoles[0]?.role.name;
    return role ? `${user.fullName} (${role})` : user.fullName;
  }

  private async nextReference(organisationId: string): Promise<string> {
    const count = await this.prisma.generatedDocument.count({ where: { organisationId } });
    return `DOC-${String(count + 1).padStart(4, '0')}`;
  }

  private async load(documentId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const document = await this.prisma.generatedDocument.findFirst({
      where: { id: documentId, organisationId },
      select: {
        id: true,
        organisationId: true,
        facilityId: true,
        documentType: true,
        title: true,
        reference: true,
        status: true,
        currentVersion: true,
        createdAt: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            status: true,
            storageKey: true,
            contentHash: true,
            sizeBytes: true,
            completenessPercent: true,
            classificationSummary: true,
            missingDataNotes: true,
            provenance: true,
            generatedBy: true,
            generatedAt: true,
            approvedBy: true,
            approvedAt: true,
            supersededAt: true,
          },
        },
      },
    });

    if (!document || !facilityIds.includes(document.facilityId)) {
      throw new NotFoundException('No such document, or it is not visible to you.');
    }

    return document;
  }
}
