import type {
  PersonaType,
  ModelFamily,
  AdvisoryProposal,
} from './types.js';
import { ModelGateway } from './model-gateway.js';
import type { BoundedPrompt } from '@fable/retrieval-pgvector';

export interface PersonaEvaluationContext {
  workflowId: string;
  nodeId: string;
  moduleName: string;
  boundedPrompt: BoundedPrompt;
}

export abstract class BaseAdvisoryPersona {
  public abstract readonly personaType: PersonaType;
  public abstract readonly defaultFamily: ModelFamily;
  public abstract readonly threatCategory: string;

  protected gateway: ModelGateway;

  constructor(gateway?: ModelGateway) {
    this.gateway = gateway ?? new ModelGateway();
  }

  public abstract proposeAdvisoryTest(
    context: PersonaEvaluationContext
  ): Promise<AdvisoryProposal>;
}

export class SecurityFuzzerPersona extends BaseAdvisoryPersona {
  public readonly personaType: PersonaType = 'SECURITY_FUZZER';
  public readonly defaultFamily: ModelFamily = 'gemini';
  public readonly threatCategory = 'INJECTION_AND_AUTH_BYPASS';

  public async proposeAdvisoryTest(
    context: PersonaEvaluationContext
  ): Promise<AdvisoryProposal> {
    const config = this.gateway.getModelConfig(this.defaultFamily);
    const testCode = `
// Adversarial Security Test by SecurityFuzzer (${this.defaultFamily}:${config.modelName})
describe('${context.moduleName} - Security Invariants', () => {
  it('rejects malicious payload injection and malformed auth tokens', async () => {
    const injectionPayload = { user: "admin' OR '1'='1", token: 'eyJhbGciOiJub25lIn0...' };
    await expect(handleRequest(injectionPayload)).rejects.toThrow();
  });
});
`.trim();

    return {
      proposalId: `prop-sec-${context.nodeId}-${Date.now()}`,
      persona: this.personaType,
      family: this.defaultFamily,
      modelName: config.modelName,
      threatCategory: this.threatCategory,
      severity: 'CRITICAL',
      rationale: 'Module handles user inputs that cross network boundaries without sanitization proof.',
      proposedTestCode: testCode,
      tokensUsed: 320,
      createdAt: new Date().toISOString(),
    };
  }
}

export class DataIntegrityPersona extends BaseAdvisoryPersona {
  public readonly personaType: PersonaType = 'DATA_INTEGRITY';
  public readonly defaultFamily: ModelFamily = 'claude';
  public readonly threatCategory = 'SCHEMA_DRIFT_AND_CONSTRAINTS';

  public async proposeAdvisoryTest(
    context: PersonaEvaluationContext
  ): Promise<AdvisoryProposal> {
    const config = this.gateway.getModelConfig(this.defaultFamily);
    const testCode = `
// Adversarial Data Integrity Test by DataIntegrity (${this.defaultFamily}:${config.modelName})
describe('${context.moduleName} - Constraint Integrity', () => {
  it('guarantees atomic rollback when foreign key constraint is violated', async () => {
    const orphanedRecord = { parentId: 'non-existent-uuid', value: 100 };
    await expect(dbTransaction(orphanedRecord)).rejects.toThrow();
  });
});
`.trim();

    return {
      proposalId: `prop-data-${context.nodeId}-${Date.now()}`,
      persona: this.personaType,
      family: this.defaultFamily,
      modelName: config.modelName,
      threatCategory: this.threatCategory,
      severity: 'HIGH',
      rationale: 'Stateful migration modifies foreign key relationships without atomic down-migration rollback.',
      proposedTestCode: testCode,
      tokensUsed: 280,
      createdAt: new Date().toISOString(),
    };
  }
}

export class ConcurrencyRacerPersona extends BaseAdvisoryPersona {
  public readonly personaType: PersonaType = 'CONCURRENCY_RACER';
  public readonly defaultFamily: ModelFamily = 'openai';
  public readonly threatCategory = 'RACE_CONDITIONS_AND_DEADLOCKS';

  public async proposeAdvisoryTest(
    context: PersonaEvaluationContext
  ): Promise<AdvisoryProposal> {
    const config = this.gateway.getModelConfig(this.defaultFamily);
    const testCode = `
// Adversarial Concurrency Test by ConcurrencyRacer (${this.defaultFamily}:${config.modelName})
describe('${context.moduleName} - Distributed Lock Contention', () => {
  it('prevents double-spend under 50 simultaneous concurrent requests', async () => {
    const promises = Array(50).fill(null).map(() => processPayment({ accountId: 'acc-1', amount: 10 }));
    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled');
    expect(successful.length).toBe(1);
  });
});
`.trim();

    return {
      proposalId: `prop-race-${context.nodeId}-${Date.now()}`,
      persona: this.personaType,
      family: this.defaultFamily,
      modelName: config.modelName,
      threatCategory: this.threatCategory,
      severity: 'HIGH',
      rationale: 'Payment and balance debit logic lacks distributed lock or serializable transaction isolation.',
      proposedTestCode: testCode,
      tokensUsed: 310,
      createdAt: new Date().toISOString(),
    };
  }
}

export class EdgeChaosPersona extends BaseAdvisoryPersona {
  public readonly personaType: PersonaType = 'EDGE_CHAOS';
  public readonly defaultFamily: ModelFamily = 'gemini';
  public readonly threatCategory = 'BOUNDARY_CONDITIONS_AND_RATE_LIMITS';

  public async proposeAdvisoryTest(
    context: PersonaEvaluationContext
  ): Promise<AdvisoryProposal> {
    const config = this.gateway.getModelConfig(this.defaultFamily);
    const testCode = `
// Adversarial Edge Chaos Test by EdgeChaos (${this.defaultFamily}:${config.modelName})
describe('${context.moduleName} - Extreme Boundary Chaos', () => {
  it('handles empty collections, huge payloads and unexpected clock skew', async () => {
    const chaosInput = { items: [], timestamp: Date.now() + 86400000, size: Number.MAX_SAFE_INTEGER };
    expect(() => validatePayload(chaosInput)).not.toThrow();
  });
});
`.trim();

    return {
      proposalId: `prop-chaos-${context.nodeId}-${Date.now()}`,
      persona: this.personaType,
      family: this.defaultFamily,
      modelName: config.modelName,
      threatCategory: this.threatCategory,
      severity: 'MEDIUM',
      rationale: 'Boundary checks missing on numeric limits and timestamps.',
      proposedTestCode: testCode,
      tokensUsed: 250,
      createdAt: new Date().toISOString(),
    };
  }
}
