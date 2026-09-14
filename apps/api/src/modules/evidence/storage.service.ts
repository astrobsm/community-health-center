import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { Env } from '../../config/env';

/**
 * Object storage for evidence and generated documents.
 *
 * Two rules from doc 18 §4:
 *   - Object keys are RANDOM, never derived from user input. A key built from
 *     a filename or a patient name leaks information to anyone who sees a URL,
 *     and invites traversal.
 *   - Buckets are never public. Every read and write goes through a
 *     short-lived pre-signed URL issued only after a permission check.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;

  constructor(private readonly env: Env) {
    this.client = new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_ENDPOINT,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY ?? '',
      },
    });
  }

  get configured(): boolean {
    return Boolean(this.env.STORAGE_ACCESS_KEY_ID && this.env.STORAGE_SECRET_ACCESS_KEY);
  }

  /**
   * A storage key that reveals nothing.
   *
   * Partitioned by facility and date for operational sanity (lifecycle rules,
   * targeted restore), then 32 random hex characters. The original filename is
   * kept in the database, not in the key.
   */
  buildKey(facilityId: string, kind: 'evidence' | 'document' | 'export', extension: string): string {
    const date = new Date().toISOString().slice(0, 10);
    const random = randomBytes(16).toString('hex');
    const safeExtension = extension.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
    return `${kind}/${facilityId}/${date}/${random}${safeExtension ? `.${safeExtension}` : ''}`;
  }

  async presignUpload(params: {
    bucket: string;
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }> {
    const command = new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
      // Signed only when enabled: the header is part of the signature, so a
      // backend that does not support SSE-S3 rejects the PUT outright. MinIO
      // answers 501 without a KMS.
      ...(this.env.STORAGE_SERVER_SIDE_ENCRYPTION ? { ServerSideEncryption: 'AES256' as const } : {}),
    });

    const ttl = this.env.STORAGE_PRESIGN_TTL_SECONDS;
    const url = await getSignedUrl(this.client, command, { expiresIn: ttl });

    return {
      url,
      // The client must send these verbatim; the signature covers them, so an
      // extra or missing header fails the upload.
      headers: {
        'Content-Type': params.contentType,
        ...(this.env.STORAGE_SERVER_SIDE_ENCRYPTION
          ? { 'x-amz-server-side-encryption': 'AES256' }
          : {}),
      },
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  async presignDownload(bucket: string, key: string): Promise<{ url: string; expiresAt: Date }> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const ttl = this.env.STORAGE_PRESIGN_TTL_SECONDS;
    const url = await getSignedUrl(this.client, command, { expiresIn: ttl });
    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  /**
   * Confirm an object actually arrived, and matches what was declared.
   *
   * Without this, a client could register evidence metadata and never upload,
   * leaving a baseline that references photographs nobody can retrieve.
   */
  async verifyUpload(
    bucket: string,
    key: string,
    expected: { sizeBytes: number; contentType: string },
  ): Promise<{ present: boolean; sizeMatches: boolean; actualSize?: number; reason?: string }> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const actualSize = head.ContentLength ?? 0;

      if (actualSize !== expected.sizeBytes) {
        return {
          present: true,
          sizeMatches: false,
          actualSize,
          reason: `The uploaded file is ${actualSize} bytes; ${expected.sizeBytes} were declared.`,
        };
      }

      return { present: true, sizeMatches: true, actualSize };
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchKey') {
        return { present: false, sizeMatches: false, reason: 'The file was never uploaded.' };
      }
      this.logger.error(`Failed to head ${key}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Deletion exists for orphaned uploads only.
   *
   * Evidence attached to an assessment or a finding is NEVER deleted — it is
   * the proof behind a claim about a facility, and discarding it would
   * undermine every report that cites it.
   */
  async deleteOrphan(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    this.logger.warn(`Deleted orphaned object ${key}`);
  }
}
