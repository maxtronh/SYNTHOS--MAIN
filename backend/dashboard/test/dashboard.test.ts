import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { DAGBlueprint } from '@fable/contracts';
import { DAGEngine, type NodeExecutionHandler } from '@fable/orchestrator-temporal';
import { OperatorDashboardServer, DashboardStateStore } from '../src/index.js';

describe('Operator Dashboard & Human Review Server Suite (Phase 9)', () => {
  let server: OperatorDashboardServer;
  let port: number;
  let store: DashboardStateStore;
  let engine: DAGEngine;

  beforeAll(async () => {
    store = new DashboardStateStore();
    server = new OperatorDashboardServer(store);
    port = await server.start(0); // Ephemeral port

    const blueprint: DAGBlueprint = {
      blueprintId: 'bp-dash-01',
      goalId: 'goal-dash-ui',
      version: '1.0.0',
      title: 'Dashboard Review Flow',
      description: 'Testing dashboard control plane',
      status: 'DRAFT',
      author: 'architect',
      createdAt: new Date().toISOString(),
      nodes: [
        {
          nodeId: 'node-api',
          contractId: 'contract-api',
          contractVersion: '1.0.0',
          dependencies: [],
          allowBranchFailure: false,
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 1, initialIntervalMs: 100, backoffCoefficient: 1, maximumIntervalMs: 100 },
        },
      ],
    };

    const handler: NodeExecutionHandler = {
      executeNode: async (_wfId, nodeId, cId, cVer) => [
        {
          verdictId: `v-${nodeId}`,
          workflowId: 'wf-dash-100',
          nodeId,
          contractId: cId,
          contractVersion: cVer,
          gate: 'L0',
          status: 'PASS',
          sandboxPath: 'PATH_A_EPHEMERAL',
          executionDurationMs: 120,
          isAuthoritative: true,
          errorDetails: [],
          metrics: {},
          evaluatedAt: new Date().toISOString(),
        },
      ],
    };

    engine = new DAGEngine('wf-dash-100', blueprint, handler);
    store.registerWorkflow(engine);

    store.addDecisionMemo({
      memoId: 'memo-dash-001',
      goalId: 'goal-dash-ui',
      workflowId: 'wf-dash-100',
      nodeId: 'node-api',
      contractId: 'contract-api',
      contractVersion: '1.0.0',
      status: 'PENDING_REVIEW',
      totalCyclesAttempted: 3,
      patchHistory: [],
      consolidatedErrorLogs: '3 automated patch attempts failed L1a.',
      unresolvedQuestions: ['Approve schema relaxation?'],
      assignedTo: 'senior-engineer@synthos.dev',
      createdAt: new Date().toISOString(),
    });

    store.metricsTracker.recordExecution({
      workflowId: 'wf-dash-100',
      moduleId: 'contract-api',
      llmCostUsd: 0.04,
      computeCostUsd: 0.01,
      pipelineLatencyMs: 2500,
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  it('serves health check and interactive HTML control plane UI', async () => {
    const healthRes = await fetch(`http://localhost:${port}/api/health`);
    expect(healthRes.status).toBe(200);
    const healthData = await healthRes.json() as { status: string };
    expect(healthData.status).toBe('ok');

    const htmlRes = await fetch(`http://localhost:${port}/`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain('Fable Engine v3');
    expect(html).toContain('Active & Recent Workflows');

    const cssRes = await fetch(`http://localhost:${port}/styles.css`);
    expect(cssRes.status).toBe(200);
    expect(await cssRes.text()).toContain('--primary');

    const jsRes = await fetch(`http://localhost:${port}/app.js`);
    expect(jsRes.status).toBe(200);
    expect(await jsRes.text()).toContain('loadDashboard');
  });

  it('exposes workflows, memos, and telemetry APIs', async () => {
    const wfRes = await fetch(`http://localhost:${port}/api/workflows`);
    const wfData = await wfRes.json() as { workflows: Array<{ workflowId: string; status: string }> };
    expect(wfData.workflows.length).toBe(1);
    expect(wfData.workflows[0]?.status).toBe('PENDING_APPROVAL');

    const memoRes = await fetch(`http://localhost:${port}/api/memos`);
    const memoData = await memoRes.json() as { memos: Array<{ memoId: string }> };
    expect(memoData.memos.length).toBe(1);
    expect(memoData.memos[0]?.memoId).toBe('memo-dash-001');

    const telRes = await fetch(`http://localhost:${port}/api/telemetry`);
    const telData = await telRes.json() as { costs: { avgTotalCost: number }; latency: { p95: number } };
    expect(telData.costs.avgTotalCost).toBeCloseTo(0.05);
    expect(telData.latency.p95).toBe(2500);
  });

  it('allows explicit human approval and release promotion via HTTP API', async () => {
    // 1. Approve Blueprint
    const approveRes = await fetch(`http://localhost:${port}/api/workflows/wf-dash-100/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'lead-operator@synthos.dev' }),
    });
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json() as { workflow: { status: string; approvedBy: string } };
    expect(approveData.workflow.status).toBe('RUNNING');
    expect(approveData.workflow.approvedBy).toBe('lead-operator@synthos.dev');

    // 2. Execute DAG engine to completion
    await engine.runUntilDone();
    expect(engine.getState().status).toBe('COMPLETED');

    // 3. Explicit Release Promotion
    const promoteRes = await fetch(`http://localhost:${port}/api/workflows/wf-dash-100/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'release-director@synthos.dev', targetEnvironment: 'PRODUCTION' }),
    });
    expect(promoteRes.status).toBe(200);
    const promoteData = await promoteRes.json() as { workflow: { releasePromoted: boolean } };
    expect(promoteData.workflow.releasePromoted).toBe(true);
  });
});
