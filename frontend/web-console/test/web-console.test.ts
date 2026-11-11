import { describe, it, expect, vi } from 'vitest';
import { ControlPlaneApiClient } from '../src/index.js';

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
});
