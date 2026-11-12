import type { DecisionMemo } from '@fable/contracts';
import type { DAGEngine, WorkflowProgressState } from '@fable/orchestrator-temporal';
import {
  PrecisionLedger,
  RecallLedger,
  OperationalMetricsTracker,
} from '@fable/ledger-telemetry';

export class DashboardStateStore {
  private workflows = new Map<string, DAGEngine>();
  private memos: DecisionMemo[] = [];
  public readonly precisionLedger: PrecisionLedger;
  public readonly recallLedger: RecallLedger;
  public readonly metricsTracker: OperationalMetricsTracker;

  constructor(options?: {
    precisionLedger?: PrecisionLedger;
    recallLedger?: RecallLedger;
    metricsTracker?: OperationalMetricsTracker;
  }) {
    this.precisionLedger = options?.precisionLedger ?? new PrecisionLedger();
    this.recallLedger = options?.recallLedger ?? new RecallLedger();
    this.metricsTracker = options?.metricsTracker ?? new OperationalMetricsTracker();
  }

  public registerWorkflow(engine: DAGEngine): void {
    const id = engine.getState().workflowId;
    this.workflows.set(id, engine);
  }

  public getWorkflow(workflowId: string): DAGEngine | undefined {
    return this.workflows.get(workflowId);
  }

  public getWorkflowAuthor(workflowId: string): string | undefined {
    return this.workflows.get(workflowId)?.getBlueprint().author;
  }

  public listWorkflowStates(): WorkflowProgressState[] {
    return Array.from(this.workflows.values()).map(w => w.getState() as WorkflowProgressState);
  }

  public addDecisionMemo(memo: DecisionMemo): void {
    this.memos.push(memo);
  }

  public listDecisionMemos(): DecisionMemo[] {
    return [...this.memos];
  }

  public approveWorkflow(workflowId: string, approvedBy: string): WorkflowProgressState {
    const engine = this.workflows.get(workflowId);
    if (!engine) {
      throw new Error(`Workflow '${workflowId}' not found.`);
    }
    engine.approveBlueprint({ approvedBy });
    return engine.getState() as WorkflowProgressState;
  }

  public promoteWorkflowRelease(
    workflowId: string,
    approvedBy: string,
    targetEnvironment: 'PRODUCTION' | 'STAGING' = 'PRODUCTION'
  ): WorkflowProgressState {
    const engine = this.workflows.get(workflowId);
    if (!engine) {
      throw new Error(`Workflow '${workflowId}' not found.`);
    }
    engine.promoteRelease({ approvedBy, targetEnvironment });
    return engine.getState() as WorkflowProgressState;
  }
}
