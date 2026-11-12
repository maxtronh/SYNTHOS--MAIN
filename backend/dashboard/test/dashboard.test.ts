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

  it('enforces OPA RBAC & separation-of-duties on /api/capabilities, /approve, and /promote (Phase 40)', async () => {
    const devPrincipal = {
      subjectId: 'dev-1',
      email: 'dev1@synthos.dev',
      tenantId: 'default',
      roles: ['DEVELOPER'],
      ssoAuthenticated: true,
    };
    const seniorPrincipal = {
      subjectId: 'senior-1',
      email: 'senior1@synthos.dev',
      tenantId: 'default',
      roles: ['SENIOR_ENGINEER'],
      ssoAuthenticated: true,
    };
    const directorPrincipal = {
      subjectId: 'dir-1',
      email: 'director1@synthos.dev',
      tenantId: 'default',
      roles: ['RELEASE_DIRECTOR'],
      ssoAuthenticated: true,
    };

    const devCapsRes = await fetch(`http://localhost:${port}/api/capabilities`, {
      headers: { 'x-fable-principal': JSON.stringify(devPrincipal) },
    });
    expect(devCapsRes.status).toBe(200);
    const devCaps = await devCapsRes.json() as {
      capabilities: { canApproveBlueprints: boolean; canPromoteProduction: boolean };
    };
    expect(devCaps.capabilities.canApproveBlueprints).toBe(false);
    expect(devCaps.capabilities.canPromoteProduction).toBe(false);

    const dirCapsRes = await fetch(`http://localhost:${port}/api/capabilities`, {
      headers: { 'x-fable-principal': JSON.stringify(directorPrincipal) },
    });
    expect(dirCapsRes.status).toBe(200);
    const dirCaps = await dirCapsRes.json() as {
      capabilities: { canApproveBlueprints: boolean; canPromoteProduction: boolean };
    };
    expect(dirCaps.capabilities.canApproveBlueprints).toBe(true);
    expect(dirCaps.capabilities.canPromoteProduction).toBe(true);

    const rbacBlueprint: DAGBlueprint = {
      blueprintId: 'bp-rbac-01',
      goalId: 'goal-rbac',
      version: '1.0.0',
      title: 'RBAC Enforcement Flow',
      description: 'Phase 40 OPA HTTP check',
      status: 'DRAFT',
      author: 'dev-other',
      createdAt: new Date().toISOString(),
      nodes: [
        {
          nodeId: 'node-rbac',
          contractId: 'contract-rbac',
          contractVersion: '1.0.0',
          dependencies: [],
          allowBranchFailure: false,
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 1, initialIntervalMs: 100, backoffCoefficient: 1, maximumIntervalMs: 100 },
        },
      ],
    };
    const rbacHandler: NodeExecutionHandler = {
      executeNode: async (_wfId, nodeId, cId, cVer) => [
        {
          verdictId: `v-${nodeId}`,
          workflowId: 'wf-rbac-200',
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
    const rbacEngine = new DAGEngine('wf-rbac-200', rbacBlueprint, rbacHandler);
    store.registerWorkflow(rbacEngine);

    const deniedApprove = await fetch(`http://localhost:${port}/api/workflows/wf-rbac-200/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-fable-principal': JSON.stringify(devPrincipal),
      },
      body: JSON.stringify({ approvedBy: devPrincipal.email }),
    });
    expect(deniedApprove.status).toBe(403);
    const deniedApproveJson = await deniedApprove.json() as { error: string; reasons: string[] };
    expect(deniedApproveJson.error).toBe('Forbidden');
    expect(deniedApproveJson.reasons.length).toBeGreaterThan(0);

    const allowedApprove = await fetch(`http://localhost:${port}/api/workflows/wf-rbac-200/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-fable-principal': JSON.stringify(seniorPrincipal),
      },
      body: JSON.stringify({ approvedBy: seniorPrincipal.email }),
    });
    expect(allowedApprove.status).toBe(200);
    await rbacEngine.runUntilDone();

    const deniedPromoteDev = await fetch(`http://localhost:${port}/api/workflows/wf-rbac-200/promote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-fable-principal': JSON.stringify(devPrincipal),
      },
      body: JSON.stringify({ approvedBy: devPrincipal.email, authorId: 'dev-other', targetEnvironment: 'PRODUCTION' }),
    });
    expect(deniedPromoteDev.status).toBe(403);

    const selfPromoteDenied = await fetch(`http://localhost:${port}/api/workflows/wf-rbac-200/promote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-fable-principal': JSON.stringify(directorPrincipal),
      },
      body: JSON.stringify({ approvedBy: directorPrincipal.email, authorId: 'dir-1', targetEnvironment: 'PRODUCTION' }),
    });
    expect(selfPromoteDenied.status).toBe(403);

    const allowedPromote = await fetch(`http://localhost:${port}/api/workflows/wf-rbac-200/promote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-fable-principal': JSON.stringify(directorPrincipal),
      },
      body: JSON.stringify({ approvedBy: directorPrincipal.email, authorId: 'dev-other', targetEnvironment: 'PRODUCTION' }),
    });
    expect(allowedPromote.status).toBe(200);
    const promoted = await allowedPromote.json() as { workflow: { releasePromoted: boolean } };
    expect(promoted.workflow.releasePromoted).toBe(true);
  });
});
