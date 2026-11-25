const BASE_URL = process.env.API_URL ?? 'http://127.0.0.1:3011';

const ROUTE = '/observability/orders/:id';

const SENT_OK = 40;
const SENT_FAIL = 10;

async function request(path) {
  const response = await fetch(`${BASE_URL}${path}`);

  await response.text().catch(() => {});

  return response.status;
}

async function scrapeMetrics() {
  const response = await fetch(`${BASE_URL}/metrics`);

  if (!response.ok) {
    throw new Error(`Metrics scrape failed: ${response.status}`);
  }

  return response.text();
}

function parseMetricLines(text) {
  const result = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([^\s]+)$/,
    );

    if (!match) {
      continue;
    }

    const [, name, rawLabels = '', rawValue] = match;

    const labels = {};

    const labelRegex = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g;

    let labelMatch;

    while ((labelMatch = labelRegex.exec(rawLabels)) !== null) {
      labels[labelMatch[1]] = labelMatch[2]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    result.push({
      name,
      labels,
      value: Number(rawValue),
    });
  }

  return result;
}

function isDemoRoute(metric) {
  return metric.labels.route === ROUTE;
}

function sumCounter(metrics, predicate = () => true) {
  return metrics
    .filter(
      metric =>
        metric.name === 'http_requests_total' &&
        isDemoRoute(metric) &&
        predicate(metric),
    )
    .reduce((total, metric) => total + metric.value, 0);
}

function countCounterSeries(metrics) {
  return metrics.filter(
    metric => metric.name === 'http_requests_total' && isDemoRoute(metric),
  ).length;
}

function sumHistogramCount(metrics) {
  return metrics
    .filter(
      metric =>
        metric.name === 'http_request_duration_seconds_count' &&
        isDemoRoute(metric),
    )
    .reduce((total, metric) => total + metric.value, 0);
}

function finiteBucketBounds(metrics) {
  return metrics
    .filter(
      metric =>
        metric.name === 'http_request_duration_seconds_bucket' &&
        isDemoRoute(metric) &&
        metric.labels.le !== '+Inf',
    )
    .map(metric => Number(metric.labels.le))
    .filter(Number.isFinite);
}

function sumTopFiniteBucket(metrics, topBucket) {
  return metrics
    .filter(
      metric =>
        metric.name === 'http_request_duration_seconds_bucket' &&
        isDemoRoute(metric) &&
        Number(metric.labels.le) === topBucket,
    )
    .reduce((total, metric) => total + metric.value, 0);
}

async function main() {
  /*
   * Warm every status label which
   * may occur later. This is
   * important for the cardinality
   * measurement.
   */
  const warmOk = await request('/observability/orders/1');

  const warmNotFound = await request('/observability/orders/2147000000');

  const warmFail = await request('/observability/orders/1?fail=1');

  if (warmOk !== 200 || warmNotFound !== 404 || warmFail !== 500) {
    throw new Error(
      `Warm-up failed: ok=${warmOk} not-found=${warmNotFound} fail=${warmFail}`,
    );
  }

  /*
   * RED delta measurement.
   */
  const before = parseMetricLines(await scrapeMetrics());

  const okStatuses = await Promise.all(
    Array.from(
      {
        length: SENT_OK,
      },
      () => request('/observability/orders/1'),
    ),
  );

  const failStatuses = await Promise.all(
    Array.from(
      {
        length: SENT_FAIL,
      },
      () => request('/observability/orders/1?fail=1'),
    ),
  );

  if (okStatuses.some(status => status !== 200)) {
    throw new Error('Expected every OK request to return 200');
  }

  if (failStatuses.some(status => status !== 500)) {
    throw new Error('Expected every failing request to return 500');
  }

  const afterTraffic = parseMetricLines(await scrapeMetrics());

  const beforeCounter = sumCounter(before);

  const afterCounter = sumCounter(afterTraffic);

  const beforeErrors = sumCounter(before, metric =>
    /^5\d\d$/.test(metric.labels.status ?? ''),
  );

  const afterErrors = sumCounter(afterTraffic, metric =>
    /^5\d\d$/.test(metric.labels.status ?? ''),
  );

  const counterDelta = afterCounter - beforeCounter;

  const errorsDelta = afterErrors - beforeErrors;

  /*
   * Cardinality check.
   *
   * Route is already warmed with a
   * 404, so 100 distinct raw ids
   * must not create new counter
   * series.
   */
  const cardinalityBefore = parseMetricLines(await scrapeMetrics());

  const seriesBefore = countCounterSeries(cardinalityBefore);

  const ids = Array.from(
    {
      length: 100,
    },
    (_, index) => 2147000000 + index,
  );

  const cardinalityStatuses = await Promise.all(
    ids.map(id => request(`/observability/orders/${id}`)),
  );

  if (cardinalityStatuses.some(status => status !== 404)) {
    throw new Error('Cardinality requests must return 404');
  }

  const finalMetrics = parseMetricLines(await scrapeMetrics());

  const seriesAfter = countCounterSeries(finalMetrics);

  /*
   * Bucket coverage.
   */
  const bounds = finiteBucketBounds(finalMetrics);

  if (bounds.length === 0) {
    throw new Error('No finite histogram buckets found');
  }

  const topBucket = Math.max(...bounds);

  const count = sumHistogramCount(finalMetrics);

  const topBucketCount = sumTopFiniteBucket(finalMetrics, topBucket);

  const aboveTopBucket = count - topBucketCount;

  console.log(`sent-ok=${SENT_OK}`);

  console.log(`sent-fail=${SENT_FAIL}`);

  console.log(`counter-delta=${counterDelta}`);

  console.log(`errors-delta=${errorsDelta}`);

  console.log(`above-top-bucket=${aboveTopBucket}`);

  console.log(`series-before=${seriesBefore}`);

  console.log(`series-after=${seriesAfter}`);

  const ok =
    SENT_OK + SENT_FAIL >= 50 &&
    counterDelta === SENT_OK + SENT_FAIL &&
    errorsDelta === SENT_FAIL &&
    aboveTopBucket === 0 &&
    seriesAfter === seriesBefore;

  process.exit(ok ? 0 : 1);
}

main().catch(error => {
  console.error(error);

  process.exit(1);
});
