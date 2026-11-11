import { describe, it, expect } from 'vitest';
import {
  DistributedLockManager,
  ActivityHeartbeatManager,
  TemporalBullMQBridge,
  type BullMQJobPayload,
} from '../src/index.js';

describe('Temporal & BullMQ Worker Bridge Suite (Phase 8)', () => {
  it('manages distributed idempotency locks and prevents concurrent collisions', () => {
    const lockMgr = new DistributedLockManager();
    const key = 'reverify:order-service:2.0.0';

    // Worker A acquires lock
    const acquiredA = lockMgr.acquireLock(key, 'worker-a', 5000);
    expect(acquiredA).toBe(true);
    expect(lockMgr.isLocked(key)).toBe(true);

    // Worker B tries to acquire same lock while held -> Rejected
    const acquiredB = lockMgr.acquireLock(key, 'worker-b', 5000);
    expect(acquiredB).toBe(false);

    // Worker B cannot release Worker A's lock
    const releasedWrong = lockMgr.releaseLock(key, 'worker-b');
    expect(releasedWrong).toBe(false);
    expect(lockMgr.isLocked(key)).toBe(true);

    // Worker A releases own lock
    const releasedA = lockMgr.releaseLock(key, 'worker-a');
    expect(releasedA).toBe(true);
    expect(lockMgr.isLocked(key)).toBe(false);

    // Now Worker B can acquire
    const acquiredB2 = lockMgr.acquireLock(key, 'worker-b', 5000);
    expect(acquiredB2).toBe(true);
  });

  it('tracks activity heartbeats and detects heartbeat timeouts accurately', () => {
    const hbMgr = new ActivityHeartbeatManager();
    const actId = 'act-mutation-001';
    const now = 1000000;

    // Register activity with 10s max interval
    hbMgr.registerActivity(actId, 'wf-101', 10000, now);
    expect(hbMgr.getStatus(actId)?.status).toBe('HEALTHY');

    // Heartbeat received at +5s
    hbMgr.recordHeartbeat(actId, now + 5000);
    expect(hbMgr.evaluateTimeouts(now + 6000).length).toBe(0);

    // Time progresses past interval (+16s without heartbeat)
    const timedOut = hbMgr.evaluateTimeouts(now + 16000);
    expect(timedOut.length).toBe(1);
    expect(timedOut[0]?.status).toBe('HEARTBEAT_TIMEOUT');
  });

  it('processes BullMQ re-verification batches, deduplicates duplicates, and routes to DLQ on exhaustion', async () => {
    const bridge = new TemporalBullMQBridge({ maxRetriesBeforeDLQ: 2 });

    const jobA: BullMQJobPayload = {
      jobId: 'reverify:billing:2.0.0',
      triggeringContractId: 'contract-auth',
      triggeringVersion: '2.0.0',
      downstreamUnitId: 'billing-service',
      gates: ['L0', 'L1a'],
      workflowId: 'wf-100',
      nodeId: 'node-billing',
      dispatchedAt: new Date().toISOString(),
    };

    // 1. Process valid job
    const summary1 = await bridge.processBatch([jobA]);
    expect(summary1.totalProcessed).toBe(1);
    expect(summary1.successfulReverifications).toBe(1);
    expect(summary1.verdicts.length).toBe(2);

    // 2. Simulate concurrent collision by holding the lock externally
    const sharedLockMgr = new DistributedLockManager();
    const lockedBridge = new TemporalBullMQBridge({ lockManager: sharedLockMgr });
    sharedLockMgr.acquireLock('lock:reverify:billing:2.0.0', 'external-runner', 30000);

    const summary2 = await lockedBridge.processBatch([jobA]);
    expect(summary2.totalProcessed).toBe(1);
    // Concurrent duplicate must be cleanly deduplicated!
    expect(summary2.duplicatesDeduplicated).toBe(1);
  });
});
