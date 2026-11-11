import type { BullMQJobPayload } from '@fable/worker-bridge';

export type QueuePriority = 'CRITICAL' | 'HIGH' | 'NORMAL';

export const PRIORITY_WEIGHTS: Record<QueuePriority, number> = {
  CRITICAL: 100,
  HIGH: 50,
  NORMAL: 10,
};

export interface PrioritizedJob {
  priority: QueuePriority;
  payload: BullMQJobPayload;
  enqueuedAtMs: number;
}

export interface RateLimiterConfig {
  maxJobsPerWindow: number;
  windowMs: number;
}

export interface RedisCommandClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<number>;
}

export interface DispatchBatchResult {
  dispatched: BullMQJobPayload[];
  deferredBackpressure: PrioritizedJob[];
}
