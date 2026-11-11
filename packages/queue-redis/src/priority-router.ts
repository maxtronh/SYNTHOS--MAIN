import type { BullMQJobPayload } from '@fable/worker-bridge';
import {
  PRIORITY_WEIGHTS,
  type DispatchBatchResult,
  type PrioritizedJob,
  type QueuePriority,
} from './types.js';
import type { IRateLimiter } from './rate-limiter.js';

/**
 * Priority-aware BullMQ dispatcher with sliding-window backpressure throttling.
 * Ensures CRITICAL MAJOR-version blast-radius checks always preempt NORMAL background tasks.
 */
export class PriorityQueueRouter {
  private queue: PrioritizedJob[] = [];
  private readonly rateLimiter: IRateLimiter;
  private readonly bucketKey: string;

  constructor(options: { rateLimiter: IRateLimiter; bucketKey?: string }) {
    this.rateLimiter = options.rateLimiter;
    this.bucketKey = options.bucketKey ?? 'fable:queue:global';
  }

  public enqueue(
    payload: BullMQJobPayload,
    priority: QueuePriority = 'NORMAL',
    nowMs: number = Date.now()
  ): void {
    // Deduplicate identical jobId already waiting in queue, upgrading priority if higher
    const existing = this.queue.find(item => item.payload.jobId === payload.jobId);
    if (existing) {
      if (PRIORITY_WEIGHTS[priority] > PRIORITY_WEIGHTS[existing.priority]) {
        existing.priority = priority;
      }
      return;
    }

    this.queue.push({
      priority,
      payload,
      enqueuedAtMs: nowMs,
    });
  }

  /**
   * Drains as many high-priority jobs as permitted by the rate limiter window.
   * Lower-priority jobs exceeding capacity remain safely queued under backpressure.
   */
  public async drainBatch(nowMs: number = Date.now()): Promise<DispatchBatchResult> {
    this.queue.sort((a, b) => {
      const weightDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
      if (weightDiff !== 0) return weightDiff;
      return a.enqueuedAtMs - b.enqueuedAtMs;
    });

    const dispatched: BullMQJobPayload[] = [];
    const remaining: PrioritizedJob[] = [];

    for (const item of this.queue) {
      const permitted = await this.rateLimiter.tryAcquire(this.bucketKey, nowMs);
      if (permitted) {
        dispatched.push(item.payload);
      } else {
        remaining.push(item);
      }
    }

    this.queue = remaining;

    return {
      dispatched,
      deferredBackpressure: [...remaining],
    };
  }

  public queueDepth(): number {
    return this.queue.length;
  }

  public getPendingJobs(): PrioritizedJob[] {
    return [...this.queue];
  }
}
