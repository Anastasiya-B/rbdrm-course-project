#!/usr/bin/env node

import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function decodeJsonSegment(segment, label) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`Invalid JWT ${label}`);
  }
}

async function loadJson(location) {
  if (location.startsWith('file://')) {
    return JSON.parse(await readFile(fileURLToPath(location), 'utf8'));
  }

  const response = await fetch(location, {
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load ${location}: HTTP ${response.status}`);
  }

  return response.json();
}

function audienceMatches(actual, expected) {
  if (typeof actual === 'string') {
    return actual === expected;
  }

  return Array.isArray(actual) && actual.includes(expected);
}

function validateTimeClaims(payload) {
  const now = Math.floor(Date.now() / 1000);

  if (typeof payload.exp === 'number' && payload.exp <= now) {
    return false;
  }

  if (typeof payload.nbf === 'number' && payload.nbf > now) {
    return false;
  }

  return true;
}

async function main() {
  const token = requiredEnv('OIDC_TOKEN');
  const jwksUri = requiredEnv('OIDC_JWKS_URI');

  const policyPath = process.env.OIDC_POLICY_FILE ?? 'oidc/policy.json';

  const policy = JSON.parse(await readFile(policyPath, 'utf8'));

  if (
    typeof policy.issuer !== 'string' ||
    typeof policy.audience !== 'string' ||
    !Array.isArray(policy.allowedSubjects) ||
    policy.allowedSubjects.length === 0
  ) {
    throw new Error('OIDC policy is malformed');
  }

  const segments = token.split('.');

  if (segments.length !== 3) {
    throw new Error('OIDC token must contain three JWT segments');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;

  const header = decodeJsonSegment(encodedHeader, 'header');

  const payload = decodeJsonSegment(encodedPayload, 'payload');

  const jwks = await loadJson(jwksUri);

  const jwk = (jwks.keys ?? []).find(
    key => key.kid === header.kid && key.kty === 'RSA',
  );

  let signatureVerified = false;

  if (header.alg === 'RS256' && jwk) {
    const publicKey = createPublicKey({
      key: jwk,
      format: 'jwk',
    });

    signatureVerified = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      Buffer.from(encodedSignature, 'base64url'),
    );
  }

  const issuerMatches = payload.iss === policy.issuer;

  const audMatches = audienceMatches(payload.aud, policy.audience);

  const subjectMatches =
    typeof payload.sub === 'string' &&
    policy.allowedSubjects.includes(payload.sub);

  const timeClaimsValid = validateTimeClaims(payload);

  const policyAllow =
    signatureVerified &&
    issuerMatches &&
    audMatches &&
    subjectMatches &&
    timeClaimsValid;

  const printableAudience = Array.isArray(payload.aud)
    ? payload.aud.join(',')
    : String(payload.aud ?? '');

  console.log(`iss=${String(payload.iss ?? '')}`);

  console.log(`aud=${printableAudience}`);

  console.log(`sub=${String(payload.sub ?? '')}`);

  console.log(`sig-verified=${signatureVerified ? 1 : 0}`);

  console.log(`policy-allow=${policyAllow ? 1 : 0}`);

  process.exit(policyAllow ? 0 : 1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));

  process.exit(2);
});
