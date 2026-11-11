import type {
  GateVerdict,
  AuditTrailEvent,
} from '@fable/contracts';

export type WorkflowState =
  | 'PENDING_APPROVAL'
  | 'RUNNING'
  | 'STALE_PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type NodeExecutionState =
  | 'WAITING_DEPENDENCIES'
  | 'RUNNING'
  | 'PASSED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SKIPPED';

export interface NodeStatusInfo {
  nodeId: string;
  contractId: string;
  contractVersion: string;
  state: NodeExecutionState;
  attempts: number;
  verdicts: GateVerdict[];
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  error?: string | undefined;
}

export interface WorkflowProgressState {
  workflowId: string;
  goalId: string;
  blueprintId: string;
  status: WorkflowState;
  createdAt: string;
  approvalRequestedAt?: string | undefined;
  approvedAt?: string | undefined;
  approvedBy?: string | undefined;
  sla24hAlertTriggered: boolean;
  sla48hStalePaused: boolean;
  nodeStates: Record<string, NodeStatusInfo>;
  auditLog: AuditTrailEvent[];
  releaseCandidateId?: string | undefined;
  releasePromoted: boolean;
}

export interface ApproveBlueprintInput {
  approvedBy: string;
  timestamp?: string | undefined;
}

export interface RejectBlueprintInput {
  rejectedBy: string;
  reason: string;
  timestamp?: string | undefined;
}

export interface PromoteReleaseInput {
  approvedBy: string;
  targetEnvironment: 'PRODUCTION' | 'STAGING';
  timestamp?: string | undefined;
}

export interface NodeExecutionHandler {
  executeNode(
    workflowId: string,
    nodeId: string,
    contractId: string,
    contractVersion: string
  ): Promise<GateVerdict[]>;
}
