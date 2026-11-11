import type { ModuleContract, GateVerdict } from '@fable/contracts';
import { GateRunner } from '@fable/gate-runner';
import { DistributedLockManager } from './idempotency-lock.js';
import type {
  BullMQJobPayload,
  DLQJobRecord,
  BridgeReconciliationSummary,
} from './types.js';

export interface QueueBridgeOptions {
  lockManager?: DistributedLockManager;
  maxRetriesBeforeDLQ?: number;
}

export class TemporalBullMQBridge {
  private readonly lockManager: DistributedLockManager;
  private readonly dlq: DLQJobRecord[] = [];
  private readonly maxRetries: number;
  private readonly jobAttempts = new Map<string, number>();

  constructor(options?: QueueBridgeOptions) {
    this.lockManager = options?.lockManager ?? new DistributedLockManager();
    this.maxRetries = options?.maxRetriesBeforeDLQ ?? 3;
  }

  /**
   * Process a batch of BullMQ blast-radius re-verification jobs,
   * enforcing idempotency locks and reconciling results back to Temporal.
   */
  public async processBatch(
    jobs: BullMQJobPayload[],
    workerId: string = 'bullmq-worker-1'
  ): Promise<BridgeReconciliationSummary> {
    const summary: BridgeReconciliationSummary = {
      totalProcessed: 0,
      duplicatesDeduplicated: 0,
      successfulReverifications: 0,
      failedReverifications: 0,
      sentToDLQ: 0,
      verdicts: [],
    };

    for (const job of jobs) {
      summary.totalProcessed++;
      const lockKey = `lock:${job.jobId}`;

      // 1. Idempotency Lock Check
      const lockAcquired = this.lockManager.acquireLock(lockKey, workerId, 60000);
      if (!lockAcquired) {
        // Concurrent duplicate detected -> Deduplicate cleanly
        summary.duplicatesDeduplicated++;
        continue;
      }

      // Track attempts
      const attempts = (this.jobAttempts.get(job.jobId) ?? 0) + 1;
      this.jobAttempts.set(job.jobId, attempts);

      try {
        // 2. Prepare downstream stub contract for re-verification
        const downstreamContract: ModuleContract = {
          id: job.downstreamUnitId,
          name: job.downstreamUnitId,
          version: job.triggeringVersion,
          description: `Auto-reverification for unit '${job.downstreamUnitId}' triggered by '${job.triggeringContractId}'`,
          inputs: {},
          outputs: {},
          stateHooks: false,
          dependencies: [],
          requiredGates: job.gates,
          executionBudgetMs: 60000,
          author: 'worker-bridge',
          createdAt: new Date().toISOString(),
        };

        // 3. Execute gates in isolated sandbox
        const verdicts: GateVerdict[] = await GateRunner.executeModuleVerification({
          workflowId: job.workflowId,
          nodeId: job.nodeId,
          contract: downstreamContract,
        });

        summary.verdicts.push(...verdicts);

        const hasFailure = verdicts.some(v => v.isAuthoritative && v.status === 'FAIL');
        if (hasFailure) {
          summary.failedReverifications++;
          if (attempts >= this.maxRetries) {
            this.sendToDLQ(job, 'Deterministic gate failure reached max attempts', attempts);
            summary.sentToDLQ++;
          }
        } else {
          summary.successfulReverifications++;
        }
      } catch (err) {
        summary.failedReverifications++;
        if (attempts >= this.maxRetries) {
          this.sendToDLQ(job, (err as Error).message, attempts);
          summary.sentToDLQ++;
        }
      } finally {
        // 4. Release lock safely
        this.lockManager.releaseLock(lockKey, workerId);
      }
    }

    return summary;
  }

  public getDLQRecords(): DLQJobRecord[] {
    return [...this.dlq];
  }

  private sendToDLQ(job: BullMQJobPayload, reason: string, attempts: number): void {
    this.dlq.push({
      dlqId: `dlq-${job.jobId}-${Date.now()}`,
      job,
      reason,
      failedAt: new Date().toISOString(),
      attempts,
    });
  }
}
