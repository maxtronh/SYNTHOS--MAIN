import { describe, it, expect } from 'vitest';
import { SlsaAttestationAuthority } from '@fable/attestation-slsa';
import type { GateVerdict } from '@fable/contracts';
import { CanaryRolloutController } from '../src/index.js';

describe('Phase 18: Canary Rollout & Auto-Rollback Suite', () => {
  const authority = new SlsaAttestationAuthority();
  const passVerdict: GateVerdict = {
    verdictId: 'v-can-1',
    workflowId: 'wf-can',
    nodeId: 'n1',
    contractId: 'c1',
    contractVersion: '1.0.0',
    gate: 'L0',
    status: 'PASS',
    sandboxPath: 'PATH_A_EPHEMERAL',
    executionDurationMs: 100,
    isAuthoritative: true,
    errorDetails: [],
    metrics: {},
    evaluatedAt: new Date().toISOString(),
  };

  const validAttestation = authority.signProvenance({
    subjectName: 'rc-100',
    artifactContent: 'compiled-bundle',
    workflowId: 'wf-can',
    blueprintId: 'bp-can',
    contractId: 'c1',
    contractVersion: '1.0.0',
    builderId: 'microvm',
    verdicts: [passVerdict],
  });

  it('requires explicit human approval and valid SLSA provenance before canary shift', () => {
    expect(
      () =>
        new CanaryRolloutController({
          rolloutId: 'ro-1',
          releaseCandidateId: 'rc-100',
          attestationAuthority: authority,
          attestations: [validAttestation],
          humanApprovedPromotion: false,
        })
    ).toThrow('Explicit human release approval is mandatory');
  });

  it('progresses smoothly across traffic weights when metrics are healthy', () => {
    const controller = new CanaryRolloutController({
      rolloutId: 'ro-2',
      releaseCandidateId: 'rc-100',
      attestationAuthority: authority,
      attestations: [validAttestation],
      humanApprovedPromotion: true,
      steps: [5, 50, 100],
    });

    expect(controller.evaluateAndAdvance().currentWeightPercent).toBe(5);
    expect(controller.evaluateAndAdvance({ errorRate: 0.001, p99LatencyMs: 120, sampleSize: 500 }).currentWeightPercent).toBe(50);

    const finalState = controller.evaluateAndAdvance({ errorRate: 0.002, p99LatencyMs: 180, sampleSize: 2000 });
    expect(finalState.currentWeightPercent).toBe(100);
    expect(finalState.status).toBe('PROMOTED_100');
  });

  it('triggers immediate rollback to 0% weight when error rate or latency breaches SLO', () => {
    const controller = new CanaryRolloutController({
      rolloutId: 'ro-3',
      releaseCandidateId: 'rc-100',
      attestationAuthority: authority,
      attestations: [validAttestation],
      humanApprovedPromotion: true,
      thresholds: { maxErrorRate: 0.01, maxP99LatencyMs: 400 },
    });

    controller.evaluateAndAdvance(); // -> 5%
    const rolledBack = controller.evaluateAndAdvance({
      errorRate: 0.045, // 4.5% > 1%
      p99LatencyMs: 250,
      sampleSize: 1000,
    });

    expect(rolledBack.status).toBe('ROLLED_BACK');
    expect(rolledBack.currentWeightPercent).toBe(0);
    expect(rolledBack.rollbackReason).toContain('Error rate 4.50% exceeded');
  });
});
