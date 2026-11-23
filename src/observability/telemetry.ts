import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import { resourceFromAttributes } from '@opentelemetry/resources';

import { NodeSDK } from '@opentelemetry/sdk-node';

import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:22918';

const traceUrl = endpoint.endsWith('/v1/traces')
  ? endpoint
  : `${endpoint.replace(/\/$/, '')}/v1/traces`;

const traceExporter = new OTLPTraceExporter({
  url: traceUrl,
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'marketplace-api',

    [ATTR_SERVICE_VERSION]: '1.0.0',
  }),

  traceExporter,

  instrumentations: [getNodeAutoInstrumentations()],
});

if (process.env.OTEL_DEBUG === '1') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

sdk.start();

export async function shutdownTelemetry(): Promise<void> {
  await sdk.shutdown();
}
