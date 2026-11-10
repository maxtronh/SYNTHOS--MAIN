import { describe, it, expect } from 'vitest';
import {
  PrecisionLedger,
  RecallLedger,
  OperationalMetricsTracker,
} from '../src/index.js';

describe('Dual Telemetry Ledger & Operational Metrics Suite', () => {
  it('tracks persona precision and enforces down-sampling/retirement policy', () => {
    const ledger = new PrecisionLedger();

    // High precision cohort (8 / 10 = 80%)
    const rec1 = ledger.adjudicateCohort({
      personaId: 'security-fuzzer',
      cohortId: 'batch-01',
      totalProposedTests: 10,
      verifiedCatchingBugs: 8,
      adjudicationEvidence: 'Caught 8 real memory leak and injection vulnerabilities',
    });
    expect(rec1.precisionRatio).toBe(0.8);
    expect(rec1.status).toBe('ACTIVE');

    // Mediocre precision cohort (4 / 10 = 40%) -> DOWN_SAMPLED
    const rec2 = ledger.adjudicateCohort({
      personaId: 'flake-hunter',
      cohortId: 'batch-01',
      totalProposedTests: 10,
      verifiedCatchingBugs: 4,
      adjudicationEvidence: '6 tests were non-reproducible hallucinations',
    });
    expect(rec2.precisionRatio).toBe(0.4);
    expect(rec2.status).toBe('DOWN_SAMPLED');

    // Low precision cohort (2 / 10 = 20%) -> RETIRED
    const rec3 = ledger.adjudicateCohort({
      personaId: 'noisy-agent',
      cohortId: 'batch-01',
      totalProposedTests: 10,
      verifiedCatchingBugs: 2,
      adjudicationEvidence: '8 false positives',
    });
    expect(rec3.precisionRatio).toBe(0.2);
    expect(rec3.status).toBe('RETIRED');
  });

  it('evaluates production escapes and flags layer reduction on low recall', () => {
    const ledger = new RecallLedger();
    const persona = 'edge-case-analyst';

    // Batch 1: 1 caught, 3 missed catchable escapes -> 1 / (1 + 3) = 25% (< 40%)
    ledger.recordEscape({
      escapeId: 'esc-01',
      description: 'Zero division on invoice calculation',
      personaInvolved: persona,
      batchId: 'batch-1',
      hadOpportunityToDetect: true,
      wasReasonablyCatchable: true,
      adjudicatedBy: 'principal-engineer',
    });
    ledger.recordEscape({
      escapeId: 'esc-02',
      description: 'Null pointer on empty profile',
      personaInvolved: persona,
      batchId: 'batch-1',
      hadOpportunityToDetect: true,
      wasReasonablyCatchable: true,
      adjudicatedBy: 'principal-engineer',
    });
    ledger.recordEscape({
      escapeId: 'esc-03',
      description: 'Off-by-one pagination',
      personaInvolved: persona,
      batchId: 'batch-1',
      hadOpportunityToDetect: true,
      wasReasonablyCatchable: true,
      adjudicatedBy: 'principal-engineer',
    });

    const batch1 = ledger.evaluateBatchRecall({
      personaId: persona,
      batchId: 'batch-1',
      detectedCount: 1,
    });
    expect(batch1.recallRatio).toBe(0.25);
    // Only 1 batch below 40%, not yet 2 consecutive
    expect(ledger.shouldShrinkAILayer(persona)).toBe(false);

    // Batch 2: 1 caught, 2 missed catchable escapes -> 1 / (1 + 2) = 33% (< 40%)
    ledger.recordEscape({
      escapeId: 'esc-04',
      description: 'Unicode name crash',
      personaInvolved: persona,
      batchId: 'batch-2',
      hadOpportunityToDetect: true,
      wasReasonablyCatchable: true,
      adjudicatedBy: 'principal-engineer',
    });
    ledger.recordEscape({
      escapeId: 'esc-05',
      description: 'Negative price overflow',
      personaInvolved: persona,
      batchId: 'batch-2',
      hadOpportunityToDetect: true,
      wasReasonablyCatchable: true,
      adjudicatedBy: 'principal-engineer',
    });

    const batch2 = ledger.evaluateBatchRecall({
      personaId: persona,
      batchId: 'batch-2',
      detectedCount: 1,
    });
    expect(batch2.recallRatio).toBeCloseTo(0.333, 2);

    // Two consecutive batches below 40% -> Must trigger shrink AI layer policy!
    expect(ledger.shouldShrinkAILayer(persona)).toBe(true);
  });

  it('computes P50/P95 latency, average costs and blast radius metrics', () => {
    const tracker = new OperationalMetricsTracker();

    // Record 20 execution samples with varying latencies
    for (let i = 1; i <= 20; i++) {
      tracker.recordExecution({
        workflowId: `wf-${i}`,
        moduleId: `mod-${i}`,
        llmCostUsd: 0.05,
        computeCostUsd: 0.02,
        pipelineLatencyMs: i * 1000, // 1000ms to 20000ms
        blastRadiusResolutionMs: i * 200,
      });
    }

    const costs = tracker.getAverageCostPerModule();
    expect(costs.avgLlmCost).toBeCloseTo(0.05);
    expect(costs.avgComputeCost).toBeCloseTo(0.02);
    expect(costs.avgTotalCost).toBeCloseTo(0.07);

    const latencyStats = tracker.getLatencyStats();
    expect(latencyStats.count).toBe(20);
    // P50 is index 10 -> 11000ms
    expect(latencyStats.p50).toBe(11000);
    // P95 is index 19 -> 20000ms
    expect(latencyStats.p95).toBe(20000);
    expect(latencyStats.min).toBe(1000);
    expect(latencyStats.max).toBe(20000);

    const blastStats = tracker.getBlastRadiusStats();
    expect(blastStats.count).toBe(20);
    expect(blastStats.p50).toBe(2200);
    expect(blastStats.p95).toBe(4000);
  });
});
