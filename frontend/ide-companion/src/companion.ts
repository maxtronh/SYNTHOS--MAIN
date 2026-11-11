import type { ModuleContract, GateVerdict } from '@fable/contracts';
import { GateRunner } from '@fable/gate-runner';
import type { ScipSemanticGraph } from '@fable/scip-graph';

export interface IdeInlineHint {
  contractId: string;
  sandboxRoute: 'PATH_A_EPHEMERAL' | 'PATH_B_STATEFUL';
  badgeLabel: string;
  requiredGates: string[];
}

export interface BlastRadiusHeatmap {
  symbolId: string;
  impactedCount: number;
  impactedPackages: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

/**
 * Phase 29: IDE Companion Backend Provider (VS Code / Antigravity Extension).
 * Supplies inline contract hints, SCIP blast-radius hover heatmaps, and 1-click local L0/L1a dry-runs.
 */
export class IdeCompanionProvider {
  public static getContractHint(contract: ModuleContract): IdeInlineHint {
    const sandboxRoute = contract.stateHooks ? 'PATH_B_STATEFUL' : 'PATH_A_EPHEMERAL';
    const badgeLabel = contract.stateHooks
      ? `[Fable Path B: Stateful Dry-Run] ${contract.name}@${contract.version}`
      : `[Fable Path A: Ephemeral Sandbox] ${contract.name}@${contract.version}`;

    return {
      contractId: contract.id,
      sandboxRoute,
      badgeLabel,
      requiredGates: contract.requiredGates,
    };
  }

  public static getBlastRadiusHeatmap(
    symbolId: string,
    scipGraph: ScipSemanticGraph
  ): BlastRadiusHeatmap {
    const impactedPackages = scipGraph.findImpactedPackagesForSymbol(symbolId);
    const count = impactedPackages.length;
    const severity: BlastRadiusHeatmap['severity'] =
      count >= 5 ? 'HIGH' : (count >= 2 ? 'MEDIUM' : 'LOW');

    return {
      symbolId,
      impactedCount: count,
      impactedPackages,
      severity,
    };
  }

  public static async runLocalDryRun(contract: ModuleContract): Promise<GateVerdict[]> {
    return GateRunner.executeModuleVerification({
      workflowId: `local-ide-dryrun-${Date.now()}`,
      nodeId: `ide-${contract.name}`,
      contract,
    });
  }
}
