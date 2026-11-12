import crypto from 'crypto';
import type { DAGBlueprint, DecisionMemo } from '@fable/contracts';
import type { WorkflowProgressState } from '@fable/orchestrator-temporal';
import type { DriftReport } from '@fable/scip-graph';
import type { CheckRunConclusion, GitHubCheckRunOutput, PullRequestEventPayload } from './types.js';

const STATUS_TO_CONCLUSION: Record<WorkflowProgressState['status'], CheckRunConclusion> = {
  COMPLETED: 'success',
  FAILED: 'failure',
  CANCELLED: 'failure',
  PENDING_APPROVAL: 'action_required',
  STALE_PAUSED: 'action_required',
  RUNNING: 'action_required',
};

/**
 * Bidirectional GitHub/GitLab PR Bot verifying webhook signatures and rendering
 * live Mermaid DAG summaries and Decision Memo escalations onto Pull Requests.
 */
export class GitOpsPullRequestBot {
  /**
   * Verifies `X-Hub-Signature-256` using constant-time HMAC-SHA256 comparison.
   */
  public static verifyWebhookSignature(
    rawPayload: string,
    signatureHeader: string,
    webhookSecret: string
  ): boolean {
    if (!signatureHeader.startsWith('sha256=')) return false;

    const expectedHex = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawPayload, 'utf8')
      .digest('hex');
    const providedHex = signatureHeader.slice('sha256='.length);

    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const providedBuf = Buffer.from(providedHex, 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;

    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  public static shouldTriggerVerification(event: PullRequestEventPayload): boolean {
    return event.action === 'opened' || event.action === 'synchronize' || event.action === 'reopened';
  }

  /**
   * Formats a GitHub Check Run conclusion and Markdown + Mermaid comment from workflow state.
   */
  public static buildCheckRunReport(
    headSha: string,
    blueprint: DAGBlueprint,
    state: WorkflowProgressState,
    memos: DecisionMemo[] = []
  ): GitHubCheckRunOutput {
    const conclusion = STATUS_TO_CONCLUSION[state.status];
    const mermaidDag = this.renderMermaidDag(blueprint, state);

    const nodeLines = Object.values(state.nodeStates)
      .map(n => `- **${n.nodeId}** (\`${n.contractId}@${n.contractVersion}\`): \`${n.state}\``)
      .join('\n');

    const memoSection = memos.length > 0
      ? `\n### Escalated Decision Memos\n${memos.map(m => `- **${m.memoId}** (Assigned: \`${m.assignedTo}\`): ${m.consolidatedErrorLogs}`).join('\n')}\n`
      : '';

    const summaryMarkdown = [
      `## Fable Engine v3 — Verification Report`,
      `**Workflow:** \`${state.workflowId}\` | **Status:** \`${state.status}\` | **Release Promoted:** \`${state.releasePromoted}\``,
      ``,
      `### DAG Nodes`,
      nodeLines,
      memoSection,
      `\`\`\`mermaid`,
      mermaidDag,
      `\`\`\``,
    ].join('\n');

    return {
      name: 'Fable Engine v3 Deterministic Verification',
      headSha,
      conclusion,
      summaryMarkdown,
      mermaidDag,
    };
  }

  /**
   * Formats a cross-repo SCIP drift pre-alert as a GitHub Check Run report (Phase 35).
   */
  public static buildDriftPreAlertCheckRun(
    headSha: string,
    report: DriftReport
  ): GitHubCheckRunOutput {
    const conclusion: CheckRunConclusion = report.hasBreakingDrift
      ? 'failure'
      : (report.findings.length > 0 ? 'action_required' : 'success');

    const findingsList = report.findings.length === 0
      ? '- No cross-repo contract or SCIP symbol drift detected.'
      : report.findings
          .map(f => `- **[${f.severity}]** \`${f.category}\` — ${f.detail}`)
          .join('\n');

    const mermaidLines = ['flowchart LR'];
    for (const unit of report.impactedTransitiveUnits) {
      mermaidLines.push(`  Drift["Breaking Drift"] --> ${unit.replace(/[^a-zA-Z0-9_]/g, '_')}["${unit}"]`);
    }
    const mermaidDag = mermaidLines.join('\n');

    const summaryMarkdown = [
      `## Fable Engine v3 — Cross-Repo SCIP Drift Report`,
      `**Breaking Drift:** \`${report.hasBreakingDrift}\` | **Findings:** \`${report.findings.length}\``,
      ``,
      `### Findings`,
      findingsList,
      ``,
      `### Impacted Transitive Units`,
      report.impactedTransitiveUnits.map(u => `- \`${u}\``).join('\n') || '- None',
    ].join('\n');

    return {
      name: 'Fable Engine v3 Cross-Repo Drift Pre-Alert',
      headSha,
      conclusion,
      summaryMarkdown,
      mermaidDag,
    };
  }

  private static renderMermaidDag(blueprint: DAGBlueprint, state: WorkflowProgressState): string {
    const lines = ['flowchart TD'];

    for (const node of blueprint.nodes) {
      const nodeState = state.nodeStates[node.nodeId]?.state ?? 'UNKNOWN';
      lines.push(`  ${node.nodeId}["${node.nodeId} (${nodeState})"]`);
      for (const dep of node.dependencies) {
        lines.push(`  ${dep} --> ${node.nodeId}`);
      }
    }

    return lines.join('\n');
  }
}
