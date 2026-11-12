import { describe, it, expect } from 'vitest';
import type { DAGBlueprint, ModuleContract } from '@fable/contracts';
import { DAGEngine, type NodeExecutionHandler } from '@fable/orchestrator-temporal';
import { InMemoryPersistenceStore } from '@fable/persistence-postgres';
import { TemporalRuntimeController, ReplayDeterminismHarness } from '@fable/temporal-runtime';
import {
  InMemorySlidingWindowRateLimiter,
  PriorityQueueRouter,
} from '@fable/queue-redis';
import {
  DistributedLockManager,
  TemporalBullMQBridge,
  type BullMQJobPayload,
} from '@fable/worker-bridge';
import { BlastRadiusDispatcher } from '@fable/blast-radius-resolver';
import { SlsaAttestationAuthority } from '@fable/attestation-slsa';
import {
  ProductionSignOffGate,
  type OperatorPrincipal,
} from '@fable/governance-opa';

describe('Phases 37 & 38: Executable DR Game-Day Drills & Production Sign-Off Gate', () => {
  const cAuth: ModuleContract = {
    id: 'c-auth',
    name: 'auth-service',
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
    name: 'orders-db',
    version: '1.0.0',
    description: 'Stateful orders schema',
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
    blueprintId: 'bp-dr-01',
    goalId: 'goal-dr-drill',
    version: '1.0.0',
    title: 'DR Drill Pipeline',
    description: 'Verifies Temporal recovery, Redis outage drain, 48h archival, and Go-Live sign-off',
    status: 'DRAFT',
    author: 'platform-dev',
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

  it('Drill 1 (P37): recovers interrupted Temporal workflow after worker crash and passes deterministic replay', async () => {
    const store = new InMemoryPersistenceStore();

    // Simulate mid-flight crash after node-auth completed
    await store.saveWorkflow({
      workflowId: 'wf-dr-crash',
      goalId: 'goal-dr-drill',
      blueprintId: 'bp-dr-01',
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

    const controller = new TemporalRuntimeController({ store, contracts });
    const resumed = await controller.recoverAfterWorkerRestart('wf-dr-crash', blueprint);

    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.nodeStates['node-auth']?.attempts).toBe(1);
    expect(resumed.nodeStates['node-orders']?.state).toBe('PASSED');

    // Replay check on a fresh workflow lifecycle
    const freshWf = 'wf-dr-replay';
    await controller.startWorkflow(freshWf, blueprint);
    const completed = await controller.signalApproveAndExecute(freshWf, blueprint, {
      approvedBy: 'lead@synthos.dev',
    });
    const replay = await ReplayDeterminismHarness.replayHistory(
      controller.getRecordedHistory(freshWf),
      completed
    );
    expect(replay.deterministic).toBe(true);
  });

  it('Drill 2 (P37): drains backlog after Redis outage with CRITICAL preemption, deduplication, and release hold clearance', async () => {
    const dispatcher = new BlastRadiusDispatcher({
      edges: [{ fromUnitId: 'c-orders', toUnitId: 'c-auth' }],
    });
    const jobs = dispatcher.handleContractVersionUpdate('c-auth', '1.0.0', '2.0.0');
    expect(jobs.length).toBe(1);
    expect(dispatcher.evaluateReleaseHold('c-auth', '2.0.0').canPromote).toBe(false);

    // Outage backlog queued into PriorityQueueRouter
    const limiter = new InMemorySlidingWindowRateLimiter({ maxJobsPerWindow: 2, windowMs: 1000 });
    const router = new PriorityQueueRouter({ rateLimiter: limiter });
    const t0 = 50000;

    const criticalPayload: BullMQJobPayload = {
      jobId: jobs[0]!.jobId,
      triggeringContractId: 'c-auth',
      triggeringVersion: '2.0.0',
      downstreamUnitId: 'c-orders',
      gates: ['L0', 'L1a'],
      workflowId: 'wf-dr-redis',
      nodeId: 'node-orders',
      dispatchedAt: new Date().toISOString(),
    };

    router.enqueue(
      { ...criticalPayload, jobId: 'low-priority-l1b', downstreamUnitId: 'metrics' },
      'NORMAL',
      t0
    );
    router.enqueue(criticalPayload, 'CRITICAL', t0 + 1);

    const { dispatched } = await router.drainBatch(t0 + 2);
    expect(dispatched[0]?.jobId).toBe(criticalPayload.jobId);

    const lockMgr = new DistributedLockManager();
    const bridge = new TemporalBullMQBridge({ lockManager: lockMgr });
    const summary = await bridge.processBatch(dispatched);
    expect(summary.successfulReverifications).toBe(2);

    await dispatcher.reconcileJobs();
    expect(dispatcher.evaluateReleaseHold('c-auth', '2.0.0').canPromote).toBe(true);
  });

  it('Drill 3 (P37): exercises 24h alert, 48h STALE_PAUSED escalation, and 48h Release Candidate archival', async () => {
    const passHandler: NodeExecutionHandler = {
      executeNode: async (wfId, nodeId, cId, cVer) => [
        {
          verdictId: `v-${nodeId}`,
          workflowId: wfId,
          nodeId,
          contractId: cId,
          contractVersion: cVer,
          gate: 'L0',
          status: 'PASS',
          sandboxPath: 'PATH_A_EPHEMERAL',
          executionDurationMs: 25,
          isAuthoritative: true,
          errorDetails: [],
          metrics: {},
          evaluatedAt: new Date().toISOString(),
        },
      ],
    };

    const singleNodeBp: DAGBlueprint = { ...blueprint, nodes: [blueprint.nodes[0]!] };
    const engine = new DAGEngine('wf-dr-sla', singleNodeBp, passHandler);
    const t0 = new Date(engine.getState().approvalRequestedAt!).getTime();

    engine.checkApprovalSLAs(t0 + 25 * 60 * 60 * 1000);
    expect(engine.getState().sla24hAlertTriggered).toBe(true);

    engine.checkApprovalSLAs(t0 + 49 * 60 * 60 * 1000);
    expect(engine.getState().status).toBe('STALE_PAUSED');

    // Explicit approval unblocks paused DAG
    engine.approveBlueprint({ approvedBy: 'eng-lead@synthos.dev' });
    await engine.runUntilDone();
    expect(engine.getState().status).toBe('COMPLETED');
    expect(engine.getState().releasePromoted).toBe(false);

    // 48h unpromoted release candidate archival event emitted
    const completedAtMs = new Date(engine.getState().nodeStates['node-auth']!.completedAt!).getTime();
    engine.checkReleaseCandidateSLA(completedAtMs + 49 * 60 * 60 * 1000);

    const archivedAudit = engine
      .getState()
      .auditLog.find(e => e.eventType === 'RELEASE_CANDIDATE_ARCHIVED');
    expect(archivedAudit).toBeDefined();
  });

  it('Drill 4 (P38): enforces Ed25519 SLSA provenance and ProductionSignOffGate before Go-Live', () => {
    const authority = new SlsaAttestationAuthority();
    const attestation = authority.signProvenance({
      subjectName: 'rc-prod-dr-verified',
      artifactContent: 'verified-artifact-bytes',
      workflowId: 'wf-dr-replay',
      blueprintId: blueprint.blueprintId,
      contractId: 'c-auth',
      contractVersion: '1.0.0',
      builderId: 'firecracker-microvm',
      verdicts: [
        {
          verdictId: 'v-slsa-dr',
          workflowId: 'wf-dr-replay',
          nodeId: 'node-auth',
          contractId: 'c-auth',
          contractVersion: '1.0.0',
          gate: 'L0',
          status: 'PASS',
          sandboxPath: 'PATH_A_EPHEMERAL',
          executionDurationMs: 50,
          isAuthoritative: true,
          errorDetails: [],
          metrics: {},
          evaluatedAt: new Date().toISOString(),
        },
      ],
    });

    expect(() => authority.assertReleaseAuthorized([attestation])).not.toThrow();

    const secLead: OperatorPrincipal = {
      subjectId: 'sec-lead-1',
      email: 'ciso@synthos.dev',
      tenantId: 'synthos-prod',
      roles: ['SECURITY_LEAD'],
      ssoAuthenticated: true,
    };
    const director: OperatorPrincipal = {
      subjectId: 'dir-prod-1',
      email: 'vp-release@synthos.dev',
      tenantId: 'synthos-prod',
      roles: ['RELEASE_DIRECTOR'],
      ssoAuthenticated: true,
    };

    const signOff = ProductionSignOffGate.evaluate({
      releaseCandidateId: 'rc-prod-dr-verified',
      resourceTenantId: 'synthos-prod',
      resourceAuthorId: blueprint.author,
      evidence: {
        temporalReplayVerified: true,
        redisReconciliationVerified: true,
        sandboxCleanupVerified: true,
        slsaProvenanceVerified: authority.verifyAttestation(attestation),
        drGameDayPassed: true,
        openPreProdDecisionsResolved: true,
      },
      signatures: [
        { principal: secLead, signedAt: new Date().toISOString() },
        { principal: director, signedAt: new Date().toISOString() },
      ],
    });

    expect(signOff.approved).toBe(true);
    expect(signOff.blockingReasons).toHaveLength(0);
  });
});
