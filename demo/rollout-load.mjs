import fs from 'node:fs';
import http from 'node:http';

const targetUrl = process.env.TARGET_URL ?? 'http://127.0.0.1:30080/healthz';

const stopFile = process.env.STOP_FILE ?? '/tmp/hw28-rollout-stop';

const codeFile = process.env.CODE_FILE ?? '/tmp/hw28-rollout-http-codes.txt';

const minRequests = Number(process.env.MIN_REQUESTS ?? '5000');

const concurrency = Number(process.env.CONCURRENCY ?? '8');

const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS ?? '2000');

const url = new URL(targetUrl);

let requests = 0;
let stopping = false;

function recordCode(code) {
  fs.appendFileSync(codeFile, `${code}\n`, 'utf8');

  requests += 1;
}

function shouldStop() {
  if (!stopping && fs.existsSync(stopFile)) {
    stopping = true;
  }

  return stopping && requests >= minRequests;
}

function requestOnce() {
  return new Promise(resolve => {
    let settled = false;

    const finish = code => {
      if (settled) {
        return;
      }

      settled = true;
      recordCode(code);
      resolve();
    };

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
          finish(response.statusCode ?? 0);
        });

        response.on('error', () => {
          finish(0);
        });
      },
    );

    request.setTimeout(requestTimeoutMs, () => {
      request.destroy(new Error('request timeout'));
    });

    request.on('error', () => {
      finish(0);
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

  fs.writeFileSync(codeFile, '', 'utf8');

  const workers = Array.from(
    {
      length: concurrency,
    },
    () => worker(),
  );

  await Promise.all(workers);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
