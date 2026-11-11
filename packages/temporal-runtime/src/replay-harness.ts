import { DAGEngine, type NodeExecutionHandler, type WorkflowProgressState } from '@fable/orchestrator-temporal';
import type { GateVerdict } from '@fable/contracts';
import type { WorkflowHistoryEvent, ReplayVerificationResult } from './types.js';

/**
 * Verifies deterministic replay of recorded Temporal event histories across worker restarts.
 * Prevents non-deterministic regressions from breaking inflight workflows (RFC Section 3 & Workstream A).
 */
export class ReplayDeterminismHarness {
  /**
   * Replays an event sequence on a brand-new engine instance without executing external activities.
   */
  public static async replayHistory(
    history: WorkflowHistoryEvent[],
    expectedFinalState?: WorkflowProgressState
  ): Promise<ReplayVerificationResult> {
    const initEvent = history.find(
      (e): e is Extract<WorkflowHistoryEvent, { type: 'WORKFLOW_INITIALIZED' }> =>
        e.type === 'WORKFLOW_INITIALIZED'
    );

    if (!initEvent) {
      throw new Error('Invalid workflow history: missing WORKFLOW_INITIALIZED event.');
    }

    // Index recorded activity verdicts so replay does not re-run side-effecting activities
    const recordedVerdicts = new Map<string, GateVerdict[]>();
    for (const event of history) {
      if (event.type === 'ACTIVITY_COMPLETED') {
        recordedVerdicts.set(event.nodeId, event.verdicts);
      }
    }

    const replayHandler: NodeExecutionHandler = {
      executeNode: async (_wfId, nodeId) => {
        const verdicts = recordedVerdicts.get(nodeId);
        if (!verdicts) {
          throw new Error(`Non-deterministic replay error: no recorded activity outcome for node '${nodeId}'.`);
        }
        return verdicts;
      },
    };

    const engine = new DAGEngine(initEvent.workflowId, initEvent.blueprint, replayHandler);

    for (const event of history) {
      switch (event.type) {
        case 'WORKFLOW_INITIALIZED':
          break;
        case 'SLA_TIMER_FIRED':
          engine.checkApprovalSLAs(event.currentTimeMs);
          break;
        case 'SIGNAL_APPROVED':
          engine.approveBlueprint(event.input);
          await engine.runUntilDone();
          break;
        case 'SIGNAL_REJECTED':
          engine.rejectBlueprint(event.input);
          break;
        case 'ACTIVITY_COMPLETED':
          // Consumed deterministically via replayHandler when runUntilDone executes
          break;
        case 'SIGNAL_PROMOTED':
          engine.promoteRelease(event.input);
          break;
      }
    }

    const replayedState = engine.getState() as WorkflowProgressState;

    if (expectedFinalState) {
      const divergence = this.findStateDivergence(expectedFinalState, replayedState);
      if (divergence) {
        return {
          deterministic: false,
          replayedState,
          divergenceReason: divergence,
        };
      }
    }

    return {
      deterministic: true,
      replayedState,
    };
  }

  private static findStateDivergence(
    expected: WorkflowProgressState,
    actual: WorkflowProgressState
  ): string | null {
    if (expected.status !== actual.status) {
      return `Status mismatch: expected '${expected.status}', replayed '${actual.status}'`;
    }
    if (expected.releasePromoted !== actual.releasePromoted) {
      return `Release promotion flag mismatch: expected ${expected.releasePromoted}, replayed ${actual.releasePromoted}`;
    }

    for (const [nodeId, expNode] of Object.entries(expected.nodeStates)) {
      const actNode = actual.nodeStates[nodeId];
      if (!actNode || actNode.state !== expNode.state) {
        return `Node '${nodeId}' state mismatch: expected '${expNode.state}', replayed '${actNode?.state}'`;
      }
    }

    return null;
  }
}
