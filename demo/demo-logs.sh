#!/usr/bin/env bash

set -euo pipefail

ROOT="$(
  cd "$(dirname "$0")/.." &&
  pwd
)"

LOG_FILE="$(
  mktemp
)"

META_FILE="$(
  mktemp
)"

API_PID=""

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi

  rm -f \
    "$LOG_FILE" \
    "$META_FILE"
}

trap cleanup EXIT INT TERM

cd "$ROOT"

node dist/main.js \
  >"$LOG_FILE" \
  2>&1 &

API_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS \
    http://127.0.0.1:3000/healthz \
    >/dev/null 2>&1
  then
    break
  fi

  sleep 0.25
done

if ! curl -fsS \
  http://127.0.0.1:3000/healthz \
  >/dev/null
then
  echo "API failed to start" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

node demo/demo-logs.mjs \
  >"$META_FILE"

sleep 1

node - "$LOG_FILE" "$META_FILE" <<'NODE'
const fs =
  require('node:fs');

const [
  logPath,
  metaPath,
] =
  process.argv.slice(2);

const rawLines =
  fs.readFileSync(
    logPath,
    'utf8',
  )
    .split('\n')
    .filter(Boolean);

const meta =
  JSON.parse(
    fs.readFileSync(
      metaPath,
      'utf8',
    ).trim(),
  );

const jsonLines = [];
let nonJsonLines = 0;

for (
  const line of rawLines
) {
  try {
    const parsed =
      JSON.parse(line);

    jsonLines.push(
      parsed,
    );
  } catch {
    /*
     * Nest startup output is not part
     * of the structured application
     * request log.
     */
    if (
      line.includes(
        '"layer":',
      )
    ) {
      nonJsonLines += 1;
    }
  }
}

const requestLogs =
  jsonLines.filter(
    item =>
      typeof item.layer ===
        'string' &&
      typeof item.trace_id ===
        'string',
  );

const normalLogs =
  requestLogs.filter(
    item =>
      item.trace_id ===
      meta.normalTraceId,
  );

const layers =
  new Set(
    normalLogs.map(
      item =>
        item.layer,
    ),
  ).size;

const distinctTraceIds =
  new Set(
    normalLogs.map(
      item =>
        item.trace_id,
    ),
  ).size;

const traceIdMatchesHeader =
  normalLogs.length > 0 &&
  normalLogs.every(
    item =>
      item.trace_id ===
      meta.normalTraceId,
  )
    ? 1
    : 0;

const burstGroups =
  new Map();

for (
  const traceId of
  meta.burstTraceIds
) {
  burstGroups.set(
    traceId,
    [],
  );
}

for (
  const item of requestLogs
) {
  const group =
    burstGroups.get(
      item.trace_id,
    );

  if (group) {
    group.push(
      item,
    );
  }
}

const burstTraceIds =
  [...burstGroups.values()]
    .filter(
      logs =>
        logs.length > 0,
    )
    .length;

const groupSizes =
  [...burstGroups.values()]
    .map(
      logs =>
        logs.length,
    );

const burstUneven =
  groupSizes.length === 0
    ? 1
    : new Set(
        groupSizes,
      ).size === 1
      ? 0
      : 1;

const secretLogs =
  requestLogs.filter(
    item =>
      item.trace_id ===
      meta.secretTraceId,
  );

const secretReqLogged =
  secretLogs.some(
    item =>
      item.msg ===
      'observability demo request',
  )
    ? 1
    : 0;

const structuredText =
  jsonLines
    .map(
      item =>
        JSON.stringify(
          item,
        ),
    )
    .join('\n');

const secretInLogs =
  structuredText.includes(
    meta.tokenMarker,
  ) ||
  structuredText.includes(
    meta.passwordMarker,
  )
    ? 1
    : 0;

console.log(
  `non-json-lines=${nonJsonLines}`,
);

console.log(
  `layers=${layers}`,
);

console.log(
  `distinct-trace-ids=${distinctTraceIds}`,
);

console.log(
  `trace-id-matches-header=${traceIdMatchesHeader}`,
);

console.log(
  `burst=${meta.burstTraceIds.length}`,
);

console.log(
  `burst-trace-ids=${burstTraceIds}`,
);

console.log(
  `burst-uneven=${burstUneven}`,
);

console.log(
  `secret-req-logged=${secretReqLogged}`,
);

console.log(
  `secret-in-logs=${secretInLogs}`,
);

const ok =
  nonJsonLines === 0 &&
  layers >= 3 &&
  distinctTraceIds === 1 &&
  traceIdMatchesHeader === 1 &&
  meta.burstTraceIds.length >= 8 &&
  burstTraceIds ===
    meta.burstTraceIds.length &&
  burstUneven === 0 &&
  secretReqLogged === 1 &&
  secretInLogs === 0;

process.exit(
  ok
    ? 0
    : 1,
);
NODE