import type { GateVerdict } from '@fable/contracts';

export type ChaosFaultType = 'LATENCY_SPIKE' | 'DB_DEADLOCK' | 'PACKET_LOSS' | 'CLOCK_SKEW';

export interface ChaosFaultScenario {
  faultType: ChaosFaultType;
  intensity: number; // e.g. 500ms latency or 0.2 packet drop ratio
  executeUnderFault: () => Promise<boolean>; // true if module preserved consistency/recovered cleanly
}

/**
 * Phase 19: Continuous Chaos Engineering & Fault Injection Gate (L3-Chaos).
 * Validates crash safety and transaction recovery inside isolated Path B stateful sandboxes.
 */
export class ChaosFaultInjector {
  public static async runChaosGate(input: {
    workflowId: string;
    nodeId: string;
    contractId: string;
    contractVersion: string;
    scenarios: ChaosFaultScenario[];
  }): Promise<GateVerdict> {
    const startMs = Date.now();
    const failures: string[] = [];

    for (const scenario of input.scenarios) {
      try {
        const survived = await scenario.executeUnderFault();
        if (!survived) {
          failures.push(`Chaos fault '${scenario.faultType}' caused consistency invariant violation.`);
        }
      } catch (err) {
        failures.push(`Unhandled crash under chaos fault '${scenario.faultType}': ${(err as Error).message}`);
      }
    }

    const durationMs = Date.now() - startMs;
    const passed = failures.length === 0;

    return {
      verdictId: `v-l3-chaos-${input.nodeId}-${Date.now()}`,
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      contractId: input.contractId,
      contractVersion: input.contractVersion,
      gate: 'L3',
      status: passed ? 'PASS' : 'FAIL',
      sandboxPath: 'PATH_B_STATEFUL',
      executionDurationMs: durationMs,
      isAuthoritative: true,
      errorDetails: failures,
      metrics: { durationMs, testCount: input.scenarios.length },
      evaluatedAt: new Date().toISOString(),
    };
  }
}
