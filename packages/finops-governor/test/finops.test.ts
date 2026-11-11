import { describe, it, expect } from 'vitest';
import { FinOpsBudgetGovernor } from '../src/index.js';

describe('Phase 27: FinOps Token & Compute Budget Governor Suite', () => {
  it('throttles AI advisory at 80% utilization while preserving deterministic gates until 100% cap', () => {
    const governor = new FinOpsBudgetGovernor();
    governor.setBudget({ scopeKey: 'team:payments', limitUsd: 10.0, softThrottleRatio: 0.8 });

    // Spend $5.00 (50% utilization) -> ALLOW everything
    const rep1 = governor.recordSpend({
      scopeKey: 'team:payments',
      workflowId: 'wf-1',
      moduleId: 'auth',
      llmCostUsd: 4.0,
      computeCostUsd: 1.0,
      pipelineLatencyMs: 2000,
    });
    expect(rep1.verdict).toBe('ALLOW');
    expect(rep1.allowAiAdvisory).toBe(true);
    expect(rep1.allowDeterministicGates).toBe(true);

    // Spend another $3.50 ($8.50 total = 85% utilization) -> THROTTLE_ADVISORY
    const rep2 = governor.recordSpend({
      scopeKey: 'team:payments',
      workflowId: 'wf-2',
      moduleId: 'ledger',
      llmCostUsd: 3.0,
      computeCostUsd: 0.5,
      pipelineLatencyMs: 2200,
    });
    expect(rep2.verdict).toBe('THROTTLE_ADVISORY');
    expect(rep2.allowAiAdvisory).toBe(false);
    expect(rep2.allowDeterministicGates).toBe(true);

    // Spend another $2.00 ($10.50 total = 105% utilization) -> HARD_CAP_EXCEEDED
    const rep3 = governor.recordSpend({
      scopeKey: 'team:payments',
      workflowId: 'wf-3',
      moduleId: 'billing',
      llmCostUsd: 1.5,
      computeCostUsd: 0.5,
      pipelineLatencyMs: 2100,
    });
    expect(rep3.verdict).toBe('HARD_CAP_EXCEEDED');
    expect(rep3.allowDeterministicGates).toBe(false);
  });
});
