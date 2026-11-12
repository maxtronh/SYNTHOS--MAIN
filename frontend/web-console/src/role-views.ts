import type { DecisionMemo } from '@fable/contracts';
import type { WorkflowProgressState } from '@fable/orchestrator-temporal';
import {
  OpaPolicyEvaluator,
  type OperatorPrincipal,
} from '@fable/governance-opa';

export type ConsoleTabId =
  | 'ALL_WORKFLOWS'
  | 'APPROVAL_QUEUE'
  | 'THREAT_OVERRIDES'
  | 'RELEASE_PROMOTION_QUEUE';

export interface RoleCapabilities {
  canApproveBlueprints: boolean;
  canOverrideCriticalThreats: boolean;
  canResolveMemos: boolean;
  canPromoteProduction: boolean;
}

export interface RoleScopedConsoleView {
  principal: OperatorPrincipal;
  capabilities: RoleCapabilities;
  availableTabs: ConsoleTabId[];
  defaultTab: ConsoleTabId;
  approvalQueue: WorkflowProgressState[];
  releasePromotionQueue: WorkflowProgressState[];
  unresolvedMemos: DecisionMemo[];
}

/**
 * Phase 40: Role-Based Operator Console View Controller.
 * Derives tab visibility, workflow queues, and interactive action permissions
 * directly from OPA RBAC & Separation-of-Duties rules.
 */
export class ConsoleRoleViewController {
  public static buildRoleView(
    principal: OperatorPrincipal,
    resourceTenantId: string,
    workflows: WorkflowProgressState[],
    memos: DecisionMemo[]
  ): RoleScopedConsoleView {
    const canApproveBlueprints = OpaPolicyEvaluator.evaluate({
      principal,
      action: 'APPROVE_BLUEPRINT',
      resourceTenantId,
    }).allowed;

    const canOverrideCriticalThreats = OpaPolicyEvaluator.evaluate({
      principal,
      action: 'OVERRIDE_CRITICAL_THREAT',
      resourceTenantId,
    }).allowed;

    const canResolveMemos = OpaPolicyEvaluator.evaluate({
      principal,
      action: 'RESOLVE_DECISION_MEMO',
      resourceTenantId,
    }).allowed;

    const canPromoteProduction = OpaPolicyEvaluator.evaluate({
      principal,
      action: 'PROMOTE_PRODUCTION',
      resourceTenantId,
    }).allowed;

    const availableTabs: ConsoleTabId[] = ['ALL_WORKFLOWS'];
    if (canApproveBlueprints) availableTabs.push('APPROVAL_QUEUE');
    if (canOverrideCriticalThreats) availableTabs.push('THREAT_OVERRIDES');
    if (canPromoteProduction) availableTabs.push('RELEASE_PROMOTION_QUEUE');

    const defaultTab: ConsoleTabId = canPromoteProduction
      ? 'RELEASE_PROMOTION_QUEUE'
      : (canOverrideCriticalThreats
          ? 'THREAT_OVERRIDES'
          : (canApproveBlueprints ? 'APPROVAL_QUEUE' : 'ALL_WORKFLOWS'));

    const approvalQueue = workflows.filter(
      w => w.status === 'PENDING_APPROVAL' || w.status === 'STALE_PAUSED'
    );

    const releasePromotionQueue = workflows.filter(
      w => w.status === 'COMPLETED' && !w.releasePromoted
    );

    const unresolvedMemos = memos.filter(
      m => m.status === 'PENDING_REVIEW' || m.status === 'IN_REVIEW'
    );

    return {
      principal,
      capabilities: {
        canApproveBlueprints,
        canOverrideCriticalThreats,
        canResolveMemos,
        canPromoteProduction,
      },
      availableTabs,
      defaultTab,
      approvalQueue,
      releasePromotionQueue,
      unresolvedMemos,
    };
  }
}
