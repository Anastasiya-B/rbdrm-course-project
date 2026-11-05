import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { randomUUID } from 'node:crypto';

import { DatabaseService } from '../database.service';

import { extensionForContentType, isAllowedContentType } from './file-types';

import { ensureStorageBucket, getStorageClient } from './storage.client';
import { getStorageConfig } from './storage.config';

const DEFAULT_PRESIGNED_UPLOAD_TTL_SECONDS = 5 * 60;

interface FileRow {
  id: string;
  owner_id: string;
  object_key: string;
  content_type: string;
  status: 'PENDING' | 'COMPLETED';
  expected_size: string | null;
  actual_size: string | null;
  upload_id: string | null;
}

export interface CreateUploadIntentInput {
  filename?: string;
  contentType: string;
  size?: number;
}

export interface UploadIntentResponse {
  fileId: string;
  key: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface CommitUploadResponse {
  fileId: string;
  key: string;
  status: 'COMPLETED';
  size: number;
}

function getPresignedUploadTtlSeconds(): number {
  const raw = process.env.UPLOAD_PRESIGNED_TTL_SECONDS;

  if (!raw) {
    return DEFAULT_PRESIGNED_UPLOAD_TTL_SECONDS;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0 || value > 7 * 24 * 60 * 60) {
    throw new Error(
      'UPLOAD_PRESIGNED_TTL_SECONDS must be an integer between 1 and 604800',
    );
  }

  return value;
}

@Injectable()
export class FilesService {
  constructor(private readonly databaseService: DatabaseService) {}

  async createUploadIntent(
    userId: number,
    input: CreateUploadIntentInput,
  ): Promise<UploadIntentResponse> {
    await ensureStorageBucket();
    if (!isAllowedContentType(input.contentType)) {
      throw new BadRequestException(
        `Unsupported content type: ${input.contentType}`,
      );
    }

    if (
      input.size !== undefined &&
      (!Number.isInteger(input.size) || input.size < 0)
    ) {
      throw new BadRequestException('size must be a non-negative integer');
    }

    const fileId = randomUUID();

    const extension = extensionForContentType(input.contentType);

    const key = `uploads/${userId}/${randomUUID()}.${extension}`;

    await this.databaseService.query(
      `
        INSERT INTO files (
          id,
          owner_id,
          object_key,
          content_type,
          status,
          expected_size
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'PENDING',
          $5
        )
      `,
      [fileId, userId, key, input.contentType, input.size ?? null],
    );

    const storage = getStorageConfig();

    const client = getStorageClient();

    const command = new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      ContentType: input.contentType,
    });

    const expiresIn = getPresignedUploadTtlSeconds();

    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn,
    });

    return {
      fileId,
      key,
      uploadUrl,
      expiresIn,
    };
  }

  async commitUpload(
    userId: number,
    fileId: string,
  ): Promise<CommitUploadResponse> {
    await ensureStorageBucket();
    const result = await this.databaseService.query<FileRow>(
      `
          SELECT
            id,
            owner_id,
            object_key,
            content_type,
            status,
            expected_size,
            actual_size,
            upload_id
          FROM files
          WHERE id = $1
          LIMIT 1
        `,
      [fileId],
    );

    const file = result.rows[0];

    if (!file) {
      throw new NotFoundException(`File ${fileId} not found`);
    }

    if (Number(file.owner_id) !== userId) {
      throw new ForbiddenException('File belongs to another user');
    }

    if (file.status === 'COMPLETED') {
      return {
        fileId: file.id,
        key: file.object_key,
        status: 'COMPLETED',
        size: Number(file.actual_size ?? file.expected_size ?? 0),
      };
    }

    const storage = getStorageConfig();

    const client = getStorageClient();

    let contentLength: number;

    try {
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: storage.bucket,
          Key: file.object_key,
        }),
      );

      if (head.ContentLength === undefined) {
        throw new ConflictException('Uploaded object has no size');
      }

      contentLength = head.ContentLength;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      throw new ConflictException('Object has not been uploaded');
    }

    if (
      file.expected_size !== null &&
      Number(file.expected_size) !== contentLength
    ) {
      throw new ConflictException(
        'Uploaded object size does not match expected size',
      );
    }

    await this.databaseService.query(
      `
        UPDATE files
        SET
          status = 'COMPLETED',
          actual_size = $2,
          completed_at = now()
        WHERE id = $1
      `,
      [file.id, contentLength],
    );

    return {
      fileId: file.id,
      key: file.object_key,
      status: 'COMPLETED',
      size: contentLength,
    };
  }
}
