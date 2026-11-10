export type PersonaStatus = 'ACTIVE' | 'DOWN_SAMPLED' | 'RETIRED';

export interface PersonaPrecisionRecord {
  personaId: string;
  cohortId: string;
  totalProposedTests: number;
  verifiedCatchingBugs: number;
  precisionRatio: number;
  status: PersonaStatus;
  adjudicationEvidence: string;
  evaluatedAt: string;
}

export interface ProductionEscapeRecord {
  escapeId: string;
  description: string;
  personaInvolved: string;
  batchId: string;
  hadOpportunityToDetect: boolean;
  wasReasonablyCatchable: boolean;
  adjudicatedBy: string;
  timestamp: string;
}

export interface PersonaRecallBatch {
  personaId: string;
  batchId: string;
  totalCatchableEscapes: number;
  detectedCount: number;
  recallRatio: number;
  timestamp: string;
}

export interface ModuleExecutionCostRecord {
  workflowId: string;
  moduleId: string;
  llmCostUsd: number;
  computeCostUsd: number;
  totalCostUsd: number;
  pipelineLatencyMs: number;
  blastRadiusResolutionMs?: number | undefined;
  recordedAt: string;
}
