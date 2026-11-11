import { describe, it, expect, vi } from 'vitest';
import { TemporalBullMQBridge, type BullMQJobPayload } from '@fable/worker-bridge';
import {
  RedisSlidingWindowRateLimiter,
  InMemorySlidingWindowRateLimiter,
  PriorityQueueRouter,
  SLIDING_WINDOW_LUA,
  type RedisCommandClient,
} from '../src/index.js';

describe('Phase 16: Live Redis BullMQ & Backpressure Throttler Suite', () => {
  const createPayload = (id: string): BullMQJobPayload => ({
    jobId: id,
    triggeringContractId: 'c-core',
    triggeringVersion: '2.0.0',
    downstreamUnitId: `unit-${id}`,
    gates: ['L0'],
    workflowId: 'wf-q',
    nodeId: `node-${id}`,
    dispatchedAt: new Date().toISOString(),
  });

  it('invokes atomic Redis Lua script for distributed rate limiting', async () => {
    const evalMock = vi.fn(async () => 1);
    const mockRedis: RedisCommandClient = { eval: evalMock };

    const limiter = new RedisSlidingWindowRateLimiter(mockRedis, {
      maxJobsPerWindow: 5,
      windowMs: 10000,
    });

    const allowed = await limiter.tryAcquire('fable:bucket', 50000);
    expect(allowed).toBe(true);
    expect(evalMock).toHaveBeenCalledWith(
      SLIDING_WINDOW_LUA,
      1,
      'fable:bucket',
      50000,
      10000,
      5,
      expect.stringMatching(/^50000-/)
    );
  });

  it('enforces priority preemption and backpressure throttling, then drains after window reset', async () => {
    const limiter = new InMemorySlidingWindowRateLimiter({
      maxJobsPerWindow: 2,
      windowMs: 5000,
    });
    const router = new PriorityQueueRouter({ rateLimiter: limiter });

    const t0 = 100000;
    router.enqueue(createPayload('normal-1'), 'NORMAL', t0);
    router.enqueue(createPayload('high-1'), 'HIGH', t0 + 1);
    router.enqueue(createPayload('critical-1'), 'CRITICAL', t0 + 2);
    // Duplicate upgrade: normal-1 upgraded to CRITICAL
    router.enqueue(createPayload('normal-1'), 'CRITICAL', t0 + 3);

    expect(router.queueDepth()).toBe(3);

    // Drain at t0 + 10ms: capacity is 2 -> both CRITICAL jobs dispatch, HIGH stays deferred
    const batch1 = await router.drainBatch(t0 + 10);
    expect(batch1.dispatched.map(j => j.jobId)).toEqual(['normal-1', 'critical-1']);
    expect(batch1.deferredBackpressure.length).toBe(1);
    expect(batch1.deferredBackpressure[0]?.payload.jobId).toBe('high-1');
    expect(router.queueDepth()).toBe(1);

    // Drain after sliding window expires (t0 + 6000ms) -> remaining HIGH job dispatches
    const batch2 = await router.drainBatch(t0 + 6000);
    expect(batch2.dispatched.map(j => j.jobId)).toEqual(['high-1']);
    expect(router.queueDepth()).toBe(0);

    // Verify seamless processing through Phase 8 TemporalBullMQBridge
    const bridge = new TemporalBullMQBridge();
    const summary = await bridge.processBatch([...batch1.dispatched, ...batch2.dispatched]);
    expect(summary.successfulReverifications).toBe(3);
  });
});
