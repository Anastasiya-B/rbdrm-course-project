import { GetObjectCommand } from '@aws-sdk/client-s3';

import { createServer, type Server } from 'node:http';

import { getStorageClient } from '../files/storage.client';

import { getStorageConfig } from '../files/storage.config';

interface CachedObject {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

const cache = new Map<string, CachedObject>();

async function loadObject(key: string): Promise<CachedObject> {
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  const client = getStorageClient();

  const config = getStorageConfig();

  const result = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );

  if (!result.Body) {
    throw new Error('Object body is empty');
  }

  const bytes = await result.Body.transformToByteArray();

  const object: CachedObject = {
    body: Buffer.from(bytes),

    contentType: result.ContentType ?? 'application/octet-stream',

    cacheControl: result.CacheControl ?? 'public, max-age=31536000, immutable',
  };

  cache.set(key, object);

  return object;
}

export function clearEdgeCache(): void {
  cache.clear();
}

export function createEdgeServer(): Server {
  return createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') {
        response.statusCode = 405;

        response.end('Method Not Allowed');

        return;
      }

      const requestUrl = new URL(request.url ?? '/', 'http://localhost');

      const encodedKey = requestUrl.pathname.replace(/^\/+/, '');

      if (!encodedKey) {
        response.statusCode = 404;

        response.end('Not Found');

        return;
      }

      const key = encodedKey
        .split('/')
        .map(segment => decodeURIComponent(segment))
        .join('/');

      const wasCached = cache.has(key);

      const object = await loadObject(key);

      response.statusCode = 200;

      response.setHeader('Content-Type', object.contentType);

      response.setHeader('Cache-Control', object.cacheControl);

      response.setHeader('X-Cache', wasCached ? 'HIT' : 'MISS');

      response.end(object.body);
    } catch {
      response.statusCode = 404;

      response.end('Not Found');
    }
  });
}
