import type { GateVerdict, GateLevel } from '@fable/contracts';

export interface IdempotencyLock {
  lockKey: string;
  ownerId: string;
  acquiredAt: string;
  expiresAtMs: number;
}

export interface BullMQJobPayload {
  jobId: string;
  triggeringContractId: string;
  triggeringVersion: string;
  downstreamUnitId: string;
  gates: GateLevel[];
  workflowId: string;
  nodeId: string;
  dispatchedAt: string;
}

export interface DLQJobRecord {
  dlqId: string;
  job: BullMQJobPayload;
  reason: string;
  failedAt: string;
  attempts: number;
}

export interface ActivityHeartbeatRecord {
  activityId: string;
  workflowId: string;
  lastHeartbeatTimeMs: number;
  maxHeartbeatIntervalMs: number;
  status: 'HEALTHY' | 'HEARTBEAT_TIMEOUT';
}

export interface BridgeReconciliationSummary {
  totalProcessed: number;
  duplicatesDeduplicated: number;
  successfulReverifications: number;
  failedReverifications: number;
  sentToDLQ: number;
  verdicts: GateVerdict[];
}
