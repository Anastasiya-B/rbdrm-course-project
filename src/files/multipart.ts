import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { getStorageClient, ensureStorageBucket } from './storage.client';

import { getStorageConfig } from './storage.config';

const MIN_PART_SIZE = 5 * 1024 * 1024;

const MAX_PARTS = 10_000;

export function calculatePartSize(fileSize: number): number {
  const byPartLimit = Math.ceil(fileSize / MAX_PARTS);

  return Math.max(MIN_PART_SIZE, byPartLimit);
}

export async function createMultipartUpload(
  key: string,
  contentType: string,
): Promise<string> {
  await ensureStorageBucket();

  const client = getStorageClient();

  const config = getStorageConfig();

  const response = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
    }),
  );

  if (!response.UploadId) {
    throw new Error('Storage did not return UploadId');
  }

  return response.UploadId;
}

export async function createPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn = 300,
): Promise<string> {
  const client = getStorageClient();

  const config = getStorageConfig();

  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    {
      expiresIn,
    },
  );
}

export async function listUploadedParts(
  key: string,
  uploadId: string,
): Promise<
  Array<{
    partNumber: number;
    etag: string;
    size: number;
  }>
> {
  const client = getStorageClient();

  const config = getStorageConfig();

  const response = await client.send(
    new ListPartsCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
    }),
  );

  return (response.Parts ?? [])
    .filter(part => part.PartNumber !== undefined && part.ETag)
    .map(part => ({
      partNumber: part.PartNumber!,
      etag: part.ETag!,
      size: part.Size ?? 0,
    }));
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
): Promise<string> {
  const client = getStorageClient();

  const config = getStorageConfig();

  const parts = await listUploadedParts(key, uploadId);

  if (parts.length === 0) {
    throw new Error('Multipart upload has no uploaded parts');
  }

  const response = await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .sort((a, b) => a.partNumber - b.partNumber)
          .map(part => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
      },
    }),
  );

  return response.ETag ?? '';
}

export async function abortMultipartUpload(
  key: string,
  uploadId: string,
): Promise<void> {
  const client = getStorageClient();

  const config = getStorageConfig();

  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
    }),
  );
}

export async function cleanupMultipartUploads(): Promise<void> {
  await ensureStorageBucket();

  const client = getStorageClient();

  const config = getStorageConfig();

  const response = await client.send(
    new ListMultipartUploadsCommand({
      Bucket: config.bucket,
    }),
  );

  for (const upload of response.Uploads ?? []) {
    if (!upload.Key || !upload.UploadId) {
      continue;
    }

    await abortMultipartUpload(upload.Key, upload.UploadId);
  }
}
