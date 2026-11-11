import type { GateVerdict } from '@fable/contracts';

export interface FormalInvariant<State> {
  name: string;
  predicate: (state: State) => boolean;
}

/**
 * Phase 20: Symbolic & State-Space Formal Verification Gate (L3-Formal).
 * Exhaustively checks mathematical invariants across explored state transitions.
 */
export class FormalSpecVerifier {
  public static verifyStateSpace<State>(input: {
    workflowId: string;
    nodeId: string;
    contractId: string;
    contractVersion: string;
    initialState: State;
    transitions: Array<(state: State) => State>;
    invariants: Array<FormalInvariant<State>>;
    maxDepth?: number;
  }): GateVerdict {
    const startMs = Date.now();
    const maxDepth = input.maxDepth ?? 3;
    const violations: string[] = [];

    const explore = (currentState: State, depth: number, trace: string[]): void => {
      for (const inv of input.invariants) {
        if (!inv.predicate(currentState)) {
          violations.push(
            `Formal invariant '${inv.name}' violated at depth ${depth} via path [${trace.join(' -> ')}]`
          );
          return;
        }
      }

      if (depth >= maxDepth) return;

      for (let i = 0; i < input.transitions.length; i++) {
        const nextState = input.transitions[i]!(currentState);
        explore(nextState, depth + 1, [...trace, `step_${i}`]);
      }
    };

    explore(input.initialState, 0, ['init']);
    const durationMs = Date.now() - startMs;

    return {
      verdictId: `v-l3-formal-${input.nodeId}-${Date.now()}`,
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      contractId: input.contractId,
      contractVersion: input.contractVersion,
      gate: 'L3',
      status: violations.length === 0 ? 'PASS' : 'FAIL',
      sandboxPath: 'PATH_A_EPHEMERAL',
      executionDurationMs: durationMs,
      isAuthoritative: true,
      errorDetails: violations,
      metrics: { durationMs, testCount: input.invariants.length },
      evaluatedAt: new Date().toISOString(),
    };
  }
}
