import { OperationalMetricsTracker } from '@fable/ledger-telemetry';

export type BudgetVerdict = 'ALLOW' | 'THROTTLE_ADVISORY' | 'HARD_CAP_EXCEEDED';

export interface BudgetAllocation {
  scopeKey: string; // e.g., "team:payments" or "goal:goal-123"
  limitUsd: number;
  softThrottleRatio?: number; // Default 0.8 (80%)
}

export interface BudgetStatusReport {
  scopeKey: string;
  spentUsd: number;
  limitUsd: number;
  utilizationRatio: number;
  verdict: BudgetVerdict;
  allowAiAdvisory: boolean;
  allowDeterministicGates: boolean;
}

/**
 * Phase 27: FinOps Token & Sandbox Compute Budget Governor.
 * Enforces hard spend ceilings while protecting deterministic L0/L1a verification availability.
 */
export class FinOpsBudgetGovernor {
  private readonly allocations = new Map<string, { limitUsd: number; softRatio: number }>();
  private readonly spendByScope = new Map<string, number>();
  private readonly tracker: OperationalMetricsTracker;

  constructor(tracker?: OperationalMetricsTracker) {
    this.tracker = tracker ?? new OperationalMetricsTracker();
  }

  public setBudget(allocation: BudgetAllocation): void {
    if (allocation.limitUsd <= 0) {
      throw new Error('Budget limitUsd must be positive.');
    }
    this.allocations.set(allocation.scopeKey, {
      limitUsd: allocation.limitUsd,
      softRatio: allocation.softThrottleRatio ?? 0.8,
    });
  }

  public recordSpend(input: {
    scopeKey: string;
    workflowId: string;
    moduleId: string;
    llmCostUsd: number;
    computeCostUsd: number;
    pipelineLatencyMs: number;
  }): BudgetStatusReport {
    const prev = this.spendByScope.get(input.scopeKey) ?? 0;
    const totalAdded = input.llmCostUsd + input.computeCostUsd;
    this.spendByScope.set(input.scopeKey, prev + totalAdded);

    this.tracker.recordExecution({
      workflowId: input.workflowId,
      moduleId: input.moduleId,
      llmCostUsd: input.llmCostUsd,
      computeCostUsd: input.computeCostUsd,
      pipelineLatencyMs: input.pipelineLatencyMs,
    });

    return this.evaluateBudget(input.scopeKey);
  }

  public evaluateBudget(scopeKey: string): BudgetStatusReport {
    const alloc = this.allocations.get(scopeKey);
    const spentUsd = this.spendByScope.get(scopeKey) ?? 0;

    if (!alloc) {
      return {
        scopeKey,
        spentUsd,
        limitUsd: Infinity,
        utilizationRatio: 0,
        verdict: 'ALLOW',
        allowAiAdvisory: true,
        allowDeterministicGates: true,
      };
    }

    const ratio = spentUsd / alloc.limitUsd;

    if (ratio >= 1.0) {
      return {
        scopeKey,
        spentUsd,
        limitUsd: alloc.limitUsd,
        utilizationRatio: ratio,
        verdict: 'HARD_CAP_EXCEEDED',
        allowAiAdvisory: false,
        allowDeterministicGates: false,
      };
    }

    if (ratio >= alloc.softRatio) {
      return {
        scopeKey,
        spentUsd,
        limitUsd: alloc.limitUsd,
        utilizationRatio: ratio,
        verdict: 'THROTTLE_ADVISORY',
        allowAiAdvisory: false, // Throttle optional AI/L1b spend while preserving deterministic gates
        allowDeterministicGates: true,
      };
    }

    return {
      scopeKey,
      spentUsd,
      limitUsd: alloc.limitUsd,
      utilizationRatio: ratio,
      verdict: 'ALLOW',
      allowAiAdvisory: true,
      allowDeterministicGates: true,
    };
  }
}
