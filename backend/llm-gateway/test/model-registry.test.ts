import { describe, it, expect } from 'vitest';
import { PrecisionLedger, RecallLedger } from '@fable/ledger-telemetry';
import { ModelRegistry } from '../src/index.js';

describe('Phase 39: LLM Model Registry & Persona Versioning Suite', () => {
  it('registers versioned models & personas with deterministic SHA-256 prompt hashes', () => {
    const registry = new ModelRegistry();

    registry.registerModel({
      modelId: 'gemini-pro-v1',
      family: 'gemini',
      modelName: 'gemini-1.5-pro',
      modelVersion: '002',
    });

    const spec1 = registry.registerPersonaVersion({
      persona: 'SECURITY_FUZZER',
      version: '1.0.0',
      promptTemplate: 'Analyze AST for injection vectors.',
      boundModelId: 'gemini-pro-v1',
      confidenceScore: 0.92,
    });

    const spec2 = registry.registerPersonaVersion({
      persona: 'SECURITY_FUZZER',
      version: '1.1.0',
      promptTemplate: 'Analyze AST for injection and JWT forgery vectors.',
      boundModelId: 'gemini-pro-v1',
      confidenceScore: 0.95,
    });

    expect(spec1.promptSha256).toHaveLength(64);
    expect(spec2.promptSha256).not.toBe(spec1.promptSha256);
    expect(registry.getLatestPersonaVersion('SECURITY_FUZZER')?.version).toBe('1.1.0');

    expect(() =>
      registry.registerPersonaVersion({
        persona: 'EDGE_CHAOS',
        version: '1.0.0',
        promptTemplate: 'Invalid confidence',
        boundModelId: 'gemini-pro-v1',
        confidenceScore: 1.5,
      })
    ).toThrow('confidenceScore');
  });

  it('enforces PrecisionLedger retirement (<30%) and down-sampling (<50%) on persona eligibility', () => {
    const registry = new ModelRegistry();
    registry.registerModel({
      modelId: 'claude-sonnet-v35',
      family: 'claude',
      modelName: 'claude-3-5-sonnet-20241022',
      modelVersion: '20241022',
    });

    registry.registerPersonaVersion({
      persona: 'DATA_INTEGRITY',
      version: '2.0.0',
      promptTemplate: 'Audit schema migrations.',
      boundModelId: 'claude-sonnet-v35',
      confidenceScore: 0.88,
    });

    const pLedger = new PrecisionLedger();

    // 40% precision -> DOWN_SAMPLED (samplingRate = 0.25)
    pLedger.adjudicateCohort({
      personaId: 'DATA_INTEGRITY',
      cohortId: 'c1',
      totalProposedTests: 10,
      verifiedCatchingBugs: 4,
      adjudicationEvidence: '4 real schema issues',
    });

    const downSampled = registry.resolveEligiblePersona('DATA_INTEGRITY', pLedger);
    expect(downSampled.eligible).toBe(true);
    expect(downSampled.ledgerStatus).toBe('DOWN_SAMPLED');
    expect(downSampled.samplingRate).toBe(0.25);

    // 20% precision -> RETIRED (eligible = false)
    pLedger.adjudicateCohort({
      personaId: 'DATA_INTEGRITY',
      cohortId: 'c2',
      totalProposedTests: 10,
      verifiedCatchingBugs: 2,
      adjudicationEvidence: '8 hallucinations',
    });

    const retired = registry.resolveEligiblePersona('DATA_INTEGRITY', pLedger);
    expect(retired.eligible).toBe(false);
    expect(retired.ledgerStatus).toBe('RETIRED');
    expect(retired.reason).toContain('RETIRED');
  });

  it('flags layer reduction when RecallLedger shows 2 consecutive batches below 40%', () => {
    const registry = new ModelRegistry();
    registry.registerModel({
      modelId: 'gpt-4o-1',
      family: 'openai',
      modelName: 'gpt-4o',
      modelVersion: '2024-08-06',
    });

    registry.registerPersonaVersion({
      persona: 'EDGE_CHAOS',
      version: '1.0.0',
      promptTemplate: 'Boundary test.',
      boundModelId: 'gpt-4o-1',
      confidenceScore: 0.8,
    });

    const pLedger = new PrecisionLedger();
    const rLedger = new RecallLedger();

    for (const batchId of ['b1', 'b2']) {
      rLedger.recordEscape({
        escapeId: `esc-${batchId}`,
        description: 'Missed edge case',
        personaInvolved: 'EDGE_CHAOS',
        batchId,
        hadOpportunityToDetect: true,
        wasReasonablyCatchable: true,
        adjudicatedBy: 'staff-eng',
      });
      rLedger.evaluateBatchRecall({ personaId: 'EDGE_CHAOS', batchId, detectedCount: 0 });
    }

    const decision = registry.resolveEligiblePersona('EDGE_CHAOS', pLedger, rLedger);
    expect(decision.eligible).toBe(true);
    expect(decision.layerShrinkRecommended).toBe(true);
    expect(decision.samplingRate).toBe(0.5);
  });
});
