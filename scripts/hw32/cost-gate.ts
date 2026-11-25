import { readFileSync } from 'node:fs';

import { estimateMonthlyCostFromPulumiPlan } from '../../src/mapping';

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function parseBudget(value: string): number {
  const budget = Number(value);

  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error('COST_BUDGET_USD must be a non-negative number');
  }

  return budget;
}

function main(): void {
  const planPath = requiredEnv('PLAN_JSON');

  const budget = parseBudget(requiredEnv('COST_BUDGET_USD'));

  const rawPlan = readFileSync(planPath, 'utf8');

  const planUsd = estimateMonthlyCostFromPulumiPlan(rawPlan);

  const bypass = process.env.COST_GATE_BYPASS === '1';

  console.log(`budget-usd=${budget.toFixed(2)}`);

  console.log(`plan-usd=${planUsd.toFixed(4)}`);

  if (planUsd <= 0) {
    console.log('gate=fail');

    console.error(
      'Cost mapping produced zero cost; the gate cannot be validated bidirectionally.',
    );

    process.exit(2);
  }

  if (bypass) {
    console.log('cost-gate-bypass=1');

    console.log('gate=pass');

    return;
  }

  if (planUsd > budget) {
    console.log('gate=fail');

    process.exit(1);
  }

  console.log('gate=pass');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));

  process.exit(2);
}
