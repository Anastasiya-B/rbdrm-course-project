export type PricingRates = Readonly<{
  cpuUsdPerVcpuHour: number;
  memoryUsdPerGibHour: number;
  hoursPerMonth: number;
}>;

export const DEFAULT_PRICING_RATES: PricingRates = {
  cpuUsdPerVcpuHour: 0.04048,
  memoryUsdPerGibHour: 0.004445,
  hoursPerMonth: 730,
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCpu(value: unknown): number {
  if (typeof value !== 'string') {
    return 0;
  }

  if (value.endsWith('m')) {
    const milliCpu = Number(value.slice(0, -1));

    return Number.isFinite(milliCpu) ? milliCpu / 1000 : 0;
  }

  const cpu = Number(value);

  return Number.isFinite(cpu) ? cpu : 0;
}

function parseMemoryGiB(value: unknown): number {
  if (typeof value !== 'string') {
    return 0;
  }

  const match = value.match(/^([0-9]+(?:\.[0-9]+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/);

  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  const unit = match[2] ?? '';

  switch (unit) {
    case 'Ki':
      return amount / (1024 * 1024);

    case 'Mi':
      return amount / 1024;

    case 'Gi':
      return amount;

    case 'Ti':
      return amount * 1024;

    case 'K':
      return (amount * 1000) / 1024 ** 3;

    case 'M':
      return (amount * 1000 ** 2) / 1024 ** 3;

    case 'G':
      return (amount * 1000 ** 3) / 1024 ** 3;

    case 'T':
      return (amount * 1000 ** 4) / 1024 ** 3;

    default:
      return amount / 1024 ** 3;
  }
}

function parsePlanDocuments(rawPlan: string): unknown[] {
  const trimmed = rawPlan.trim();

  if (!trimmed) {
    return [];
  }

  try {
    return [JSON.parse(trimmed)];
  } catch {
    return trimmed
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }
}

function isDeploymentType(value: unknown): boolean {
  return (
    value === 'kubernetes:apps/v1:Deployment' ||
    value === 'kubernetes:apps/v1:DeploymentPatch'
  );
}

function findDeploymentInputs(root: unknown): JsonObject[] {
  const deployments: JsonObject[] = [];

  const seenObjects = new Set<object>();

  const seenDeployments = new Set<string>();

  function addDeployment(value: unknown): void {
    if (!isObject(value)) {
      return;
    }

    if (!isObject(value.spec)) {
      return;
    }

    const fingerprint = JSON.stringify(value);

    if (seenDeployments.has(fingerprint)) {
      return;
    }

    seenDeployments.add(fingerprint);

    deployments.push(value);
  }

  function visit(value: unknown): void {
    if (typeof value !== 'object' || value === null) {
      return;
    }

    if (seenObjects.has(value)) {
      return;
    }

    seenObjects.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }

      return;
    }

    const object = value as JsonObject;

    if (isDeploymentType(object.type)) {
      addDeployment(object.inputs);

      if (isObject(object.new)) {
        addDeployment(object.new.inputs);
      }

      if (isObject(object.newState)) {
        addDeployment(object.newState.inputs);
      }
    }

    if (
      isObject(object.metadata) &&
      isDeploymentType(object.metadata.type) &&
      isObject(object.metadata.new)
    ) {
      addDeployment(object.metadata.new.inputs);
    }

    if (
      isObject(object.resourcePreEvent) &&
      isObject(object.resourcePreEvent.metadata) &&
      isDeploymentType(object.resourcePreEvent.metadata.type)
    ) {
      const metadata = object.resourcePreEvent.metadata;

      if (isObject(metadata.new)) {
        addDeployment(metadata.new.inputs);
      }
    }

    for (const child of Object.values(object)) {
      visit(child);
    }
  }

  visit(root);

  return deployments;
}

function calculateDeploymentMonthlyCost(
  deployment: JsonObject,
  rates: PricingRates,
): number {
  const spec = deployment.spec;

  if (!isObject(spec)) {
    return 0;
  }

  const replicas = typeof spec.replicas === 'number' ? spec.replicas : 1;

  const template = spec.template;

  if (!isObject(template)) {
    return 0;
  }

  const podSpec = template.spec;

  if (!isObject(podSpec) || !Array.isArray(podSpec.containers)) {
    return 0;
  }

  let requestedCpu = 0;
  let requestedMemoryGiB = 0;

  for (const container of podSpec.containers) {
    if (!isObject(container)) {
      continue;
    }

    const resources = container.resources;

    if (!isObject(resources)) {
      continue;
    }

    const requests = resources.requests;

    if (!isObject(requests)) {
      continue;
    }

    requestedCpu += parseCpu(requests.cpu);

    requestedMemoryGiB += parseMemoryGiB(requests.memory);
  }

  const hourlyCost =
    requestedCpu * rates.cpuUsdPerVcpuHour +
    requestedMemoryGiB * rates.memoryUsdPerGibHour;

  return replicas * hourlyCost * rates.hoursPerMonth;
}

export function estimateMonthlyCostFromPulumiPlan(
  rawPlan: string,
  rates: PricingRates = DEFAULT_PRICING_RATES,
): number {
  const documents = parsePlanDocuments(rawPlan);

  const deployments = documents.flatMap(findDeploymentInputs);

  return deployments.reduce(
    (total, deployment) =>
      total + calculateDeploymentMonthlyCost(deployment, rates),
    0,
  );
}
