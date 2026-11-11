import type {
  DAGBlueprint,
  GateVerdict,
  AuditTrailEvent,
} from '@fable/contracts';
import type {
  WorkflowProgressState,
  NodeStatusInfo,
  NodeExecutionHandler,
  ApproveBlueprintInput,
  RejectBlueprintInput,
  PromoteReleaseInput,
} from './types.js';

export class DAGEngine {
  private state: WorkflowProgressState;
  private blueprint: DAGBlueprint;
  private handler: NodeExecutionHandler;

  constructor(
    workflowId: string,
    blueprint: DAGBlueprint,
    handler: NodeExecutionHandler,
    initialState?: WorkflowProgressState
  ) {
    this.blueprint = blueprint;
    this.handler = handler;

    if (initialState) {
      this.state = initialState;
    } else {
      const nodeStates: Record<string, NodeStatusInfo> = {};
      for (const node of blueprint.nodes) {
        nodeStates[node.nodeId] = {
          nodeId: node.nodeId,
          contractId: node.contractId,
          contractVersion: node.contractVersion,
          state: 'WAITING_DEPENDENCIES',
          attempts: 0,
          verdicts: [],
        };
      }

      this.state = {
        workflowId,
        goalId: blueprint.goalId,
        blueprintId: blueprint.blueprintId,
        status: 'PENDING_APPROVAL',
        createdAt: new Date().toISOString(),
        approvalRequestedAt: new Date().toISOString(),
        sla24hAlertTriggered: false,
        sla48hStalePaused: false,
        nodeStates,
        auditLog: [],
        releasePromoted: false,
      };

      this.recordAudit('DAG_APPROVAL_REQUESTED', {
        blueprintId: blueprint.blueprintId,
        nodeCount: blueprint.nodes.length,
      });
    }
  }

  public getState(): Readonly<WorkflowProgressState> {
    return this.state;
  }

  /**
   * Signal: Human approves blueprint
   */
  public approveBlueprint(input: ApproveBlueprintInput): void {
    if (this.state.status !== 'PENDING_APPROVAL' && this.state.status !== 'STALE_PAUSED') {
      throw new Error(`Cannot approve blueprint in status '${this.state.status}'.`);
    }

    this.state.status = 'RUNNING';
    this.state.approvedBy = input.approvedBy;
    this.state.approvedAt = input.timestamp ?? new Date().toISOString();
    this.state.sla48hStalePaused = false;

    this.recordAudit('DAG_APPROVAL_GRANTED', {
      approvedBy: input.approvedBy,
      approvedAt: this.state.approvedAt,
    });
  }

  /**
   * Signal: Human rejects blueprint
   */
  public rejectBlueprint(input: RejectBlueprintInput): void {
    if (this.state.status !== 'PENDING_APPROVAL' && this.state.status !== 'STALE_PAUSED') {
      throw new Error(`Cannot reject blueprint in status '${this.state.status}'.`);
    }

    this.state.status = 'FAILED';
    this.recordAudit('DAG_APPROVAL_STALE_PAUSED', {
      rejectedBy: input.rejectedBy,
      reason: input.reason,
    });
  }

  /**
   * Check and apply Human Gate SLAs (24h alert, 48h stale pause)
   */
  public checkApprovalSLAs(currentTimeMs: number): void {
    if (this.state.status !== 'PENDING_APPROVAL') return;

    const requestTimeMs = new Date(this.state.approvalRequestedAt!).getTime();
    const elapsedMs = currentTimeMs - requestTimeMs;

    const HOURS_24_MS = 24 * 60 * 60 * 1000;
    const HOURS_48_MS = 48 * 60 * 60 * 1000;

    if (elapsedMs >= HOURS_24_MS && !this.state.sla24hAlertTriggered) {
      this.state.sla24hAlertTriggered = true;
      this.recordAudit('DAG_APPROVAL_REQUESTED', {
        slaAlert: '24_HOUR_APPROVAL_THRESHOLD_BREACHED',
        elapsedHours: elapsedMs / (60 * 60 * 1000),
      });
    }

    if (elapsedMs >= HOURS_48_MS && !this.state.sla48hStalePaused) {
      this.state.sla48hStalePaused = true;
      this.state.status = 'STALE_PAUSED';
      this.recordAudit('DAG_APPROVAL_STALE_PAUSED', {
        slaAction: 'MARK_STALE_AND_PAUSE',
        elapsedHours: elapsedMs / (60 * 60 * 1000),
      });
    }
  }

