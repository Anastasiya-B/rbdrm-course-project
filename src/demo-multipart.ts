import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

import { spawnSync } from 'node:child_process';

import {
  calculatePartSize,
  cleanupMultipartUploads,
  completeMultipartUpload,
  createMultipartUpload,
  createPartUrl,
  listUploadedParts,
} from './files/multipart';

import { ensureStorageBucket, getStorageClient } from './files/storage.client';

import { getStorageConfig } from './files/storage.config';

const KEY = 'multipart/hw26-demo.bin';

function credentiallessPut(url: string, body: Buffer): number {
  const childEnv = {
    ...process.env,
  };

  delete childEnv.STORAGE_ACCESS_KEY;
  delete childEnv.STORAGE_SECRET_KEY;
  delete childEnv.AWS_ACCESS_KEY_ID;
  delete childEnv.AWS_SECRET_ACCESS_KEY;
  delete childEnv.AWS_SESSION_TOKEN;

  const script = `
    const url = process.argv[1];

    const chunks = [];

    process.stdin.on(
      'data',
      chunk => {
        chunks.push(chunk);
      }
    );

    process.stdin.on(
      'end',
      async () => {
        try {
          const body =
            Buffer.concat(chunks);

          const response =
            await fetch(
              url,
              {
                method: 'PUT',
                body,
              }
            );

          console.log(
            response.status
          );

          process.exit(
            response.ok
              ? 0
              : 1
          );
        } catch (error) {
          console.error(
            error instanceof Error
              ? error.message
              : String(error)
          );

          process.exit(1);
        }
      }
    );
  `;

  const result = spawnSync(process.execPath, ['-e', script, url], {
    env: childEnv,
    input: body,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`UploadPart process failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(
      [
        'UploadPart failed',
        `exit=${result.status}`,
        `stdout=${result.stdout?.trim() ?? ''}`,
        `stderr=${result.stderr?.trim() ?? ''}`,
      ].join(' '),
    );
  }

  const status = Number(result.stdout.trim());

  if (!Number.isInteger(status)) {
    throw new Error(
      `UploadPart returned invalid HTTP status: ${result.stdout}`,
    );
  }

  return status;
}

async function deleteDemoObject(): Promise<void> {
  const client = getStorageClient();

  const config = getStorageConfig();

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: KEY,
      }),
    );
  } catch {
    // Object may not exist.
  }
}

async function clean(): Promise<void> {
  await ensureStorageBucket();

  await cleanupMultipartUploads();

  await deleteDemoObject();
}

async function getHeadStatus(): Promise<number> {
  const client = getStorageClient();

  const config = getStorageConfig();

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: KEY,
      }),
    );

    return 200;
  } catch (error) {
    const status = (
      error as {
        $metadata?: {
          httpStatusCode?: number;
        };
      }
    ).$metadata?.httpStatusCode;

    return status ?? 500;
  }
}

async function main(): Promise<void> {
  await clean();

  try {
    const requestedFileSize = 15 * 1024 * 1024;

    const partSize = calculatePartSize(requestedFileSize);

    const part1 = Buffer.alloc(partSize, 0x41);

    const part2 = Buffer.alloc(partSize, 0x42);

    const part3 = Buffer.alloc(1024 * 1024, 0x43);

    const totalSize = part1.length + part2.length + part3.length;

    const uploadId = await createMultipartUpload(
      KEY,
      'application/octet-stream',
    );

    const url1 = await createPartUrl(KEY, uploadId, 1);

    const url2 = await createPartUrl(KEY, uploadId, 2);

    const firstPartStatus = credentiallessPut(url1, part1);

    if (firstPartStatus !== 200) {
      throw new Error(`Part 1 returned ${firstPartStatus}`);
    }

    const secondPartStatus = credentiallessPut(url2, part2);

    if (secondPartStatus !== 200) {
      throw new Error(`Part 2 returned ${secondPartStatus}`);
    }

    const headBeforeComplete = await getHeadStatus();

    const alreadyUploaded = await listUploadedParts(KEY, uploadId);

    const uploadedNumbers = new Set(
      alreadyUploaded.map(part => part.partNumber),
    );

    let resumedParts = 0;

    const allParts = [
      {
        partNumber: 1,
        body: part1,
      },
      {
        partNumber: 2,
        body: part2,
      },
      {
        partNumber: 3,
        body: part3,
      },
    ];

    for (const part of allParts) {
      if (uploadedNumbers.has(part.partNumber)) {
        continue;
      }

      const url = await createPartUrl(KEY, uploadId, part.partNumber);

      const status = credentiallessPut(url, part.body);

      if (status !== 200) {
        throw new Error(`Part ${part.partNumber} returned ${status}`);
      }

      resumedParts += 1;
    }

    const etag = await completeMultipartUpload(KEY, uploadId);

    const client = getStorageClient();

    const config = getStorageConfig();

    const head = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: KEY,
      }),
    );

    const actualSize = head.ContentLength ?? 0;

    const sizeMatch = actualSize === totalSize ? 1 : 0;

    const finalEtag = (head.ETag ?? etag).replaceAll('"', '');

    const etagMultipart = /-\d+$/.test(finalEtag) ? 1 : 0;

    console.log(`head-before-complete=${headBeforeComplete}`);

    console.log(`resumed-parts=${resumedParts}`);

    console.log('complete=200');

    console.log(`size-match=${sizeMatch}`);

    console.log(`etag-multipart=${etagMultipart}`);

    const passed =
      headBeforeComplete === 404 &&
      resumedParts === 1 &&
      sizeMatch === 1 &&
      etagMultipart === 1;

    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    await clean();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
