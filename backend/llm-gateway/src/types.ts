export type ModelFamily = 'gemini' | 'claude' | 'openai';

export type PersonaType =
  | 'SECURITY_FUZZER'
  | 'DATA_INTEGRITY'
  | 'CONCURRENCY_RACER'
  | 'EDGE_CHAOS';

export interface ModelConfig {
  family: ModelFamily;
  modelName: string;
  temperature: number;
  maxTokens: number;
}

export interface AdvisoryProposal {
  proposalId: string;
  persona: PersonaType;
  family: ModelFamily;
  modelName: string;
  threatCategory: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
  proposedTestCode: string;
  tokensUsed: number;
  createdAt: string;
}

export interface ModelCompletionResult {
  content: string;
  tokensUsed: number;
  family: ModelFamily;
  modelName: string;
}