  /**
   * Run the next executable wave of nodes in the DAG.
   * A node is executable if:
   * 1. Workflow is RUNNING
   * 2. Its state is WAITING_DEPENDENCIES
   * 3. Every declared dependency has status PASSED
   */
  public async executeNextStep(): Promise<boolean> {
    if (this.state.status !== 'RUNNING') {
      return false;
    }

    // Identify ready nodes
    const readyNodes = this.blueprint.nodes.filter(node => {
      const nodeState = this.state.nodeStates[node.nodeId];
      if (!nodeState || nodeState.state !== 'WAITING_DEPENDENCIES') {
        return false;
      }

      // Check all dependencies
      return node.dependencies.every(depId => {
        const depState = this.state.nodeStates[depId];
        return depState && depState.state === 'PASSED';
      });
    });

    if (readyNodes.length === 0) {
      this.evaluateWorkflowCompletion();
      return false;
    }

    // Execute ready nodes concurrently
    await Promise.all(readyNodes.map(node => this.runSingleNode(node.nodeId)));

    // Re-check workflow completion
    this.evaluateWorkflowCompletion();
    return true;
  }

  /**
   * Run all steps to completion or failure
   */
  public async runUntilDone(maxSteps: number = 100): Promise<WorkflowProgressState> {
    let steps = 0;
    while (this.state.status === 'RUNNING' && steps < maxSteps) {
      const executed = await this.executeNextStep();
      if (!executed) break;
      steps++;
    }
    return this.state;
  }

  /**
   * Signal: Release Promotion
   */
  public promoteRelease(input: PromoteReleaseInput): void {
    if (this.state.status !== 'COMPLETED') {
      throw new Error(`Cannot promote release: Workflow is in status '${this.state.status}'. Must be COMPLETED.`);
    }

    this.state.releasePromoted = true;
    this.recordAudit('RELEASE_PROMOTION_GRANTED', {
      approvedBy: input.approvedBy,
      targetEnvironment: input.targetEnvironment,
      releaseCandidateId: this.state.releaseCandidateId,
    });
  }

  /**
   * Check 48h Release Candidate Expiration SLA
   */
  public checkReleaseCandidateSLA(currentTimeMs: number): void {
    if (this.state.status !== 'COMPLETED' || this.state.releasePromoted || !this.state.releaseCandidateId) {
      return;
    }

    // Completed at time
    const completedNodeTimes = Object.values(this.state.nodeStates)
      .map(n => n.completedAt ? new Date(n.completedAt).getTime() : 0);
    const maxCompletedTime = Math.max(...completedNodeTimes);

    const HOURS_48_MS = 48 * 60 * 60 * 1000;
    if (currentTimeMs - maxCompletedTime >= HOURS_48_MS) {
      this.recordAudit('RELEASE_CANDIDATE_ARCHIVED', {
        reason: '48_HOUR_RELEASE_PROMOTION_TIMEOUT',
        releaseCandidateId: this.state.releaseCandidateId,
      });
    }
  }

