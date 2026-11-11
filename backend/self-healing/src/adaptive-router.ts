import type { ModuleContract } from '@fable/contracts';
import { ModelGateway, type ModelFamily } from '@fable/llm-gateway';

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AdaptiveRoutingDecision {
  contractId: string;
  riskScore: number;
  riskTier: RiskTier;
  primaryFamily: ModelFamily;
  primaryModelName: string;
  metaReviewerFamily: ModelFamily;
  estimatedCostPer1kTokensUsd: number;
}

const ROUTING_TABLE: Record<
  RiskTier,
  { family: ModelFamily; modelName: string; metaFamily: ModelFamily; costPer1k: number }
> = {
  LOW: {
    family: 'gemini',
    modelName: 'gemini-1.5-flash',
    metaFamily: 'openai',
    costPer1k: 0.00015,
  },
  MEDIUM: {
    family: 'openai',
    modelName: 'gpt-4o',
    metaFamily: 'gemini',
    costPer1k: 0.005,
  },
  HIGH: {
    family: 'claude',
    modelName: 'claude-3-5-sonnet-20241022',
    metaFamily: 'gemini',
    costPer1k: 0.015,
  },
};

/**
 * Phase 23: Cost-Aware Adaptive Multi-Model Router.
 * Computes risk scores from contract properties and selects optimal cost/capability models
 * while strictly guaranteeing Tier 1 Architect/Meta-Reviewer independence.
 */
export class AdaptiveModelRouter {
  public static routeContract(contract: ModuleContract): AdaptiveRoutingDecision {
    const riskScore = this.computeRiskScore(contract);
    const riskTier: RiskTier = riskScore >= 70 ? 'HIGH' : (riskScore >= 40 ? 'MEDIUM' : 'LOW');
    const selected = ROUTING_TABLE[riskTier];

    // Enforce RFC Section 2 family independence invariant
    ModelGateway.validateIndependence(selected.family, selected.metaFamily);

    return {
      contractId: contract.id,
      riskScore,
      riskTier,
      primaryFamily: selected.family,
      primaryModelName: selected.modelName,
      metaReviewerFamily: selected.metaFamily,
      estimatedCostPer1kTokensUsd: selected.costPer1k,
    };
  }

  private static computeRiskScore(contract: ModuleContract): number {
    let score = 20;
    if (contract.stateHooks) score += 40;
    if (contract.requiredGates.includes('L3')) score += 25;
    if (contract.dependencies.length >= 2) score += 15;
    if (/auth|pay|ledger|secret|crypto/i.test(contract.name)) score += 30;
    return Math.min(100, score);
  }
}
