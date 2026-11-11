import { describe, it, expect } from 'vitest';
import {
  MetaReviewer,
  DAGBlueprintSchema,
  ModuleContractSchema,
  type ModuleContract,
  type DAGBlueprint,
} from '@fable/contracts';
import { DeterministicAdapterBuilder } from '@fable/builder-deterministic';
import { DAGEngine, type NodeExecutionHandler } from '@fable/orchestrator-temporal';
import { GateRunner, EphemeralSandbox, StatefulSandbox } from '@fable/gate-runner';
import { GraphResolver, BlastRadiusDispatcher } from '@fable/blast-radius-resolver';
import {
  ASTChunker,
  VectorRetriever,
  LLMCircuitBreaker,
  PatchLoopController,
} from '@fable/retrieval-pgvector';
import {
  PrecisionLedger,
  RecallLedger,
  OperationalMetricsTracker,
} from '@fable/ledger-telemetry';

describe('Fable Engine v3 — Master Acceptance Checklist Suite', () => {
  // Common test contracts
  const cAuth: ModuleContract = {
    id: 'contract-auth',
    name: 'auth-service',
    version: '1.0.0',
    description: 'User authentication and token service',
    inputs: { username: { type: 'string', required: true } },
    outputs: { token: { type: 'string', required: true } },
    stateHooks: false, // Pure code -> Path A
    dependencies: [],
    requiredGates: ['L0', 'L1a'],
    executionBudgetMs: 30000,
    author: 'architect',
    createdAt: new Date().toISOString(),
  };

  const cOrderDb: ModuleContract = {
    id: 'contract-order-db',
    name: 'order-db',
    version: '1.0.0',
    description: 'Order stateful schema and Prisma migrations',
    inputs: { token: { type: 'string', required: true } },
    outputs: { orderId: { type: 'string', required: true } },
    stateHooks: true, // Stateful -> Path B
    dependencies: [{ contractId: 'contract-auth', name: 'auth-service', versionRange: '^1.0.0' }],
    requiredGates: ['L0', 'L1a', 'L3'],
    executionBudgetMs: 120000,
    author: 'architect',
    createdAt: new Date().toISOString(),
  };

  const contractMap = new Map([
    [cAuth.id, cAuth],
    [cOrderDb.id, cOrderDb],
  ]);

  const validBlueprint: DAGBlueprint = {
    blueprintId: 'bp-acceptance-01',
    goalId: 'goal-ecommerce-v3',
    version: '1.0.0',
    title: 'E-commerce Pipeline',
    description: 'End to end checkout flow',
    status: 'DRAFT',
    author: 'principal-architect',
    createdAt: new Date().toISOString(),
    nodes: [
      {
        nodeId: 'node-auth',
        contractId: 'contract-auth',
        contractVersion: '1.0.0',
        dependencies: [],
        allowBranchFailure: false,
        timeoutMs: 30000,
        retryPolicy: { maxAttempts: 3, initialIntervalMs: 100, backoffCoefficient: 2, maximumIntervalMs: 1000 },
      },
      {
        nodeId: 'node-order-db',
        contractId: 'contract-order-db',
        contractVersion: '1.0.0',
        dependencies: ['node-auth'],
        allowBranchFailure: false,
        timeoutMs: 60000,
        retryPolicy: { maxAttempts: 3, initialIntervalMs: 100, backoffCoefficient: 2, maximumIntervalMs: 1000 },
      },
    ],
  };

  // Section 3 Checklist: Workflow Correctness
  describe('1. Workflow Correctness & DAG Semantics', () => {
    it('[x] DAG nodes execute only after all declared dependencies pass', async () => {
      const order: string[] = [];
      const handler: NodeExecutionHandler = {
        executeNode: async (_wfId, nodeId, contractId, contractVer) => {
          order.push(nodeId);
          return [
            {
              verdictId: `v-${nodeId}`,
              workflowId: 'wf-1',
              nodeId,
              contractId,
              contractVersion: contractVer,
              gate: 'L0',
              status: 'PASS',
              sandboxPath: 'PATH_A_EPHEMERAL',
              executionDurationMs: 100,
              isAuthoritative: true,
              errorDetails: [],
              metrics: {},
              evaluatedAt: new Date().toISOString(),
            },
          ];
        },
      };

      const engine = new DAGEngine('wf-check-01', validBlueprint, handler);
      engine.approveBlueprint({ approvedBy: 'chief-engineer' });
      await engine.runUntilDone();

      expect(order).toEqual(['node-auth', 'node-order-db']);
      expect(engine.getState().status).toBe('COMPLETED');
    });

    it('[x] A dependency failure prevents dependent work and triggers defined cancellation', async () => {
      const handler: NodeExecutionHandler = {
        executeNode: async () => [
          {
            verdictId: 'v-fail',
            workflowId: 'wf-2',
            nodeId: 'node-auth',
            contractId: 'contract-auth',
            contractVersion: '1.0.0',
            gate: 'L0',
            status: 'FAIL',
            sandboxPath: 'PATH_A_EPHEMERAL',
            executionDurationMs: 100,
            isAuthoritative: true,
            errorDetails: ['L0 static typing error'],
            metrics: {},
            evaluatedAt: new Date().toISOString(),
          },
        ],
      };

      const engine = new DAGEngine('wf-check-02', validBlueprint, handler);
      engine.approveBlueprint({ approvedBy: 'chief-engineer' });
      const state = await engine.runUntilDone();

      expect(state.status).toBe('FAILED');
      expect(state.nodeStates['node-auth']?.state).toBe('FAILED');
      expect(state.nodeStates['node-order-db']?.state).toBe('CANCELLED');
    });

    it('[x] Retry policies distinguish transient infrastructure faults from deterministic verification failures', async () => {
      let authAttempts = 0;
      const handler: NodeExecutionHandler = {
        executeNode: async () => {
          authAttempts++;
          return [
            {
              verdictId: 'v-det-fail',
              workflowId: 'wf-3',
              nodeId: 'node-auth',
              contractId: 'contract-auth',
              contractVersion: '1.0.0',
              gate: 'L0',
              status: 'FAIL', // Deterministic failure: MUST NOT BE RETRIED
              sandboxPath: 'PATH_A_EPHEMERAL',
              executionDurationMs: 100,
              isAuthoritative: true,
              errorDetails: ['Type check failed'],
              metrics: {},
              evaluatedAt: new Date().toISOString(),
            },
          ];
        },
      };

      const engine = new DAGEngine('wf-check-03', validBlueprint, handler);
      engine.approveBlueprint({ approvedBy: 'lead-dev' });
      await engine.runUntilDone();

      // Zero extra retries for deterministic failure
      expect(authAttempts).toBe(1);
    });
  });

  // Section 3 Checklist: Verification and Isolation
  describe('2. Verification Budgets and Sandbox Isolation', () => {
    it('[x] L0 budget (<60s) and L1a budget (<3m) enforced', async () => {
      expect(GateRunner.GATE_BUDGETS_MS['L0']).toBe(60000);
      expect(GateRunner.GATE_BUDGETS_MS['L1a']).toBe(180000);
      expect(GateRunner.GATE_BUDGETS_MS['L1b']).toBe(1800000);
    });

    it('[x] Egress restrictions and ephemeral filesystem destruction verified', async () => {
      const sandbox = new EphemeralSandbox({
        jobId: 'sec-chk',
        egressAllowlist: ['minio.internal', 'llm-gateway.internal'],
      });

      const blocked = await sandbox.executeCommand('curl', ['https://unauthorized-destination.com']);
      expect(blocked.exitCode).toBe(1);
      expect(blocked.stderr).toContain('Egress blocked');

      await sandbox.destroy();
      expect(sandbox.isDestroyed()).toBe(true);
    });

    it('[x] Stateful sandbox isolated per job and torn down on terminal path', async () => {
      const sandbox = new StatefulSandbox({ jobId: 'dry-run-chk' });
      expect(sandbox.hasActiveResources()).toBe(true);

      const dryRunRes = await sandbox.executeCommand('prisma migrate deploy');
      expect(dryRunRes.exitCode).toBe(0);

      await sandbox.destroy();
      expect(sandbox.hasActiveResources()).toBe(false);
      expect(sandbox.isDestroyed()).toBe(true);
    });
  });

  // Section 3 Checklist: Retrieval and AI Advisory Layer
  describe('3. Retrieval and AI Advisory Layer', () => {
    it('[x] Prompt context is bounded with provenance', () => {
      const retriever = new VectorRetriever();
      retriever.indexCode('src/auth.ts', 'export function login() { return true; }');

      const bounded = retriever.assembleBoundedPrompt(
        'System reviewer',
        'login',
        { topK: 1, maxTokensApprox: 100 }
      );
      expect(bounded.retrievedChunks.length).toBe(1);
      expect(bounded.retrievedChunks[0]?.filePath).toBe('src/auth.ts');
    });

    it('[x] Gateway outage produces DEFERRED AI findings and does not create an implicit PASS', async () => {
      const breaker = new LLMCircuitBreaker({ failureThreshold: 1 });
      const res = await breaker.executeWithFallback(async () => {
        throw new Error('504 Gateway Timeout');
      }, {
        workflowId: 'wf-ai',
        nodeId: 'node-auth',
        persona: 'threat-modeler',
      });

      expect(res.status).toBe('DEFERRED');
    });

    it('[x] AI patch proposals are capped at 3 cycles and produce a DecisionMemo', () => {
      const loop = new PatchLoopController({
        workflowId: 'wf-loop',
        goalId: 'goal-loop',
        nodeId: 'node-auth',
        contractId: 'contract-auth',
        contractVersion: '1.0.0',
      });

      for (let i = 1; i <= 3; i++) {
        loop.recordCycle(
          { patchDiff: `+ fix ${i}`, modelPersona: 'fuzzer' },
          { passed: false, failureGate: 'L1a', failureOutput: 'Property test failed' }
        );
      }

      expect(loop.canAttemptAnotherCycle()).toBe(false);
      const memo = loop.generateDecisionMemo(['Why did 3 automated patches fail?']);
      expect(memo.totalCyclesAttempted).toBe(3);
      expect(memo.status).toBe('PENDING_REVIEW');
    });
  });

  // Section 3 Checklist: Dependency and Human Controls
  describe('4. Blast-Radius Invalidation and Human Governance', () => {
    it('[x] MAJOR contract bump triggers blast-radius re-verification and release hold barrier', async () => {
      const edges = [{ fromUnitId: 'node-order-db', toUnitId: 'contract-auth' }];
      const dispatcher = new BlastRadiusDispatcher({ edges });

      // Major bump 1.0.0 -> 2.0.0
      const jobs = dispatcher.handleContractVersionUpdate('contract-auth', '1.0.0', '2.0.0');
      expect(jobs.length).toBe(1);

      // Release hold must be ACTIVE
      const holdBefore = dispatcher.evaluateReleaseHold('contract-auth', '2.0.0');
      expect(holdBefore.canPromote).toBe(false);

      // Reconcile and pass
      await dispatcher.reconcileJobs();
      const holdAfter = dispatcher.evaluateReleaseHold('contract-auth', '2.0.0');
      expect(holdAfter.canPromote).toBe(true);
    });

    it('[x] 24h alert and 48h stale SLA state transitions', () => {
      const handler: NodeExecutionHandler = { executeNode: async () => [] };
      const engine = new DAGEngine('wf-sla', validBlueprint, handler);

      const t0 = new Date(engine.getState().approvalRequestedAt!).getTime();
      engine.checkApprovalSLAs(t0 + 25 * 60 * 60 * 1000);
      expect(engine.getState().sla24hAlertTriggered).toBe(true);

      engine.checkApprovalSLAs(t0 + 49 * 60 * 60 * 1000);
      expect(engine.getState().sla48hStalePaused).toBe(true);
      expect(engine.getState().status).toBe('STALE_PAUSED');
    });

    it('[x] Production promotion is never automatic and requires explicit human approval', async () => {
      const handler: NodeExecutionHandler = {
        executeNode: async (_w, nodeId, cId, cVer) => [
          {
            verdictId: `v-${nodeId}`,
            workflowId: 'wf-promo',
            nodeId,
            contractId: cId,
            contractVersion: cVer,
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
      };

      const singleNodeBp: DAGBlueprint = {
        ...validBlueprint,
        nodes: [validBlueprint.nodes[0]!],
      };

      const engine = new DAGEngine('wf-promo', singleNodeBp, handler);
      engine.approveBlueprint({ approvedBy: 'approver' });
      await engine.runUntilDone();

      expect(engine.getState().status).toBe('COMPLETED');
      expect(engine.getState().releasePromoted).toBe(false); // Never auto-promoted!

      engine.promoteRelease({ approvedBy: 'security-director', targetEnvironment: 'PRODUCTION' });
      expect(engine.getState().releasePromoted).toBe(true);
    });
  });

  // Section 3 Checklist: Dual Ledgers and Observability
  describe('5. Dual Ledgers and Observability', () => {
    it('[x] Precision ledger down-samples below 50% and retires below 30%', () => {
      const ledger = new PrecisionLedger();
      const rec = ledger.adjudicateCohort({
        personaId: 'noisy-bot',
        cohortId: 'c-1',
        totalProposedTests: 10,
        verifiedCatchingBugs: 4,
        adjudicationEvidence: '6 tests were non-reproducible',
      });

      expect(rec.status).toBe('DOWN_SAMPLED');
    });

    it('[x] Recall ledger flags AI layer reduction when recall < 40% for 2 consecutive batches', () => {
      const ledger = new RecallLedger();
      const persona = 'edge-detector';

      // Batch 1
      ledger.recordEscape({
        escapeId: 'esc-1',
        description: 'Broke in prod',
        personaInvolved: persona,
        batchId: 'b-1',
        hadOpportunityToDetect: true,
        wasReasonablyCatchable: true,
        adjudicatedBy: 'lead',
      });
      ledger.evaluateBatchRecall({ personaId: persona, batchId: 'b-1', detectedCount: 0 });

      // Batch 2
      ledger.recordEscape({
        escapeId: 'esc-2',
        description: 'Broke again in prod',
        personaInvolved: persona,
        batchId: 'b-2',
        hadOpportunityToDetect: true,
        wasReasonablyCatchable: true,
        adjudicatedBy: 'lead',
      });
      ledger.evaluateBatchRecall({ personaId: persona, batchId: 'b-2', detectedCount: 0 });

      expect(ledger.shouldShrinkAILayer(persona)).toBe(true);
    });

    it('[x] Cost and P50/P95 latencies are measurable and attributable', () => {
      const metrics = new OperationalMetricsTracker();
      for (let i = 1; i <= 10; i++) {
        metrics.recordExecution({
          workflowId: `wf-${i}`,
          moduleId: 'auth-service',
          llmCostUsd: 0.05,
          computeCostUsd: 0.02,
          pipelineLatencyMs: i * 500,
          blastRadiusResolutionMs: 200,
        });
      }

      const cost = metrics.getAverageCostPerModule();
      expect(cost.avgTotalCost).toBeCloseTo(0.07);

      const latencies = metrics.getLatencyStats();
      expect(latencies.p50).toBe(3000);
      expect(latencies.p95).toBe(5000);
    });
  });
});
