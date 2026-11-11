import { describe, it, expect, vi } from 'vitest';
import type { DAGBlueprint } from '@fable/contracts';
import { DAGEngine, type NodeExecutionHandler } from '../src/index.js';

describe('Temporal DAG Engine & SLA Verification', () => {
  const dummyBlueprint: DAGBlueprint = {
    blueprintId: 'bp-100',
    goalId: 'goal-payments-v3',
    version: '1.0.0',
    title: 'Payment Services Flow',
    description: 'Payment DAG flow testing',
    status: 'DRAFT',
    author: 'system-architect',
    createdAt: '2026-11-10T00:00:00.000Z',
    nodes: [
      {
        nodeId: 'node-auth',
        contractId: 'contract-auth',
        contractVersion: '1.0.0',
        dependencies: [],
        allowBranchFailure: true,
        timeoutMs: 30000,
        retryPolicy: { maxAttempts: 2, initialIntervalMs: 100, backoffCoefficient: 1.5, maximumIntervalMs: 500 },
      },
      {
        nodeId: 'node-ledger',
        contractId: 'contract-ledger',
        contractVersion: '1.0.0',
        dependencies: ['node-auth'],
        allowBranchFailure: false,
        timeoutMs: 60000,
        retryPolicy: { maxAttempts: 2, initialIntervalMs: 100, backoffCoefficient: 1.5, maximumIntervalMs: 500 },
      },
    ],
  };

  it('should start in PENDING_APPROVAL and reject execution before human approval', async () => {
    const mockHandler: NodeExecutionHandler = {
      executeNode: vi.fn(),
    };

    const engine = new DAGEngine('wf-001', dummyBlueprint, mockHandler);
    expect(engine.getState().status).toBe('PENDING_APPROVAL');

    const executed = await engine.executeNextStep();
    expect(executed).toBe(false);
    expect(mockHandler.executeNode).not.toHaveBeenCalled();
  });

  it('should trigger 24h SLA alert and 48h STALE_PAUSE transitions', () => {
    const mockHandler: NodeExecutionHandler = {
      executeNode: vi.fn(),
    };

    const engine = new DAGEngine('wf-002', dummyBlueprint, mockHandler);
    const initialTime = new Date(engine.getState().approvalRequestedAt!).getTime();

    // Fast-forward 25 hours
    const time25h = initialTime + 25 * 60 * 60 * 1000;
    engine.checkApprovalSLAs(time25h);
    expect(engine.getState().sla24hAlertTriggered).toBe(true);
    expect(engine.getState().status).toBe('PENDING_APPROVAL');

    // Fast-forward 49 hours
    const time49h = initialTime + 49 * 60 * 60 * 1000;
    engine.checkApprovalSLAs(time49h);
    expect(engine.getState().sla48hStalePaused).toBe(true);
    expect(engine.getState().status).toBe('STALE_PAUSED');
  });

  it('should execute dependencies in order upon human approval', async () => {
    const executionOrder: string[] = [];

    const mockHandler: NodeExecutionHandler = {
      executeNode: async (_wfId, nodeId, _contractId, _ver) => {
        executionOrder.push(nodeId);
        return [
          {
            verdictId: `v-${nodeId}`,
            workflowId: 'wf-003',
            nodeId,
            contractId: `contract-${nodeId}`,
            contractVersion: '1.0.0',
            gate: 'L0',
            status: 'PASS',
            sandboxPath: 'PATH_A_EPHEMERAL',
            executionDurationMs: 500,
            isAuthoritative: true,
            errorDetails: [],
            metrics: {},
            evaluatedAt: new Date().toISOString(),
          },
        ];
      },
    };

    const engine = new DAGEngine('wf-003', dummyBlueprint, mockHandler);
    engine.approveBlueprint({ approvedBy: 'lead-engineer@synthos.dev' });
    expect(engine.getState().status).toBe('RUNNING');

    const result = await engine.runUntilDone();
    expect(result.status).toBe('COMPLETED');
    expect(executionOrder).toEqual(['node-auth', 'node-ledger']);
    expect(result.releaseCandidateId).toBeDefined();
    expect(result.releasePromoted).toBe(false);
  });

  it('should not retry deterministic failures and cancel downstream dependents', async () => {
    const attemptsByNode: Record<string, number> = {};

    const mockHandler: NodeExecutionHandler = {
      executeNode: async (_wfId, nodeId, _contractId, _ver) => {
        attemptsByNode[nodeId] = (attemptsByNode[nodeId] || 0) + 1;
        if (nodeId === 'node-auth') {
          return [
            {
              verdictId: 'v-auth',
              workflowId: 'wf-004',
              nodeId,
              contractId: 'contract-auth',
              contractVersion: '1.0.0',
              gate: 'L0',
              status: 'FAIL',
              sandboxPath: 'PATH_A_EPHEMERAL',
              executionDurationMs: 300,
              isAuthoritative: true,
              errorDetails: ['ESLint: parsing error'],
              metrics: {},
              evaluatedAt: new Date().toISOString(),
            },
          ];
        }
        return [];
      },
    };

    const engine = new DAGEngine('wf-004', dummyBlueprint, mockHandler);
    engine.approveBlueprint({ approvedBy: 'lead-engineer@synthos.dev' });

    const result = await engine.runUntilDone();
    expect(result.status).toBe('FAILED');
    // Deterministic failure must not be retried!
    expect(attemptsByNode['node-auth']).toBe(1);
    // Downstream node must be cancelled, not executed
    expect(attemptsByNode['node-ledger']).toBeUndefined();
    expect(result.nodeStates['node-ledger']?.state).toBe('CANCELLED');
  });

  it('should retry transient infrastructure errors up to maxAttempts', async () => {
    let attempts = 0;

    const mockHandler: NodeExecutionHandler = {
      executeNode: async (_wfId, nodeId, _contractId, _ver) => {
        attempts++;
        if (attempts === 1) {
          return [
            {
              verdictId: 'v-infra-err',
              workflowId: 'wf-005',
              nodeId,
              contractId: 'contract-auth',
              contractVersion: '1.0.0',
              gate: 'L0',
              status: 'INFRA_ERROR',
              sandboxPath: 'PATH_A_EPHEMERAL',
              executionDurationMs: 100,
              isAuthoritative: true,
              errorDetails: ['Docker socket unavailable'],
              metrics: {},
              evaluatedAt: new Date().toISOString(),
            },
          ];
        }
        return [
          {
            verdictId: 'v-infra-pass',
            workflowId: 'wf-005',
            nodeId,
            contractId: 'contract-auth',
            contractVersion: '1.0.0',
            gate: 'L0',
            status: 'PASS',
            sandboxPath: 'PATH_A_EPHEMERAL',
            executionDurationMs: 150,
            isAuthoritative: true,
            errorDetails: [],
            metrics: {},
            evaluatedAt: new Date().toISOString(),
          },
        ];
      },
    };

    const singleNodeBlueprint: DAGBlueprint = {
      ...dummyBlueprint,
      nodes: [dummyBlueprint.nodes[0]!],
    };

    const engine = new DAGEngine('wf-005', singleNodeBlueprint, mockHandler);
    engine.approveBlueprint({ approvedBy: 'lead-engineer@synthos.dev' });

    const result = await engine.runUntilDone();
    expect(result.status).toBe('COMPLETED');
    expect(attempts).toBe(2);
  });

  it('requires explicit human approval for release promotion', async () => {
    const mockHandler: NodeExecutionHandler = {
      executeNode: async (_wfId, nodeId) => [
        {
          verdictId: `v-${nodeId}`,
          workflowId: 'wf-006',
          nodeId,
          contractId: `contract-${nodeId}`,
          contractVersion: '1.0.0',
          gate: 'L0',
          status: 'PASS',
          sandboxPath: 'PATH_A_EPHEMERAL',
          executionDurationMs: 100,
          isAuthoritative: true,
          errorDetails: [],
          metrics: {},
          evaluatedAt: new Date().toISOString(),
        },
      ],
    };

    const singleNodeBlueprint: DAGBlueprint = {
      ...dummyBlueprint,
      nodes: [dummyBlueprint.nodes[0]!],
    };

    const engine = new DAGEngine('wf-006', singleNodeBlueprint, mockHandler);
    engine.approveBlueprint({ approvedBy: 'approver@synthos.dev' });
    await engine.runUntilDone();

    expect(engine.getState().status).toBe('COMPLETED');
    expect(engine.getState().releasePromoted).toBe(false);

    engine.promoteRelease({
      approvedBy: 'release-manager@synthos.dev',
      targetEnvironment: 'PRODUCTION',
    });

    expect(engine.getState().releasePromoted).toBe(true);
    const promoAudit = engine.getState().auditLog.find(e => e.eventType === 'RELEASE_PROMOTION_GRANTED');
    expect(promoAudit).toBeDefined();
    expect(promoAudit?.payload['targetEnvironment']).toBe('PRODUCTION');
  });
});
