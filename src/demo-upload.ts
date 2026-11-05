import { DeleteObjectCommand } from '@aws-sdk/client-s3';

import { NestFactory } from '@nestjs/core';

import { spawnSync } from 'node:child_process';

import net from 'node:net';

import AppDataSource from './data-source';

import { AppModule } from './app.module';

import { getStorageClient } from './files/storage.client';

import { getStorageConfig } from './files/storage.config';

const USER_ID = 1;

const FIRST_PORT = 32126;
const SECOND_PORT = 32127;

const API_HOST = '127.0.0.1';

const DEMO_PASSWORD = 'Password123!';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

interface IntentResponse {
  fileId: string;
  key: string;
  uploadUrl: string;
  expiresIn: number;
}

interface FileKeyRow {
  object_key: string;
}

async function ensureDataSource(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}

async function cleanDemoState(): Promise<void> {
  await ensureDataSource();

  const rows = (await AppDataSource.query(
    `
        SELECT object_key
        FROM files
        WHERE owner_id = $1
      `,
    [USER_ID],
  )) as FileKeyRow[];

  const client = getStorageClient();

  const storage = getStorageConfig();

  for (const row of rows) {
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: storage.bucket,
          Key: row.object_key,
        }),
      );
    } catch {
      // Cleanup must tolerate already missing objects.
    }
  }

  await AppDataSource.query(
    `
      DELETE FROM files
      WHERE owner_id = $1
    `,
    [USER_ID],
  );

  await AppDataSource.query(
    `
      DELETE FROM refresh_tokens
      WHERE user_id = $1
    `,
    [USER_ID],
  );

  await AppDataSource.query(`
    DELETE FROM access_token_denylist
  `);
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({
      host: API_HOST,
      port,
    });

    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(500);

    socket.once('connect', () => finish(true));

    socket.once('timeout', () => finish(false));

    socket.once('error', () => finish(false));
  });
}

async function login(baseUrl: string): Promise<LoginResponse> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: 'anna@example.com',
      password: DEMO_PASSWORD,
    }),
  });

  if (response.status !== 200) {
    throw new Error(`Login failed: ${response.status}`);
  }

  return response.json() as Promise<LoginResponse>;
}

