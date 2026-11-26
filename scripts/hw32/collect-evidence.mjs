#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function readOptional(path, fallback = '') {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallback;
    }

    throw error;
  }
}

function parseKeyValueFile(content) {
  const values = new Map();

  for (const line of content.split(/\r?\n/)) {
    const index = line.indexOf('=');

    if (index <= 0) {
      continue;
    }

    values.set(line.slice(0, index), line.slice(index + 1));
  }

  return values;
}

function countSecretOccurrences(manifest, values) {
  let count = 0;

  for (const value of values) {
    if (typeof value !== 'string' || value.length < 8) {
      continue;
    }

    const variants = [value, JSON.stringify(value).slice(1, -1)];

    for (const variant of new Set(variants)) {
      if (!variant) {
        continue;
      }

      let index = 0;

      while (true) {
        index = manifest.indexOf(variant, index);

        if (index === -1) {
          break;
        }

        count += 1;

        index += variant.length;
      }
    }
  }

  return count;
}

function extractDigest(deploymentRaw) {
  if (!deploymentRaw) {
    return '';
  }

  try {
    const deployment = JSON.parse(deploymentRaw);

    const image = deployment?.spec?.template?.spec?.containers?.[0]?.image;

    if (typeof image !== 'string') {
      return '';
    }

    const separator = image.lastIndexOf('@sha256:');

    if (separator === -1) {
      return '';
    }

    return image.slice(separator + 1);
  } catch {
    return '';
  }
}

async function main() {
  const runId = requiredEnv('EVIDENCE_RUN_ID');

  const headSha = requiredEnv('EVIDENCE_HEAD_SHA');

  const imageRef = requiredEnv('EVIDENCE_IMAGE_REF');

  const builtDigest = requiredEnv('EVIDENCE_BUILT_DIGEST');

  const deploymentRaw = await readOptional('evidence/hw32/deployment.json');

  const deployedDigest = extractDigest(deploymentRaw);

  const digestEqual =
    Boolean(deployedDigest) && deployedDigest === builtDigest;

  const buildLog = await readOptional('evidence/hw32/build.log');

  const buildInvocations = buildLog.split(/\r?\n/).filter(Boolean).length;

  const oidc = parseKeyValueFile(await readOptional('evidence/hw32/oidc.txt'));

  const rollout = parseKeyValueFile(
    await readOptional('evidence/hw32/rollout.txt'),
  );

  const scanExit = (
    await readOptional('evidence/hw32/gate-scan-exit.txt', '-1')
  ).trim();

  const secretValues = [
    process.env.APP_DB_PASSWORD,
    process.env.JWT_KID,
    process.env.JWT_PRIVATE_KEY,
    process.env.JWT_PUBLIC_KEY,
    process.env.REFRESH_TOKEN_PEPPER,
  ].filter(Boolean);

  const secretInManifest = deploymentRaw
    ? countSecretOccurrences(deploymentRaw, secretValues)
    : 0;

  const lines = [
    `run-id=${runId}`,
    `head-sha=${headSha}`,

    `image-ref=${imageRef}`,
    `built-digest=${builtDigest}`,
    `deployed-digest=${deployedDigest}`,
    `digest-equal=${digestEqual}`,
    `build-invocations=${buildInvocations}`,

    'creds-source=oidc',

    `oidc-iss=${oidc.get('iss') ?? ''}`,
    `oidc-aud=${oidc.get('aud') ?? ''}`,
    `oidc-sub=${oidc.get('sub') ?? ''}`,
    `oidc-sig-verified=${oidc.get('sig-verified') ?? '0'}`,

    `rollout-requests=${rollout.get('requests') ?? '0'}`,
    `rollout-ok=${rollout.get('ok') ?? '0'}`,
    `rollout-failed=${rollout.get('failed') ?? '0'}`,
    `rollout-seconds=${rollout.get('rollout-seconds') ?? '0'}`,
    `before-revision=${rollout.get('before-revision') ?? ''}`,
    `after-revision=${rollout.get('after-revision') ?? ''}`,
    `rolling-update=${rollout.get('rolling-update') ?? 'false'}`,

    `secret-in-manifest=${secretInManifest}`,
    `gate-scan-exit=${scanExit}`,
  ];

  await writeFile('evidence/hw32/evidence.txt', `${lines.join('\n')}\n`);

  if (!digestEqual) {
    throw new Error(
      `deployment digest mismatch: built=${builtDigest} deployed=${deployedDigest || 'missing'}`,
    );
  }

  if (rollout.get('rolling-update') !== 'true') {
    throw new Error('rolling update evidence is missing');
  }

  const requests = Number(rollout.get('requests') ?? '0');
  const failed = Number(rollout.get('failed') ?? '-1');

  if (!Number.isInteger(requests) || requests < 5000) {
    throw new Error(`rollout request count is below 5000: ${requests}`);
  }

  if (failed !== 0) {
    throw new Error(`rollout has failed requests: ${failed}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));

  process.exit(1);
});