  private async runSingleNode(nodeId: string): Promise<void> {
    const nodeConfig = this.blueprint.nodes.find(n => n.nodeId === nodeId)!;
    const nodeState = this.state.nodeStates[nodeId]!;

    nodeState.state = 'RUNNING';
    nodeState.startedAt = new Date().toISOString();

    this.recordAudit('NODE_STARTED', { nodeId });

    let attempts = 0;
    const maxAttempts = nodeConfig.retryPolicy?.maxAttempts ?? 1;
    let finalVerdicts: GateVerdict[];

    while (attempts < maxAttempts) {
      attempts++;
      nodeState.attempts = attempts;

      try {
        finalVerdicts = await this.handler.executeNode(
          this.state.workflowId,
          nodeId,
          nodeConfig.contractId,
          nodeConfig.contractVersion
        );

        nodeState.verdicts = finalVerdicts;

        // Check if all authoritative gates passed
        const failedGate = finalVerdicts.find(v => v.isAuthoritative && v.status === 'FAIL');
        const infraErrorGate = finalVerdicts.find(v => v.status === 'INFRA_ERROR' || v.status === 'TIMEOUT');

        if (failedGate) {
          // Deterministic failure: MUST NOT BE RETRIED
          nodeState.state = 'FAILED';
          nodeState.completedAt = new Date().toISOString();
          nodeState.error = `Deterministic gate failure on ${failedGate.gate}: ${failedGate.errorDetails.join(', ')}`;
          this.propagateDownstreamCancellation(nodeId, nodeConfig.allowBranchFailure);
          return;
        }

        if (infraErrorGate) {
          // Transient failure: eligible for bounded retry
          if (attempts < maxAttempts) {
            continue; // Retry
          } else {
            nodeState.state = 'FAILED';
            nodeState.completedAt = new Date().toISOString();
            nodeState.error = `Transient infrastructure error exceeded ${maxAttempts} attempts: ${infraErrorGate.status}`;
            this.propagateDownstreamCancellation(nodeId, nodeConfig.allowBranchFailure);
            return;
          }
        }

        // All gates passed or deferred
        nodeState.state = 'PASSED';
        nodeState.completedAt = new Date().toISOString();
        return;

      } catch (err) {
        // Unexpected execution exception
        if (attempts >= maxAttempts) {
          nodeState.state = 'FAILED';
          nodeState.completedAt = new Date().toISOString();
          nodeState.error = (err as Error).message;
          this.propagateDownstreamCancellation(nodeId, nodeConfig.allowBranchFailure);
          return;
        }
      }
    }
  }

  private propagateDownstreamCancellation(failedNodeId: string, allowBranchFailure: boolean): void {
    if (allowBranchFailure) {
      // Find downstream dependents and cancel them
      const findDownstream = (currentId: string, visited: Set<string>): void => {
        for (const node of this.blueprint.nodes) {
          if (node.dependencies.includes(currentId) && !visited.has(node.nodeId)) {
            visited.add(node.nodeId);
            const targetState = this.state.nodeStates[node.nodeId];
            if (targetState && targetState.state === 'WAITING_DEPENDENCIES') {
              targetState.state = 'CANCELLED';
              targetState.error = `Cancelled due to upstream failure of node '${failedNodeId}'.`;
              this.recordAudit('NODE_CANCELLED', {
                nodeId: node.nodeId,
                reason: `Upstream dependency '${failedNodeId}' failed`,
              });
            }
            findDownstream(node.nodeId, visited);
          }
        }
      };

      findDownstream(failedNodeId, new Set<string>());
    } else {
      // Pipeline failure: cancel all non-completed nodes and fail workflow
      for (const node of this.blueprint.nodes) {
        const targetState = this.state.nodeStates[node.nodeId];
        if (targetState && targetState.state === 'WAITING_DEPENDENCIES') {
          targetState.state = 'CANCELLED';
          targetState.error = `Workflow failed due to node '${failedNodeId}' failure.`;
        }
      }
      this.state.status = 'FAILED';
    }
  }

  private evaluateWorkflowCompletion(): void {
    const allStates = Object.values(this.state.nodeStates);

    const hasRunning = allStates.some(n => n.state === 'RUNNING');
    if (hasRunning) return;

    const anyFailed = allStates.some(n => n.state === 'FAILED');
    if (anyFailed && this.state.status !== 'FAILED') {
      this.state.status = 'FAILED';
      return;
    }

    const allPassed = allStates.every(n => n.state === 'PASSED');
    if (allPassed) {
      this.state.status = 'COMPLETED';
      this.state.releaseCandidateId = `rc-${this.state.workflowId}-${Date.now()}`;
      this.recordAudit('RELEASE_CANDIDATE_ASSEMBLED', {
        releaseCandidateId: this.state.releaseCandidateId,
        nodeCount: allStates.length,
      });
    }
  }

  private recordAudit(
    eventType: AuditTrailEvent['eventType'],
    payload: Record<string, unknown>
  ): void {
    const event: AuditTrailEvent = {
      eventId: `audit-${this.state.workflowId}-${this.state.auditLog.length + 1}`,
      correlationId: this.state.workflowId,
      goalId: this.state.goalId,
      workflowId: this.state.workflowId,
      eventType,
      actor: {
        type: 'TEMPORAL_WORKFLOW',
        id: 'temporal-orchestrator-tier0',
      },
      payload,
      timestamp: new Date().toISOString(),
    };
    this.state.auditLog.push(event);
  }
}
