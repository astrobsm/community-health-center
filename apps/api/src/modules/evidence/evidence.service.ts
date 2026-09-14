import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CreateEvidence } from '@chc/contracts';

import type { Env } from '../../config/env';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import { StorageService } from './storage.service';

/** Content types we will accept as evidence, and the extension each maps to. */
const ACCEPTED_MEDIA: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

@Injectable()
export class EvidenceService {
  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Register evidence and, when it carries a file, issue an upload URL.
   *
   * The metadata record is created immediately and the bytes follow on a
   * separate channel. That is what lets an assessment be complete and
   * reportable while its photographs are still uploading over a weak link
   * (doc 10 §7).
   */
  async create(input: CreateEvidence) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(input.facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    if (input.media && !ACCEPTED_MEDIA[input.media.contentType]) {
      throw new BadRequestException(
        `"${input.media.contentType}" is not an accepted evidence type. ` +
          `Accepted: ${Object.keys(ACCEPTED_MEDIA).join(', ')}.`,
      );
    }

    // A re-sent create is the normal case when a field device retries, so it
    // returns the existing record rather than failing.
    const existing = await this.prisma.evidence.findUnique({
      where: { id: input.id },
      select: { id: true, facilityId: true },
    });

    if (existing) {
      if (existing.facilityId !== input.facilityId) {
        throw new ConflictException('That evidence id already exists for a different facility.');
      }
      return this.describe(input.id, { includeUploadUrl: true });
    }

    const context = tryGetContext();
    const reference = await this.nextReference(input.facilityId);

    await this.prisma.$transaction(async (tx) => {
      await tx.evidence.create({
        data: {
          id: input.id,
          organisationId,
          facilityId: input.facilityId,
          reference,
          source: input.source,
          description: input.description,
          capturedOn: input.capturedOn ? new Date(input.capturedOn) : undefined,
          capturedBy: context?.userId,
          // Evidence captured by an assessor in the field is VERIFIED only once
          // someone else confirms it. Until then it is what one person saw.
          classification: 'REPORTED',
          deviceId: input.deviceId ?? context?.deviceId,
          createdBy: context?.userId,
        },
      });

      if (!input.media) return;

      const extension = ACCEPTED_MEDIA[input.media.contentType] ?? 'bin';
      const isImage = input.media.contentType.startsWith('image/');
      const key = this.storage.buildKey(input.facilityId, 'evidence', extension);

      if (isImage) {
        await tx.photograph.create({
          data: {
            evidenceId: input.id,
            organisationId,
            facilityId: input.facilityId,
            storageKey: key,
            contentType: input.media.contentType,
            sizeBytes: input.media.sizeBytes,
            width: input.media.width,
            height: input.media.height,
            contentHash: input.media.contentHash,
            capturedAt: input.capturedOn ? new Date(input.capturedOn) : undefined,
            latitude: input.latitude,
            longitude: input.longitude,
            caption: input.description,
            category: input.category,
            stage: input.stage,
            mediaStatus: 'PENDING_UPLOAD',
            deviceId: input.deviceId ?? context?.deviceId,
          },
        });
      } else {
        await tx.evidenceDocument.create({
          data: {
            evidenceId: input.id,
            organisationId,
            facilityId: input.facilityId,
            storageKey: key,
            fileName: input.media.fileName,
            contentType: input.media.contentType,
            sizeBytes: input.media.sizeBytes,
            contentHash: input.media.contentHash,
            documentType: input.category,
            mediaStatus: 'PENDING_UPLOAD',
            deviceId: input.deviceId ?? context?.deviceId,
          },
        });
      }
    });

    await this.audit.record({
      action: 'evidence.create',
      entityType: 'evidence',
      entityId: input.id,
      facilityId: input.facilityId,
      newValue: { reference, source: input.source, hasMedia: Boolean(input.media) },
    });

    return this.describe(input.id, { includeUploadUrl: true });
  }

  /**
   * Confirm the bytes arrived and match what was declared.
   *
   * Called by the client after the upload completes. Until it succeeds the
   * evidence stays PENDING_UPLOAD, and a baseline cannot be sealed.
   */
  async confirmUpload(evidenceId: string) {
    const evidence = await this.load(evidenceId);
    const media = evidence.photograph ?? evidence.documentFile;

    if (!media) {
      throw new BadRequestException('This evidence carries no file, so there is nothing to confirm.');
    }

    if (!this.storage.configured) {
      throw new ServiceUnavailableException(
        'Object storage is not configured, so uploads cannot be verified. Set STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY.',
      );
    }

    const result = await this.storage.verifyUpload(this.env.STORAGE_BUCKET_EVIDENCE, media.storageKey, {
      sizeBytes: media.sizeBytes ?? 0,
      contentType: media.contentType,
    });

    if (!result.present || !result.sizeMatches) {
      await this.setMediaStatus(evidenceId, 'FAILED');
      throw new BadRequestException(
        result.reason ?? 'The upload could not be verified. Try uploading the file again.',
      );
    }

    await this.setMediaStatus(evidenceId, 'AVAILABLE');

    await this.audit.record({
      action: 'evidence.upload.confirmed',
      entityType: 'evidence',
      entityId: evidenceId,
      facilityId: evidence.facilityId,
      newValue: { sizeBytes: result.actualSize },
    });

    return this.describe(evidenceId, { includeUploadUrl: false });
  }