async function createIntent(
  baseUrl: string,
  accessToken: string,
  input: {
    filename: string;
    contentType: string;
    size: number;
  },
): Promise<{
  status: number;
  body: IntentResponse;
}> {
  const response = await fetch(`${baseUrl}/uploads/intent`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const body = (await response.json()) as IntentResponse;

  return {
    status: response.status,
    body,
  };
}

async function commit(
  baseUrl: string,
  accessToken: string,
  fileId: string,
): Promise<number> {
  const response = await fetch(`${baseUrl}/uploads/commit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      fileId,
    }),
  });

  return response.status;
}

function credentiallessPut(
  url: string,
  body: Buffer,
  contentType: string,
): number {
  const childEnv = {
    ...process.env,
  };

  delete childEnv.STORAGE_ACCESS_KEY;

  delete childEnv.STORAGE_SECRET_KEY;

  delete childEnv.AWS_ACCESS_KEY_ID;

  delete childEnv.AWS_SECRET_ACCESS_KEY;

  delete childEnv.AWS_SESSION_TOKEN;

  const script = `
    const [url, data, contentType] = process.argv.slice(1);

    fetch(url, {
      method: 'PUT',
      headers: {
        'content-type': contentType,
      },
      body: Buffer.from(data, 'base64'),
    })
      .then(response => {
        console.log(response.status);
        process.exit(
          response.status >= 200 &&
          response.status < 500
            ? 0
            : 1
        );
      })
      .catch(error => {
        console.error(error.message);
        process.exit(1);
      });
  `;

  const result = spawnSync(
    process.execPath,
    ['-e', script, url, body.toString('base64'), contentType],
    {
      env: childEnv,
      encoding: 'utf8',
      timeout: 15_000,
    },
  );

  if (result.error) {
    throw result.error;
  }

  const status = Number(result.stdout.trim());

  if (!Number.isInteger(status)) {
    throw new Error(`Credentialless PUT failed: ${result.stderr}`);
  }

  return status;
}

function tamperUrl(signedUrl: string): string {
  const url = new URL(signedUrl);

  const parts = url.pathname.split('/');

  const last = parts.pop();

  if (!last) {
    throw new Error('Unable to tamper presigned URL');
  }

  parts.push(`${last}-tampered`);

  url.pathname = parts.join('/');

  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  process.env.UPLOAD_PRESIGNED_TTL_SECONDS = '300';

  await cleanDemoState();

  let firstApp: Awaited<ReturnType<typeof NestFactory.create>> | null = null;

  let secondApp: Awaited<ReturnType<typeof NestFactory.create>> | null = null;

  try {
    if (await isPortOpen(FIRST_PORT)) {
      throw new Error(`Port ${FIRST_PORT} is already in use`);
    }

    if (await isPortOpen(SECOND_PORT)) {
      throw new Error(`Port ${SECOND_PORT} is already in use`);
    }

    firstApp = await NestFactory.create(AppModule, {
      logger: false,
    });

    await firstApp.listen(FIRST_PORT, API_HOST);

    const firstBaseUrl = `http://${API_HOST}:${FIRST_PORT}`;

    const auth = await login(firstBaseUrl);

    const bytes = Buffer.from('hw26-presigned-upload-demo', 'utf8');

    const intentResult = await createIntent(firstBaseUrl, auth.accessToken, {
      filename: '../../etc/passwd',
      contentType: 'image/png',
      size: bytes.length,
    });

    const intent = intentResult.body;

    const keyFromServer =
      /^uploads\/1\/[0-9a-f-]+\.png$/i.test(intent.key) &&
      !intent.key.includes('..') &&
      !intent.key.includes('etc') &&
      !intent.key.includes('passwd')
        ? 1
        : 0;

    await firstApp.close();
    firstApp = null;

    await sleep(100);

    const apiAlive = (await isPortOpen(FIRST_PORT)) ? 1 : 0;

    const putOffline = credentiallessPut(intent.uploadUrl, bytes, 'image/png');

    secondApp = await NestFactory.create(AppModule, {
      logger: false,
    });

    await secondApp.listen(SECOND_PORT, API_HOST);

    const secondBaseUrl = `http://${API_HOST}:${SECOND_PORT}`;

    const commitStatus = await commit(
      secondBaseUrl,
      auth.accessToken,
      intent.fileId,
    );

    const noBytesIntent = await createIntent(secondBaseUrl, auth.accessToken, {
      filename: 'never-uploaded.png',
      contentType: 'image/png',
      size: bytes.length,
    });

    const commitWithoutBytes = await commit(
      secondBaseUrl,
      auth.accessToken,
      noBytesIntent.body.fileId,
    );

    const tamperedUrl = tamperUrl(noBytesIntent.body.uploadUrl);

    const tampered = credentiallessPut(tamperedUrl, bytes, 'image/png');

    process.env.UPLOAD_PRESIGNED_TTL_SECONDS = '1';

    const expiredIntent = await createIntent(secondBaseUrl, auth.accessToken, {
      filename: 'expired.png',
      contentType: 'image/png',
      size: bytes.length,
    });

    await sleep(2200);

    const expired = credentiallessPut(
      expiredIntent.body.uploadUrl,
      bytes,
      'image/png',
    );

    console.log(`intent=${intentResult.status}`);

    console.log(`key-from-server=${keyFromServer}`);

    console.log(`api-alive=${apiAlive}`);

    console.log(`put-offline=${putOffline}`);

    console.log(`commit=${commitStatus}`);

    console.log(`commit-without-bytes=${commitWithoutBytes}`);

    console.log(`tampered=${tampered}`);

    console.log(`expired=${expired}`);

    const passed =
      intentResult.status === 200 &&
      keyFromServer === 1 &&
      apiAlive === 0 &&
      putOffline === 200 &&
      commitStatus === 200 &&
      commitWithoutBytes >= 400 &&
      commitWithoutBytes < 500 &&
      tampered === 403 &&
      expired === 403;

    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    if (firstApp) {
      await firstApp.close();
    }

    if (secondApp) {
      await secondApp.close();
    }

    process.env.UPLOAD_PRESIGNED_TTL_SECONDS = '300';

    try {
      await cleanDemoState();
    } finally {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
