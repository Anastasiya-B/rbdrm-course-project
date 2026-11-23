import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',

  help: 'Total HTTP requests',

  labelNames: ['method', 'route', 'status'] as const,

  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',

  help: 'HTTP request duration in seconds',

  labelNames: ['method', 'route', 'status'] as const,

  /*
   * Deliberately broad upper range.
   * The demo will verify that the
   * largest finite bucket covers
   * the slowest observed request.
   */
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],

  registers: [metricsRegistry],
});
