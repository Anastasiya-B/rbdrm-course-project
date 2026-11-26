#!/usr/bin/env node

import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const CURRENT_FILE = fileURLToPath(import.meta.url);

const CURRENT_DIR = dirname(CURRENT_FILE);

const ROOT = resolve(CURRENT_DIR, '..');

const gatePath = resolve(ROOT, 'scripts/hw32/oidc-gate.mjs');

const sourcePolicy = JSON.parse(
  await readFile(resolve(ROOT, 'oidc/policy.json'), 'utf8'),
);

const tempDir = await mkdtemp(join(tmpdir(), 'hw32-oidc-'));

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createToken({ privateKey, kid, issuer, audience, subject }) {
  const now = Math.floor(Date.now() / 1000);

  const header = encodeJson({
    alg: 'RS256',
    typ: 'JWT',
    kid,
  });

  const payload = encodeJson({
    iss: issuer,
    aud: audience,
    sub: subject,
    iat: now,
    nbf: now - 1,
    exp: now + 300,
  });

  const input = `${header}.${payload}`;

  const signature = sign('RSA-SHA256', Buffer.from(input), privateKey).toString(
    'base64url',
  );

  return `${input}.${signature}`;
}

function corruptSignature(token) {
  const segments = token.split('.');

  const signature = segments[2];

  const last = signature.at(-1);

  segments[2] = `${signature.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;

  return segments.join('.');
}

function runGate(token, policyPath, jwksPath) {
  return spawnSync(process.execPath, [gatePath], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,

      OIDC_TOKEN: token,

      OIDC_POLICY_FILE: policyPath,

      OIDC_JWKS_URI: pathToFileURL(jwksPath).href,
    },
  });
}

function parseResult(stdout) {
  const result = new Map();

  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf('=');

    if (index <= 0) {
      continue;
    }

    result.set(
      line.slice(0, index),

      line.slice(index + 1),
    );
  }

  return {
    sigVerified: Number(result.get('sig-verified') ?? -1),

    policyAllow: Number(result.get('policy-allow') ?? -1),
  };
}

try {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  const kid = randomUUID();

  const publicJwk = publicKey.export({
    format: 'jwk',
  });

  const jwksPath = join(tempDir, 'jwks.json');

  const policyPath = join(tempDir, 'policy.json');

  await writeFile(
    jwksPath,

    JSON.stringify({
      keys: [
        {
          ...publicJwk,
          kid,
          alg: 'RS256',
          use: 'sig',
        },
      ],
    }),
  );

  const issuer = 'https://issuer.hw32.local';

  const audience = sourcePolicy.audience;

  const allowedSubject = 'repo:example-org/example-repo:ref:refs/heads/main';

  await writeFile(
    policyPath,

    JSON.stringify({
      issuer,
      audience,
      allowedSubjects: [allowedSubject],
    }),
  );

  const greenToken = createToken({
    privateKey,
    kid,
    issuer,
    audience,
    subject: allowedSubject,
  });

  const foreignToken = createToken({
    privateKey,
    kid,
    issuer,
    audience,
    subject: 'repo:foreign-org/foreign-repo:ref:refs/heads/main',
  });

  const cases = [
    {
      name: 'green',
      token: greenToken,
      expected: [1, 1],
    },

    {
      name: 'foreign-sub',
      token: foreignToken,
      expected: [1, 0],
    },

    {
      name: 'bad-signature',
      token: corruptSignature(greenToken),
      expected: [0, 0],
    },
  ];

  let failed = false;

  for (const testCase of cases) {
    const execution = runGate(testCase.token, policyPath, jwksPath);

    const result = parseResult(execution.stdout);

    console.log(`case=${testCase.name}`);

    console.log(`sig-verified=${result.sigVerified}`);

    console.log(`policy-allow=${result.policyAllow}`);

    if (
      result.sigVerified !== testCase.expected[0] ||
      result.policyAllow !== testCase.expected[1]
    ) {
      failed = true;

      if (execution.stderr) {
        process.stderr.write(execution.stderr);
      }
    }
  }

  process.exitCode = failed ? 1 : 0;
} finally {
  await rm(tempDir, {
    recursive: true,
    force: true,
  });
}
