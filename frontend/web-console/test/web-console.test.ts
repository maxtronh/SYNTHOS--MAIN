import { describe, it, expect, vi } from 'vitest';
import type { WorkflowProgressState } from '@fable/orchestrator-temporal';
import type { OperatorPrincipal } from '@fable/governance-opa';
import { ControlPlaneApiClient, ConsoleRoleViewController } from '../src/index.js';

describe('Frontend Web Console API Client Suite', () => {
  it('calls workflows, approve, promote, and telemetry endpoints cleanly', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/workflows')) {
        return new Response(JSON.stringify({ workflows: [{ workflowId: 'wf-ui-1', status: 'PENDING_APPROVAL' }] }), {
          status: 200,
        });
      }
      if (url.endsWith('/approve')) {
        return new Response(JSON.stringify({ workflow: { workflowId: 'wf-ui-1', status: 'RUNNING' } }), {
          status: 200,
        });
      }
      if (url.endsWith('/api/telemetry')) {
        return new Response(
          JSON.stringify({ costs: { avgTotalCost: 0.04, avgLlmCost: 0.03, avgComputeCost: 0.01 }, latency: { count: 1, p50: 100, p95: 100, min: 100, max: 100 } }),
          { status: 200 }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new ControlPlaneApiClient('http://localhost:3000/');
    const workflows = await client.listWorkflows();
    expect(workflows[0]?.workflowId).toBe('wf-ui-1');

    const approved = await client.approveWorkflow('wf-ui-1', 'lead@acme.dev');
    expect(approved.status).toBe('RUNNING');

    const telemetry = await client.getTelemetry();
    expect(telemetry.costs.avgTotalCost).toBe(0.04);

    vi.unstubAllGlobals();
  });

  it('Phase 40: scopes console tabs, queues, and action capabilities per SSO role', () => {
    const wfPending: WorkflowProgressState = {
      workflowId: 'wf-p1',
      goalId: 'g1',
      blueprintId: 'bp1',
      status: 'PENDING_APPROVAL',
      createdAt: new Date().toISOString(),
      sla24hAlertTriggered: false,
      sla48hStalePaused: false,
      nodeStates: {},
      auditLog: [],
      releasePromoted: false,
    };
    const wfCompleted: WorkflowProgressState = {
      ...wfPending,
      workflowId: 'wf-c1',
      status: 'COMPLETED',
    };

    const dev: OperatorPrincipal = {
      subjectId: 'u-dev',
      email: 'dev@synthos.dev',
      tenantId: 't-main',
      roles: ['DEVELOPER'],
      ssoAuthenticated: true,
    };
    const devView = ConsoleRoleViewController.buildRoleView(dev, 't-main', [wfPending, wfCompleted], []);
    expect(devView.availableTabs).toEqual(['ALL_WORKFLOWS']);
    expect(devView.capabilities.canApproveBlueprints).toBe(false);
    expect(devView.capabilities.canPromoteProduction).toBe(false);

    const secLead: OperatorPrincipal = {
      ...dev,
      subjectId: 'u-sec',
      roles: ['SECURITY_LEAD'],
    };
    const secView = ConsoleRoleViewController.buildRoleView(secLead, 't-main', [wfPending, wfCompleted], []);
    expect(secView.defaultTab).toBe('THREAT_OVERRIDES');
    expect(secView.capabilities.canOverrideCriticalThreats).toBe(true);
    expect(secView.capabilities.canPromoteProduction).toBe(false);

    const director: OperatorPrincipal = {
      ...dev,
      subjectId: 'u-dir',
      roles: ['RELEASE_DIRECTOR'],
    };
    const dirView = ConsoleRoleViewController.buildRoleView(director, 't-main', [wfPending, wfCompleted], []);
    expect(dirView.defaultTab).toBe('RELEASE_PROMOTION_QUEUE');
    expect(dirView.capabilities.canApproveBlueprints).toBe(true);
    expect(dirView.capabilities.canPromoteProduction).toBe(true);
    expect(dirView.approvalQueue.map(w => w.workflowId)).toEqual(['wf-p1']);
    expect(dirView.releasePromotionQueue.map(w => w.workflowId)).toEqual(['wf-c1']);
  });
});