  /**
   * Independent verification (spec §16).
   *
   * This is what moves evidence from REPORTED to VERIFIED, and it is
   * deliberately a separate permission from uploading: the value of
   * verification comes entirely from it being done by someone other than the
   * person who captured it.
   */
  async verify(evidenceId: string, verificationNote?: string) {
    const evidence = await this.load(evidenceId);
    const context = tryGetContext();

    if (evidence.capturedBy && evidence.capturedBy === context?.userId) {
      throw new ConflictException(
        'You captured this evidence, so you cannot also verify it. Verification must be independent.',
      );
    }

    if (evidence.verifiedAt) {
      throw new ConflictException('This evidence has already been verified.');
    }

    const updated = await this.prisma.evidence.update({
      where: { id: evidenceId },
      data: {
        verifiedBy: context?.userId,
        verifiedAt: new Date(),
        verificationNote,
        classification: 'VERIFIED',
      },
      select: { id: true, reference: true, classification: true, verifiedAt: true },
    });

    await this.audit.record({
      action: 'evidence.verify',
      entityType: 'evidence',
      entityId: evidenceId,
      facilityId: evidence.facilityId,
      oldValue: { classification: 'REPORTED' },
      newValue: { classification: 'VERIFIED' },
      reason: verificationNote,
      severity: 'NOTICE',
    });

    return updated;
  }

  async describe(evidenceId: string, options: { includeUploadUrl: boolean }) {
    const evidence = await this.load(evidenceId);
    const media = evidence.photograph ?? evidence.documentFile;

    let upload: { uploadUrl: string; headers: Record<string, string>; expiresAt: string } | undefined;
    let downloadUrl: string | undefined;

    if (media && this.storage.configured) {
      // FAILED is included deliberately: a retry after an interrupted upload is
      // the normal case on a weak link, and refusing a fresh URL would strand
      // the evidence permanently.
      if (options.includeUploadUrl && (media.mediaStatus === 'PENDING_UPLOAD' || media.mediaStatus === 'FAILED')) {
        const presigned = await this.storage.presignUpload({
          bucket: this.env.STORAGE_BUCKET_EVIDENCE,
          key: media.storageKey,
          contentType: media.contentType,
          contentLength: media.sizeBytes ?? 0,
        });
        upload = {
          uploadUrl: presigned.url,
          headers: presigned.headers,
          expiresAt: presigned.expiresAt.toISOString(),
        };
      }

      if (media.mediaStatus === 'AVAILABLE') {
        downloadUrl = (
          await this.storage.presignDownload(this.env.STORAGE_BUCKET_EVIDENCE, media.storageKey)
        ).url;
      }
    }

    return {
      id: evidence.id,
      reference: evidence.reference,
      facilityId: evidence.facilityId,
      source: evidence.source,
      description: evidence.description,
      classification: evidence.classification,
      capturedOn: evidence.capturedOn,
      capturedBy: evidence.capturedBy,
      verifiedBy: evidence.verifiedBy,
      verifiedAt: evidence.verifiedAt,
      media: media
        ? {
            contentType: media.contentType,
            sizeBytes: media.sizeBytes,
            status: media.mediaStatus,
            stage: evidence.photograph?.stage,
          }
        : null,
      upload,
      downloadUrl,
    };
  }

  async listForFacility(facilityId: string, options: { stage?: string; source?: string } = {}) {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    return this.prisma.evidence.findMany({
      where: {
        facilityId,
        source: options.source as never,
        photograph: options.stage ? { stage: options.stage as never } : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        reference: true,
        source: true,
        description: true,
        classification: true,
        capturedOn: true,
        verifiedAt: true,
        photograph: { select: { mediaStatus: true, stage: true, contentType: true } },
        documentFile: { select: { mediaStatus: true, fileName: true, contentType: true } },
      },
    });
  }

  /** Evidence still uploading. A baseline cannot be sealed while this is non-zero. */
  async countPendingMedia(facilityId: string): Promise<number> {
    const [photographs, documents] = await Promise.all([
      this.prisma.photograph.count({
        where: { facilityId, mediaStatus: { in: ['PENDING_UPLOAD', 'UPLOADING', 'FAILED'] } },
      }),
      this.prisma.evidenceDocument.count({
        where: { facilityId, mediaStatus: { in: ['PENDING_UPLOAD', 'UPLOADING', 'FAILED'] } },
      }),
    ]);

    return photographs + documents;
  }

  async countUnverified(facilityId: string): Promise<number> {
    return this.prisma.evidence.count({ where: { facilityId, verifiedAt: null } });
  }

  private async setMediaStatus(evidenceId: string, status: 'AVAILABLE' | 'FAILED'): Promise<void> {
    await this.prisma.photograph.updateMany({ where: { evidenceId }, data: { mediaStatus: status } });
    await this.prisma.evidenceDocument.updateMany({ where: { evidenceId }, data: { mediaStatus: status } });
  }

  private async nextReference(facilityId: string): Promise<string> {
    const count = await this.prisma.evidence.count({ where: { facilityId } });
    return `E-${String(count + 1).padStart(5, '0')}`;
  }

  private async load(evidenceId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const evidence = await this.prisma.evidence.findFirst({
      where: { id: evidenceId, organisationId },
      select: {
        id: true,
        reference: true,
        facilityId: true,
        source: true,
        description: true,
        classification: true,
        capturedOn: true,
        capturedBy: true,
        verifiedBy: true,
        verifiedAt: true,
        photograph: {
          select: { storageKey: true, contentType: true, sizeBytes: true, mediaStatus: true, stage: true },
        },
        documentFile: {
          select: { storageKey: true, contentType: true, sizeBytes: true, mediaStatus: true, fileName: true },
        },
      },
    });

    if (!evidence || !facilityIds.includes(evidence.facilityId)) {
      throw new NotFoundException('No such evidence, or it is not visible to you.');
    }

    return evidence;
  }
}
