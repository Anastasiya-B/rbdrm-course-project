#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import { dirname, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

const CURRENT_FILE = fileURLToPath(import.meta.url);

const ROOT = resolve(dirname(CURRENT_FILE), '../..');

function run(command, args, env = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });
}

function statusOf(execution) {
  return execution.status ?? 1;
}

function printFailure(name, execution) {
  console.error(`Unexpected result: ${name}`);

  if (execution.stdout) {
    process.stderr.write(execution.stdout);
  }

  if (execution.stderr) {
    process.stderr.write(execution.stderr);
  }
}

/*
 * Gate 1:
 * TypeScript + ESLint.
 */

const typeOk = run('npx', [
  'tsc',
  '--noEmit',
  '--ignoreConfig',
  '--strict',
  '--target',
  'ES2022',
  '--module',
  'commonjs',
  '--types',
  'node',
  'fixtures/hw32/types/valid.ts',
]);

const lintOk = run('npx', ['eslint', 'fixtures/hw32/types/valid.ts']);

const typeBroken = run('npx', [
  'tsc',
  '--noEmit',
  '--ignoreConfig',
  '--strict',
  '--target',
  'ES2022',
  '--module',
  'commonjs',
  '--types',
  'node',
  'fixtures/hw32/types/broken.ts',
]);

const typesStyleOk = statusOf(typeOk) === 0 && statusOf(lintOk) === 0 ? 0 : 1;

const typesStyleBroken = statusOf(typeBroken);

/*
 * Gate 2:
 * OpenAPI breaking-change detection.
 */

const contractOk = run('bash', [
  'scripts/hw32/contract-gate.sh',
  'fixtures/hw32/contract/base.yaml',
  'fixtures/hw32/contract/valid.yaml',
]);

const contractBroken = run('bash', [
  'scripts/hw32/contract-gate.sh',
  'fixtures/hw32/contract/base.yaml',
  'fixtures/hw32/contract/broken.yaml',
]);

/*
 * Gate 3:
 * Architecture dependency rules.
 */

const architectureOk = run('npx', [
  'dependency-cruise',
  '--config',
  'dependency-cruiser.config.mjs',
  'fixtures/hw32/architecture/valid',
]);

const architectureBroken = run('npx', [
  'dependency-cruise',
  '--config',
  'dependency-cruiser.config.mjs',
  'fixtures/hw32/architecture/broken',
]);

/*
 * Gate 4:
 * Vulnerability threshold.
 */

const scanImage =
  process.env.HW32_SCAN_IMAGE ?? 'gcr.io/distroless/nodejs22-debian12:nonroot';

const pullImage = run('docker', ['pull', scanImage]);

let scanOk;
let scanBroken;

if (statusOf(pullImage) !== 0) {
  scanOk = pullImage;

  scanBroken = pullImage;
} else {
  scanOk = run('npm', ['run', 'scan'], {
    IMAGE_NAME: scanImage,

    SCAN_MAX: '99999',
  });

  scanBroken = run('npm', ['run', 'scan'], {
    IMAGE_NAME: scanImage,

    SCAN_MAX: '-1',
  });
}

const results = {
  'types-style-ok': typesStyleOk,

  'types-style-broken': typesStyleBroken,

  'contract-ok': statusOf(contractOk),

  'contract-broken': statusOf(contractBroken),

  'architecture-ok': statusOf(architectureOk),

  'architecture-broken': statusOf(architectureBroken),

  'image-scan-ok': statusOf(scanOk),

  'image-scan-broken': statusOf(scanBroken),
};

for (const [name, value] of Object.entries(results)) {
  console.log(`${name}=${value}`);
}

const expectations = [
  {
    name: 'types-style-ok',
    shouldPass: true,
    execution: statusOf(typeOk) !== 0 ? typeOk : lintOk,
  },

  {
    name: 'types-style-broken',
    shouldPass: false,
    execution: typeBroken,
  },

  {
    name: 'contract-ok',
    shouldPass: true,
    execution: contractOk,
  },

  {
    name: 'contract-broken',
    shouldPass: false,
    execution: contractBroken,
  },

  {
    name: 'architecture-ok',
    shouldPass: true,
    execution: architectureOk,
  },

  {
    name: 'architecture-broken',
    shouldPass: false,
    execution: architectureBroken,
  },

  {
    name: 'image-scan-ok',
    shouldPass: true,
    execution: scanOk,
  },

  {
    name: 'image-scan-broken',
    shouldPass: false,
    execution: scanBroken,
  },
];

let failed = false;

for (const expectation of expectations) {
  const status = results[expectation.name];

  const correct = expectation.shouldPass ? status === 0 : status !== 0;

  if (correct) {
    continue;
  }

  failed = true;

  printFailure(expectation.name, expectation.execution);
}

if (failed) {
  process.exit(1);
}
