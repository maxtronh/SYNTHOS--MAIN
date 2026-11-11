import type { GateVerdict } from '@fable/contracts';

export interface DiffHunkRange {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface MutantOutcome {
  mutantId: string;
  filePath: string;
  line: number;
  status: 'KILLED' | 'SURVIVED' | 'TIMEOUT';
}

/**
 * Phase 21: Incremental Diff-Scoped StrykerJS Mutation Engine (L1b).
 * Scopes mutation testing strictly to changed PR diff hunks to stay within the 30-minute L1b budget.
 */
export class DiffMutationRunner {
  public static readonly MAX_L1B_BUDGET_MS = 1800000;

  public static evaluateDiffMutants(input: {
    workflowId: string;
    nodeId: string;
    contractId: string;
    contractVersion: string;
    diffHunks: DiffHunkRange[];
    mutants: MutantOutcome[];
    minMutationScorePercent?: number;
    durationMs?: number;
  }): GateVerdict {
    const threshold = input.minMutationScorePercent ?? 75;
    const durationMs = input.durationMs ?? 45000;

    // Filter mutants strictly to changed diff line ranges
    const scopedMutants = input.mutants.filter(m =>
      input.diffHunks.some(
        h => h.filePath === m.filePath && m.line >= h.startLine && m.line <= h.endLine
      )
    );

    const killed = scopedMutants.filter(m => m.status === 'KILLED' || m.status === 'TIMEOUT').length;
    const score = scopedMutants.length === 0 ? 100 : (killed / scopedMutants.length) * 100;
    const passed = durationMs <= this.MAX_L1B_BUDGET_MS && score >= threshold;

    const errorDetails = passed
      ? []
      : [`L1b mutation score ${score.toFixed(1)}% below required threshold ${threshold}% across diff hunks`];

    return {
      verdictId: `v-l1b-${input.nodeId}-${Date.now()}`,
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      contractId: input.contractId,
      contractVersion: input.contractVersion,
      gate: 'L1b',
      status: durationMs > this.MAX_L1B_BUDGET_MS ? 'TIMEOUT' : (passed ? 'PASS' : 'FAIL'),
      sandboxPath: 'PATH_A_EPHEMERAL',
      executionDurationMs: durationMs,
      isAuthoritative: false, // Blocks next Release Candidate, does not block developer merge velocity
      errorDetails,
      metrics: {
        mutationScore: Number(score.toFixed(2)),
        durationMs,
      },
      evaluatedAt: new Date().toISOString(),
    };
  }
}
