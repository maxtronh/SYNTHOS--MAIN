import { describe, it, expect } from 'vitest';
import {
  ModelGateway,
  SecurityFuzzerPersona,
  DataIntegrityPersona,
  ConcurrencyRacerPersona,
  EdgeChaosPersona,
} from '../src/index.js';
import type { BoundedPrompt } from '@fable/retrieval-pgvector';

describe('Multi-Family LLM Model Gateway & Personas Suite (Phase 7)', () => {
  const dummyPrompt: BoundedPrompt = {
    systemPrompt: 'System',
    userContext: 'function processPayment() {}',
    retrievedChunks: [],
    totalChunks: 1,
    totalTokensApprox: 200,
  };

  const context = {
    workflowId: 'wf-model-01',
    nodeId: 'node-pay',
    moduleName: 'payment-processor',
    boundedPrompt: dummyPrompt,
  };

  it('enforces Tier 1 model family independence between Architect and Meta-Reviewer', () => {
    // Valid: Architect is Gemini, Meta-Reviewer is Claude
    expect(ModelGateway.validateIndependence('gemini', 'claude')).toBe(true);

    // Valid: Architect is Claude, Meta-Reviewer is OpenAI
    expect(ModelGateway.validateIndependence('claude', 'openai')).toBe(true);

    // Violation: Both use Gemini -> Must throw to prevent correlated blind spots!
    expect(() => ModelGateway.validateIndependence('gemini', 'gemini')).toThrow(
      'Independence Violation'
    );
  });

  it('dispatches completion and falls back to DEFERRED upon gateway failure', async () => {
    const gateway = new ModelGateway();

    // Success dispatch
    const resSuccess = await gateway.executeCompletion('gemini', dummyPrompt, {
      workflowId: 'wf-1',
      nodeId: 'node-1',
      persona: 'security',
    });
    expect(resSuccess.status).toBe('SUCCESS');
    expect(resSuccess.result?.family).toBe('gemini');

    // Simulated gateway failure -> Must return DEFERRED without halting pipeline
    const resFail = await gateway.executeCompletion('gemini', dummyPrompt, {
      workflowId: 'wf-1',
      nodeId: 'node-1',
      persona: 'security',
    }, { simulateError: true });

    expect(resFail.status).toBe('DEFERRED');
    expect(resFail.reason).toContain('503 Service Unavailable');
  });

  it('generates targeted adversarial tests across all 4 specialized personas', async () => {
    const secFuzzer = new SecurityFuzzerPersona();
    const dataIntegrity = new DataIntegrityPersona();
    const concurrency = new ConcurrencyRacerPersona();
    const edgeChaos = new EdgeChaosPersona();

    const secProp = await secFuzzer.proposeAdvisoryTest(context);
    expect(secProp.persona).toBe('SECURITY_FUZZER');
    expect(secProp.severity).toBe('CRITICAL');
    expect(secProp.proposedTestCode).toContain('Security Invariants');

    const dataProp = await dataIntegrity.proposeAdvisoryTest(context);
    expect(dataProp.persona).toBe('DATA_INTEGRITY');
    expect(dataProp.severity).toBe('HIGH');
    expect(dataProp.proposedTestCode).toContain('Constraint Integrity');

    const raceProp = await concurrency.proposeAdvisoryTest(context);
    expect(raceProp.persona).toBe('CONCURRENCY_RACER');
    expect(raceProp.proposedTestCode).toContain('Distributed Lock Contention');

    const chaosProp = await edgeChaos.proposeAdvisoryTest(context);
    expect(chaosProp.persona).toBe('EDGE_CHAOS');
    expect(chaosProp.severity).toBe('MEDIUM');
    expect(chaosProp.proposedTestCode).toContain('Extreme Boundary Chaos');
  });
});
