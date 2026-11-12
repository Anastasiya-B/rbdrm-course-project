import http from 'node:http';
import fs from 'node:fs';

const targetUrl = process.env.TARGET_URL ?? 'http://127.0.0.1:30080/healthz';

const stopFile = process.env.STOP_FILE ?? '/tmp/hw28-rollout-stop';

const resultFile = process.env.RESULT_FILE ?? '/tmp/hw28-rollout-result.json';

const minRequests = Number(process.env.MIN_REQUESTS ?? '5000');

const concurrency = Number(process.env.CONCURRENCY ?? '32');

const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS ?? '2000');

const url = new URL(targetUrl);

let requests = 0;
let ok = 0;
let failed = 0;
let stopping = false;

function shouldStop() {
  if (!stopping && fs.existsSync(stopFile)) {
    stopping = true;
  }

  return stopping && requests >= minRequests;
}

function requestOnce() {
  return new Promise(resolve => {
    const request = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        headers: {
          Connection: 'close',
        },
      },
      response => {
        response.resume();

        response.on('end', () => {
          requests += 1;

          if (response.statusCode === 200) {
            ok += 1;
          } else {
            failed += 1;
          }

          resolve();
        });
      },
    );

    request.setTimeout(requestTimeoutMs, () => {
      request.destroy(new Error('request timeout'));
    });

    request.on('error', () => {
      requests += 1;
      failed += 1;
      resolve();
    });

    request.end();
  });
}

async function worker() {
  while (!shouldStop()) {
    await requestOnce();
  }
}

async function main() {
  if (fs.existsSync(stopFile)) {
    fs.unlinkSync(stopFile);
  }

  const workers = Array.from({ length: concurrency }, () => worker());

  await Promise.all(workers);

  const result = {
    requests,
    ok,
    failed,
  };

  fs.writeFileSync(resultFile, JSON.stringify(result), 'utf8');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
