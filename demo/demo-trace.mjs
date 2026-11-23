import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3012';

const TRACE_API_URL = process.env.TRACE_API_URL ?? 'http://127.0.0.1:22904';

const LOG_FILE = process.env.TRACE_LOG_FILE;

if (!LOG_FILE) {
  throw new Error('TRACE_LOG_FILE is required');
}

function createTraceparent() {
  const traceId = randomBytes(16).toString('hex');

  const parentId = randomBytes(8).toString('hex');

  return {
    traceId,
    parentId,
    value: `00-${traceId}-${parentId}-01`,
  };
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/*
 * Tempo's OTLP JSON representation may
 * expose byte fields as base64 while
 * traceparent and application logs use hex.
 *
 * Normalize both forms to lowercase hex.
 */
function normalizeId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }

  const trimmed = value.trim();

  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
    return trimmed.toLowerCase();
  }

  try {
    return Buffer.from(trimmed, 'base64').toString('hex').toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function collectSpans(value) {
  const spans = [];

  function visit(node) {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (typeof node.traceId === 'string' && typeof node.spanId === 'string') {
      spans.push(node);
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }

      return;
    }

    for (const child of Object.values(node)) {
      visit(child);
    }
  }

  visit(value);

  return spans;
}

function isErrorSpan(span) {
  const code = span?.status?.code;

  return (
    code === 2 ||
    code === '2' ||
    code === 'ERROR' ||
    code === 'STATUS_CODE_ERROR'
  );
}

async function fetchTrace(traceId) {
  const deadline = Date.now() + 30_000;

  let lastStatus = 0;

  while (Date.now() < deadline) {
    const response = await fetch(`${TRACE_API_URL}/api/traces/${traceId}`);

    lastStatus = response.status;

    if (response.ok) {
      const body = await response.json();

      const spans = collectSpans(body);

      if (spans.length > 0) {
        return spans;
      }
    }

    await sleep(500);
  }

  throw new Error(
    `Trace ${traceId} not available; last HTTP status=${lastStatus}`,
  );
}

async function readStructuredLogs() {
  const text = await readFile(LOG_FILE, 'utf8');

  const result = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    try {
      result.push(JSON.parse(line));
    } catch {
      /*
       * Nest startup lines are not
       * structured application logs.
       */
    }
  }

  return result;
}

async function main() {
  const trace = createTraceparent();

  const response = await fetch(`${API_URL}/observability/orders/1?fail=1`, {
    headers: {
      traceparent: trace.value,
    },
  });

  await response.text().catch(() => {});

  if (response.status !== 500) {
    throw new Error(`Expected HTTP 500, got ${response.status}`);
  }

  const spans = await fetchTrace(trace.traceId);

  const normalizedTraceId = normalizeId(trace.traceId);

  const normalizedParentId = normalizeId(trace.parentId);

  const traceIds = new Set(spans.map(span => normalizeId(span.traceId)));

  const traceMatchesHeader =
    traceIds.size === 1 && traceIds.has(normalizedTraceId) ? 1 : 0;

  const spanIds = new Set(spans.map(span => normalizeId(span.spanId)));

  let orphanSpans = 0;

  for (const span of spans) {
    const parentSpanId = normalizeId(span.parentSpanId);

    /*
     * A true root span may have no
     * parent at all.
     */
    if (!parentSpanId || parentSpanId === '0000000000000000') {
      continue;
    }

    /*
     * The incoming HTTP server span
     * is allowed to reference the
     * parent-id supplied by the
     * external traceparent header.
     *
     * That parent belongs to the
     * caller and therefore is not
     * exported by this process.
     */
    if (parentSpanId === normalizedParentId) {
      continue;
    }

    if (!spanIds.has(parentSpanId)) {
      orphanSpans += 1;
    }
  }

  const logs = await readStructuredLogs();

  const matchingLogs = logs.filter(
    item => normalizeId(item.trace_id) === normalizedTraceId,
  );

  const traceMatchesLog =
    matchingLogs.length > 0 &&
    matchingLogs.every(item => normalizeId(item.trace_id) === normalizedTraceId)
      ? 1
      : 0;

  const spanStatusError = spans.some(isErrorSpan) ? 1 : 0;

  console.log(`spans=${spans.length}`);

  console.log(`orphan-spans=${orphanSpans}`);

  console.log(`trace-matches-header=${traceMatchesHeader}`);

  console.log(`trace-matches-log=${traceMatchesLog}`);

  console.log(`span-status-error=${spanStatusError}`);

  const ok =
    spans.length >= 2 &&
    orphanSpans === 0 &&
    traceMatchesHeader === 1 &&
    traceMatchesLog === 1 &&
    spanStatusError === 1;

  process.exit(ok ? 0 : 1);
}

main().catch(error => {
  console.error(error);

  process.exit(1);
});
