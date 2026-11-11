export interface PullRequestEventPayload {
  action: 'opened' | 'synchronize' | 'reopened' | 'closed';
  repository: string;
  prNumber: number;
  headSha: string;
  author: string;
  changedFiles: string[];
}

export type CheckRunConclusion = 'success' | 'failure' | 'action_required';

export interface GitHubCheckRunOutput {
  name: string;
  headSha: string;
  conclusion: CheckRunConclusion;
  summaryMarkdown: string;
  mermaidDag: string;
}
