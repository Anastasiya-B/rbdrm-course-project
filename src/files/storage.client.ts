import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { getStorageConfig } from './storage.config';

let client: S3Client | null = null;

let initialized = false;

export function getStorageClient(): S3Client {
  if (client) {
    return client;
  }

  const config = getStorageConfig();

  client = new S3Client({
    region: config.region,

    endpoint: config.endpoint,

    forcePathStyle: Boolean(config.endpoint),

    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },

    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  return client;
}

export async function ensureStorageBucket(): Promise<void> {
  if (initialized) {
    return;
  }

  const config = getStorageConfig();

  const storageClient = getStorageClient();

  try {
    await storageClient.send(
      new HeadBucketCommand({
        Bucket: config.bucket,
      }),
    );
  } catch {
    await storageClient.send(
      new CreateBucketCommand({
        Bucket: config.bucket,
      }),
    );
  }

  try {
    await storageClient.send(
      new PutPublicAccessBlockCommand({
        Bucket: config.bucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      }),
    );
  } catch {
    // Some S3-compatible emulators do not implement
    // PutPublicAccessBlock. A newly-created MinIO bucket
    // is private by default.
  }

  initialized = true;
}
