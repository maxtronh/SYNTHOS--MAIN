import type { GateVerdict, DAGBlueprint } from '@fable/contracts';
import type {
  ApproveBlueprintInput,
  RejectBlueprintInput,
  PromoteReleaseInput,
  WorkflowProgressState,
} from '@fable/orchestrator-temporal';

export type WorkflowHistoryEvent =
  | { type: 'WORKFLOW_INITIALIZED'; workflowId: string; blueprint: DAGBlueprint; timestamp: string }
  | { type: 'SIGNAL_APPROVED'; input: ApproveBlueprintInput }
  | { type: 'SIGNAL_REJECTED'; input: RejectBlueprintInput }
  | { type: 'SLA_TIMER_FIRED'; currentTimeMs: number }
  | { type: 'ACTIVITY_COMPLETED'; nodeId: string; verdicts: GateVerdict[] }
  | { type: 'SIGNAL_PROMOTED'; input: PromoteReleaseInput };

export interface ReplayVerificationResult {
  deterministic: boolean;
  replayedState: WorkflowProgressState;
  divergenceReason?: string | undefined;
}
