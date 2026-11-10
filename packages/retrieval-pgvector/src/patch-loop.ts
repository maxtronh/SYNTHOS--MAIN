import type {
  DecisionMemo,
  PatchCycleRecord,
} from '@fable/contracts';

export interface PatchProposal {
  patchDiff: string;
  modelPersona: string;
}

export interface PatchEvaluationResult {
  passed: boolean;
  failureGate?: string | undefined;
  failureOutput?: string | undefined;
}

export class PatchLoopController {
  public static readonly MAX_CYCLES = 3;

  private cycles: PatchCycleRecord[] = [];
  private readonly workflowId: string;
  private readonly goalId: string;
  private readonly nodeId: string;
  private readonly contractId: string;
  private readonly contractVersion: string;

  constructor(context: {
    workflowId: string;
    goalId: string;
    nodeId: string;
    contractId: string;
    contractVersion: string;
  }) {
    this.workflowId = context.workflowId;
    this.goalId = context.goalId;
    this.nodeId = context.nodeId;
    this.contractId = context.contractId;
    this.contractVersion = context.contractVersion;
  }

  public getCycleCount(): number {
    return this.cycles.length;
  }

  public canAttemptAnotherCycle(): boolean {
    return this.cycles.length < PatchLoopController.MAX_CYCLES;
  }

  /**
   * Records an attempted patch cycle evaluation.
   */
  public recordCycle(proposal: PatchProposal, result: PatchEvaluationResult): void {
    if (this.cycles.length >= PatchLoopController.MAX_CYCLES) {
      throw new Error(`Cannot record patch cycle: Maximum cycles (${PatchLoopController.MAX_CYCLES}) reached.`);
    }

    this.cycles.push({
      cycle: this.cycles.length + 1,
      timestamp: new Date().toISOString(),
      patchDiff: proposal.patchDiff,
      failureGate: result.failureGate ?? 'L1a',
      failureOutput: result.failureOutput ?? 'Gate tests failed',
      modelPersona: proposal.modelPersona,
    });
  }

  /**
   * Generates a formal DecisionMemo when the 3-cycle cap is reached.
   */
  public generateDecisionMemo(unresolvedQuestions: string[] = []): DecisionMemo {
    if (this.cycles.length < PatchLoopController.MAX_CYCLES) {
      throw new Error(`Cannot generate DecisionMemo: Only ${this.cycles.length} cycles attempted. Cap is ${PatchLoopController.MAX_CYCLES}.`);
    }

    const consolidatedLogs = this.cycles
      .map(c => `[Cycle ${c.cycle} by ${c.modelPersona}] Gate: ${c.failureGate}\nError: ${c.failureOutput}`)
      .join('\n\n');

    return {
      memoId: `memo-${this.nodeId}-${Date.now()}`,
      goalId: this.goalId,
      workflowId: this.workflowId,
      nodeId: this.nodeId,
      contractId: this.contractId,
      contractVersion: this.contractVersion,
      status: 'PENDING_REVIEW',
      totalCyclesAttempted: this.cycles.length,
      patchHistory: [...this.cycles],
      consolidatedErrorLogs: consolidatedLogs,
      unresolvedQuestions: unresolvedQuestions.length > 0
        ? unresolvedQuestions
        : ['Why did three consecutive automated patch attempts fail verification?'],
      assignedTo: 'senior-platform-engineer',
      createdAt: new Date().toISOString(),
    };
  }
}
