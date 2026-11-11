import type { DecisionMemo } from '@fable/contracts';
import type { WorkflowProgressState } from '@fable/orchestrator-temporal';

export interface TelemetrySummaryResponse {
  costs: {
    avgLlmCost: number;
    avgComputeCost: number;
    avgTotalCost: number;
  };
  latency: {
    count: number;
    p50: number;
    p95: number;
    min: number;
    max: number;
  };
}

/**
 * Frontend Client SDK communicating with the Fable Engine v3 Operator Control Plane API.
 */
export class ControlPlaneApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public async listWorkflows(): Promise<WorkflowProgressState[]> {
    const data = await this.requestJson<{ workflows: WorkflowProgressState[] }>('/api/workflows');
    return data.workflows;
  }

  public async listDecisionMemos(): Promise<DecisionMemo[]> {
    const data = await this.requestJson<{ memos: DecisionMemo[] }>('/api/memos');
    return data.memos;
  }

  public async getTelemetry(): Promise<TelemetrySummaryResponse> {
    return this.requestJson<TelemetrySummaryResponse>('/api/telemetry');
  }

  public async approveWorkflow(workflowId: string, approvedBy: string): Promise<WorkflowProgressState> {
    const data = await this.requestJson<{ workflow: WorkflowProgressState }>(
      `/api/workflows/${encodeURIComponent(workflowId)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ approvedBy }),
      }
    );
    return data.workflow;
  }

  public async promoteRelease(
    workflowId: string,
    approvedBy: string,
    targetEnvironment: 'PRODUCTION' | 'STAGING' = 'PRODUCTION'
  ): Promise<WorkflowProgressState> {
    const data = await this.requestJson<{ workflow: WorkflowProgressState }>(
      `/api/workflows/${encodeURIComponent(workflowId)}/promote`,
      {
        method: 'POST',
        body: JSON.stringify({ approvedBy, targetEnvironment }),
      }
    );
    return data.workflow;
  }

  private async requestJson<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`Control Plane API error (${res.status}): ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }
}
