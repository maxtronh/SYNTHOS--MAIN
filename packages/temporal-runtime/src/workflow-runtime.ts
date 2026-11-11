import type { DAGBlueprint, ModuleContract } from '@fable/contracts';
import { GateRunner } from '@fable/gate-runner';
import {
  DAGEngine,
  type ApproveBlueprintInput,
  type NodeExecutionHandler,
  type PromoteReleaseInput,
  type WorkflowProgressState,
} from '@fable/orchestrator-temporal';
import type { IPersistenceStore } from '@fable/persistence-postgres';
import { ActivityHeartbeatManager } from '@fable/worker-bridge';
import type { WorkflowHistoryEvent } from './types.js';

export class TemporalRuntimeController {
  private readonly store: IPersistenceStore;
  private readonly heartbeats: ActivityHeartbeatManager;
  private readonly contracts: Map<string, ModuleContract>;
  private readonly histories = new Map<string, WorkflowHistoryEvent[]>();

  constructor(options: {
    store: IPersistenceStore;
    contracts: Map<string, ModuleContract>;
    heartbeatManager?: ActivityHeartbeatManager;
  }) {
    this.store = options.store;
    this.contracts = options.contracts;
    this.heartbeats = options.heartbeatManager ?? new ActivityHeartbeatManager();
  }

  /**
   * Starts a durable workflow, saves initial state to Postgres, and records history.
   */
  public async startWorkflow(workflowId: string, blueprint: DAGBlueprint): Promise<WorkflowProgressState> {
    const handler = this.createActivityHandler(workflowId);
    const engine = new DAGEngine(workflowId, blueprint, handler);

    const history: WorkflowHistoryEvent[] = [
      {
        type: 'WORKFLOW_INITIALIZED',
        workflowId,
        blueprint,
        timestamp: new Date().toISOString(),
      },
    ];
    this.histories.set(workflowId, history);

    const state = engine.getState() as WorkflowProgressState;
    await this.persistEngineState(state);
    return state;
  }

  /**
   * Sends human approval signal, executes the DAG, and persists all verdicts & audit logs.
   */
  public async signalApproveAndExecute(
    workflowId: string,
    blueprint: DAGBlueprint,
    input: ApproveBlueprintInput
  ): Promise<WorkflowProgressState> {
    const existingState = await this.store.getWorkflow(workflowId);
    if (!existingState) {
      throw new Error(`Cannot approve: workflow '${workflowId}' does not exist in persistence store.`);
    }

    const handler = this.createActivityHandler(workflowId);
    const engine = new DAGEngine(workflowId, blueprint, handler, existingState);

    engine.approveBlueprint(input);
    this.appendHistory(workflowId, { type: 'SIGNAL_APPROVED', input });

    const finalState = await engine.runUntilDone();
    await this.persistEngineState(finalState);
    return finalState;
  }

  /**
   * Sends explicit release promotion signal and persists state.
   */
  public async signalPromoteRelease(
    workflowId: string,
    blueprint: DAGBlueprint,
    input: PromoteReleaseInput
  ): Promise<WorkflowProgressState> {
    const existingState = await this.store.getWorkflow(workflowId);
    if (!existingState) {
      throw new Error(`Cannot promote: workflow '${workflowId}' not found.`);
    }

    const engine = new DAGEngine(workflowId, blueprint, this.createActivityHandler(workflowId), existingState);
    engine.promoteRelease(input);
    this.appendHistory(workflowId, { type: 'SIGNAL_PROMOTED', input });

    const updatedState = engine.getState() as WorkflowProgressState;
    await this.persistEngineState(updatedState);
    return updatedState;
  }

  /**
   * Recovers an interrupted workflow cleanly from durable PostgreSQL snapshot after worker restart.
   */
  public async recoverAfterWorkerRestart(
    workflowId: string,
    blueprint: DAGBlueprint
  ): Promise<WorkflowProgressState> {
    const snapshot = await this.store.getWorkflow(workflowId);
    if (!snapshot) {
      throw new Error(`Recovery failed: no durable snapshot found for workflow '${workflowId}'.`);
    }

    const engine = new DAGEngine(workflowId, blueprint, this.createActivityHandler(workflowId), snapshot);
    if (engine.getState().status === 'RUNNING') {
      const resumedState = await engine.runUntilDone();
      await this.persistEngineState(resumedState);
      return resumedState;
    }

    return engine.getState() as WorkflowProgressState;
  }

  public getRecordedHistory(workflowId: string): WorkflowHistoryEvent[] {
    return [...(this.histories.get(workflowId) ?? [])];
  }

  private createActivityHandler(workflowId: string): NodeExecutionHandler {
    return {
      executeNode: async (_wfId, nodeId, contractId, contractVersion) => {
        const contract = this.contracts.get(contractId);
        if (!contract) {
          throw new Error(`Missing contract '${contractId}' for node '${nodeId}'.`);
        }

        const activityId = `${workflowId}:${nodeId}`;
        this.heartbeats.registerActivity(activityId, workflowId, contract.executionBudgetMs);

        try {
          const verdicts = await GateRunner.executeModuleVerification({
            workflowId,
            nodeId,
            contract: { ...contract, version: contractVersion },
          });

          this.heartbeats.recordHeartbeat(activityId);
          this.appendHistory(workflowId, {
            type: 'ACTIVITY_COMPLETED',
            nodeId,
            verdicts,
          });

          for (const verdict of verdicts) {
            await this.store.saveVerdict(verdict);
          }

          return verdicts;
        } finally {
          this.heartbeats.unregisterActivity(activityId);
        }
      },
    };
  }

  private async persistEngineState(state: WorkflowProgressState): Promise<void> {
    await this.store.saveWorkflow(state);
    for (const evt of state.auditLog) {
      await this.store.appendAuditEvent(evt);
    }
  }

  private appendHistory(workflowId: string, event: WorkflowHistoryEvent): void {
    const list = this.histories.get(workflowId) ?? [];
    list.push(event);
    this.histories.set(workflowId, list);
  }
}
