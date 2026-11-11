import { describe, it, expect } from 'vitest';
import type { DAGBlueprint, ModuleContract } from '@fable/contracts';
import { InMemoryPersistenceStore } from '@fable/persistence-postgres';
import {
  TemporalRuntimeController,
  ReplayDeterminismHarness,
} from '../src/index.js';

describe('Phase 15: Live Temporal Runtime & Replay Determinism Suite', () => {
  const cAuth: ModuleContract = {
    id: 'c-auth',
    name: 'auth',
    version: '1.0.0',
    description: 'Auth',
    inputs: {},
    outputs: {},
    stateHooks: false,
    dependencies: [],
    requiredGates: ['L0'],
    executionBudgetMs: 30000,
    author: 'arch',
    createdAt: new Date().toISOString(),
  };

  const cOrders: ModuleContract = {
    id: 'c-orders',
    name: 'orders',
    version: '1.0.0',
    description: 'Orders',
    inputs: {},
    outputs: {},
    stateHooks: true,
    dependencies: [],
    requiredGates: ['L0', 'L3'],
    executionBudgetMs: 60000,
    author: 'arch',
    createdAt: new Date().toISOString(),
  };

  const contracts = new Map([
    [cAuth.id, cAuth],
    [cOrders.id, cOrders],
  ]);

  const blueprint: DAGBlueprint = {
    blueprintId: 'bp-temp-01',
    goalId: 'goal-temp-01',
    version: '1.0.0',
    title: 'Temporal Runtime Test Flow',
    description: 'Two-step DAG with stateful node',
    status: 'DRAFT',
    author: 'arch',
    createdAt: new Date().toISOString(),
    nodes: [
      {
        nodeId: 'node-auth',
        contractId: 'c-auth',
        contractVersion: '1.0.0',
        dependencies: [],
        allowBranchFailure: false,
        timeoutMs: 30000,
        retryPolicy: { maxAttempts: 2, initialIntervalMs: 100, backoffCoefficient: 2, maximumIntervalMs: 500 },
      },
      {
        nodeId: 'node-orders',
        contractId: 'c-orders',
        contractVersion: '1.0.0',
        dependencies: ['node-auth'],
        allowBranchFailure: false,
        timeoutMs: 60000,
        retryPolicy: { maxAttempts: 2, initialIntervalMs: 100, backoffCoefficient: 2, maximumIntervalMs: 500 },
      },
    ],
  };

  it('executes workflow transactionally into persistence store and replays deterministically', async () => {
    const store = new InMemoryPersistenceStore();
    const controller = new TemporalRuntimeController({ store, contracts });

    const wfId = 'wf-runtime-001';
    const initial = await controller.startWorkflow(wfId, blueprint);
    expect(initial.status).toBe('PENDING_APPROVAL');

    await controller.signalApproveAndExecute(wfId, blueprint, {
      approvedBy: 'lead@synthos.dev',
    });

    const completed = await controller.signalPromoteRelease(wfId, blueprint, {
      approvedBy: 'director@synthos.dev',
      targetEnvironment: 'PRODUCTION',
    });

    expect(completed.status).toBe('COMPLETED');
    expect(completed.releasePromoted).toBe(true);

    // Check durable verdicts and audit events saved in store
    const verdicts = await store.getVerdictsForWorkflow(wfId);
    expect(verdicts.length).toBe(3); // node-auth L0 + node-orders L0 & L3

    const auditEvents = await store.getAuditEvents(wfId);
    expect(auditEvents.length).toBeGreaterThanOrEqual(4);

    // Verify deterministic replay matches final state without re-executing sandboxes
    const history = controller.getRecordedHistory(wfId);
    const replay = await ReplayDeterminismHarness.replayHistory(history, completed);
    expect(replay.deterministic).toBe(true);
    expect(replay.replayedState.status).toBe('COMPLETED');
    expect(replay.replayedState.releasePromoted).toBe(true);
  });

  it('recovers an inflight RUNNING workflow cleanly after simulated worker crash', async () => {
    const store = new InMemoryPersistenceStore();

    // Simulate a crashed worker snapshot where node-auth passed and node-orders is still waiting
    await store.saveWorkflow({
      workflowId: 'wf-crashed-99',
      goalId: 'goal-temp-01',
      blueprintId: 'bp-temp-01',
      status: 'RUNNING',
      createdAt: new Date().toISOString(),
      approvedBy: 'lead@synthos.dev',
      approvedAt: new Date().toISOString(),
      sla24hAlertTriggered: false,
      sla48hStalePaused: false,
      releasePromoted: false,
      auditLog: [],
      nodeStates: {
        'node-auth': {
          nodeId: 'node-auth',
          contractId: 'c-auth',
          contractVersion: '1.0.0',
          state: 'PASSED',
          attempts: 1,
          verdicts: [],
        },
        'node-orders': {
          nodeId: 'node-orders',
          contractId: 'c-orders',
          contractVersion: '1.0.0',
          state: 'WAITING_DEPENDENCIES',
          attempts: 0,
          verdicts: [],
        },
      },
    });

    // Brand-new controller instance (simulating new worker pod booting up)
    const recoveredController = new TemporalRuntimeController({ store, contracts });
    const recoveredState = await recoveredController.recoverAfterWorkerRestart('wf-crashed-99', blueprint);

    expect(recoveredState.status).toBe('COMPLETED');
    expect(recoveredState.nodeStates['node-orders']?.state).toBe('PASSED');
    expect(recoveredState.nodeStates['node-orders']?.attempts).toBe(1);
    expect(recoveredState.nodeStates['node-auth']?.attempts).toBe(1); // Not re-run!
  });
});
