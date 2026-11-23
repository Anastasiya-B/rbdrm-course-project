import { randomBytes } from 'node:crypto';

const BASE_URL = process.env.API_URL ?? 'http://127.0.0.1:3000';

const BURST = 8;

function createTraceparent() {
  const traceId = randomBytes(16).toString('hex');

  const parentId = randomBytes(8).toString('hex');

  return {
    traceId,
    header: `00-${traceId}-${parentId}-01`,
  };
}

async function sendRequest({
  traceparent,
  path,
  method = 'GET',
  headers = {},
  body,
}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,

    headers: {
      traceparent,
      ...headers,
    },

    ...(body !== undefined
      ? {
          body: JSON.stringify(body),
        }
      : {}),
  });

  await response.text().catch(() => {});

  return response.status;
}

async function main() {
  const normal = createTraceparent();

  await sendRequest({
    traceparent: normal.header,

    path: '/observability/orders/1',
  });

  const burstRequests = Array.from(
    {
      length: BURST,
    },
    () => {
      const trace = createTraceparent();

      return {
        ...trace,
      };
    },
  );

  await Promise.all(
    burstRequests.map(request =>
      sendRequest({
        traceparent: request.header,

        path: '/observability/orders/1',
      }),
    ),
  );

  const secretTrace = createTraceparent();

  const tokenMarker = `token-${randomBytes(8).toString('hex')}`;

  const passwordMarker = `password-${randomBytes(8).toString('hex')}`;

  await sendRequest({
    traceparent: secretTrace.header,

    path: '/observability/orders/1/log-demo',

    method: 'POST',

    headers: {
      'content-type': 'application/json',

      authorization: `Bearer ${tokenMarker}`,
    },

    body: {
      password: passwordMarker,
    },
  });

  console.log(
    JSON.stringify({
      type: 'demo-metadata',

      normalTraceId: normal.traceId,

      burstTraceIds: burstRequests.map(item => item.traceId),

      secretTraceId: secretTrace.traceId,

      tokenMarker,

      passwordMarker,
    }),
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
