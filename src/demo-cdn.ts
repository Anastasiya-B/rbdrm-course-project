import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { type Server } from 'node:http';

import { clearEdgeCache, createEdgeServer } from './cdn/edge-server';

import { createContentHashedName } from './files/content-hash';

import { ensureStorageBucket, getStorageClient } from './files/storage.client';

import { getStorageConfig } from './files/storage.config';

const HOST = '127.0.0.1';

const PORT = 32128;

const PREFIX = 'cdn';

function storageObjectUrl(key: string): string {
  const config = getStorageConfig();

  if (!config.endpoint) {
    throw new Error('STORAGE_ENDPOINT is required for local CDN demo');
  }

  const endpoint = config.endpoint.replace(/\/+$/, '');

  const encodedKey = key
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');

  return `${endpoint}/${encodeURIComponent(config.bucket)}/${encodedKey}`;
}

function edgeObjectUrl(key: string): string {
  const encodedKey = key
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');

  return `http://${HOST}:${PORT}/${encodedKey}`;
}

async function uploadAsset(key: string, body: Buffer): Promise<void> {
  await ensureStorageBucket();

  const client = getStorageClient();

  const config = getStorageConfig();

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,

      Key: key,

      Body: body,

      ContentType: 'text/css; charset=utf-8',

      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

async function deleteAsset(key: string): Promise<void> {
  const client = getStorageClient();

  const config = getStorageConfig();

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );
  } catch {
    // Cleanup should tolerate missing object.
  }
}

async function startServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);

    server.listen(PORT, HOST, () => {
      server.off('error', reject);

      resolve();
    });
  });
}

async function stopServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });
}

async function main(): Promise<void> {
  await ensureStorageBucket();

  clearEdgeCache();

  const firstContent = Buffer.from(
    ['body {', '  color: red;', '}', ''].join('\n'),
    'utf8',
  );

  const secondContent = Buffer.from(
    ['body {', '  color: blue;', '}', ''].join('\n'),
    'utf8',
  );

  const firstName = createContentHashedName('app.css', firstContent);

  const secondName = createContentHashedName('app.css', secondContent);

  const firstKey = `${PREFIX}/${firstName}`;

  const secondKey = `${PREFIX}/${secondName}`;

  const server = createEdgeServer();

  try {
    await deleteAsset(firstKey);

    await deleteAsset(secondKey);

    await uploadAsset(firstKey, firstContent);

    const directResponse = await fetch(storageObjectUrl(firstKey));

    await startServer(server);

    const firstEdgeResponse = await fetch(edgeObjectUrl(firstKey));

    const firstEdgeBody = Buffer.from(await firstEdgeResponse.arrayBuffer());

    const edgeMiss = firstEdgeResponse.status;

    const firstCacheHeader = firstEdgeResponse.headers.get('x-cache');

    const secondEdgeResponse = await fetch(edgeObjectUrl(firstKey));

    const secondEdgeBody = Buffer.from(await secondEdgeResponse.arrayBuffer());

    const edgeHit = secondEdgeResponse.status;

    const secondCacheHeader = secondEdgeResponse.headers.get('x-cache');

    const cacheHit =
      firstCacheHeader === 'MISS' &&
      secondCacheHeader === 'HIT' &&
      firstEdgeBody.equals(firstContent) &&
      secondEdgeBody.equals(firstContent)
        ? 1
        : 0;

    const newName = firstName !== secondName ? 1 : 0;

    await uploadAsset(secondKey, secondContent);

    const newResponse = await fetch(edgeObjectUrl(secondKey));

    const newBody = Buffer.from(await newResponse.arrayBuffer());

    const contentChanged =
      !newBody.equals(firstEdgeBody) && newBody.equals(secondContent) ? 1 : 0;

    console.log(`direct=${directResponse.status}`);

    console.log(`edge-miss=${edgeMiss}`);

    console.log(`edge-hit=${edgeHit}`);

    console.log(`cache-hit=${cacheHit}`);

    console.log(`new-name=${newName}`);

    console.log(`new-url=${newResponse.status}`);

    console.log(`content-changed=${contentChanged}`);

    const passed =
      directResponse.status === 403 &&
      edgeMiss === 200 &&
      edgeHit === 200 &&
      cacheHit === 1 &&
      newName === 1 &&
      newResponse.status === 200 &&
      contentChanged === 1;

    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    await stopServer(server);

    clearEdgeCache();

    await deleteAsset(firstKey);

    await deleteAsset(secondKey);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
