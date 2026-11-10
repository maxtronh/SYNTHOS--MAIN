import type { GateLevel, GateVerdict } from '@fable/contracts';

export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface ReverificationJob {
  jobId: string;
  downstreamUnitId: string;
  triggeringContractId: string;
  oldVersion: string;
  newVersion: string;
  gatesToRun: GateLevel[];
  status: JobStatus;
  dispatchedAt: string;
  completedAt?: string | undefined;
  verdicts: GateVerdict[];
}

export interface ReleaseHoldStatus {
  canPromote: boolean;
  heldReasons: string[];
  pendingReverifications: string[];
}
