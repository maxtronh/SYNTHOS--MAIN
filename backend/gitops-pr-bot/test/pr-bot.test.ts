import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import type { DAGBlueprint } from '@fable/contracts';
import type { WorkflowProgressState } from '@fable/orchestrator-temporal';
import { GitOpsPullRequestBot } from '../src/index.js';

describe('Phase 17: GitOps PR Bot Suite', () => {
  it('verifies X-Hub-Signature-256 HMAC signatures safely', () => {
    const secret = 'fable-webhook-secret';
    const payload = JSON.stringify({ action: 'opened', prNumber: 42 });
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

    expect(GitOpsPullRequestBot.verifyWebhookSignature(payload, sig, secret)).toBe(true);
    expect(GitOpsPullRequestBot.verifyWebhookSignature(payload, 'sha256=deadbeef', secret)).toBe(false);
    expect(GitOpsPullRequestBot.verifyWebhookSignature(payload, sig, 'wrong-secret')).toBe(false);
  });

  it('generates GitHub CheckRun conclusion and Mermaid DAG diagram from workflow state', () => {
    const blueprint: DAGBlueprint = {
      blueprintId: 'bp-pr',
      goalId: 'goal-pr',
      version: '1.0.0',
      title: 'PR Test',
      description: 'PR verification flow',
      status: 'APPROVED',
      author: 'dev',
      createdAt: new Date().toISOString(),
      nodes: [
        {
          nodeId: 'node-auth',
          contractId: 'c-auth',
          contractVersion: '1.0.0',
          dependencies: [],
          allowBranchFailure: false,
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 1, initialIntervalMs: 100, backoffCoefficient: 1, maximumIntervalMs: 100 },
        },
        {
          nodeId: 'node-billing',
          contractId: 'c-billing',
          contractVersion: '1.0.0',
          dependencies: ['node-auth'],
          allowBranchFailure: false,
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 1, initialIntervalMs: 100, backoffCoefficient: 1, maximumIntervalMs: 100 },
        },
      ],
    };

    const state: WorkflowProgressState = {
      workflowId: 'wf-pr-42',
      goalId: 'goal-pr',
      blueprintId: 'bp-pr',
      status: 'COMPLETED',
      createdAt: new Date().toISOString(),
      sla24hAlertTriggered: false,
      sla48hStalePaused: false,
      releasePromoted: false,
      auditLog: [],
      nodeStates: {
        'node-auth': { nodeId: 'node-auth', contractId: 'c-auth', contractVersion: '1.0.0', state: 'PASSED', attempts: 1, verdicts: [] },
        'node-billing': { nodeId: 'node-billing', contractId: 'c-billing', contractVersion: '1.0.0', state: 'PASSED', attempts: 1, verdicts: [] },
      },
    };

    const report = GitOpsPullRequestBot.buildCheckRunReport('abc1234', blueprint, state);
    expect(report.conclusion).toBe('success');
    expect(report.mermaidDag).toContain('node-auth --> node-billing');
    expect(report.summaryMarkdown).toContain('```mermaid');
  });
});
