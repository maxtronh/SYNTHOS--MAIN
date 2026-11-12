import { describe, it, expect } from 'vitest';
import { SlsaAttestationAuthority } from '@fable/attestation-slsa';
import type { GateVerdict } from '@fable/contracts';
import { MultiRegionCanaryOrchestrator } from '../src/index.js';

describe('Phase 34: Multi-Region Canary & SLSA-Guarded Global Rollback Suite', () => {
  const authority = new SlsaAttestationAuthority();
  const passVerdict: GateVerdict = {
    verdictId: 'v-mr-1',
    workflowId: 'wf-mr',
    nodeId: 'n1',
    contractId: 'c1',
    contractVersion: '1.0.0',
    gate: 'L0',
    status: 'PASS',
    sandboxPath: 'PATH_A_EPHEMERAL',
    executionDurationMs: 80,
    isAuthoritative: true,
    errorDetails: [],
    metrics: {},
    evaluatedAt: new Date().toISOString(),
  };

  const validAttestation = authority.signProvenance({
    subjectName: 'rc-multi-1',
    artifactContent: 'bundle',
    workflowId: 'wf-mr',
    blueprintId: 'bp-mr',
    contractId: 'c1',
    contractVersion: '1.0.0',
    builderId: 'microvm',
    verdicts: [passVerdict],
  });

  it('promotes regions sequentially from us-east-1 to eu-west-1 when healthy', () => {
    const orchestrator = new MultiRegionCanaryOrchestrator({
      rolloutId: 'mr-1',
      releaseCandidateId: 'rc-multi-1',
      regions: ['us-east-1', 'eu-west-1'],
      attestationAuthority: authority,
      attestations: [validAttestation],
      humanApprovedPromotion: true,
      stepsPerRegion: [25, 100],
    });

    // Wave 1: us-east-1 -> 25% -> 100%
    let snap = orchestrator.advanceActiveRegion();
    expect(snap.regionalStates['us-east-1']?.currentWeightPercent).toBe(25);
    expect(snap.regionalStates['eu-west-1']?.currentWeightPercent).toBe(0);

    snap = orchestrator.advanceActiveRegion({ errorRate: 0.001, p99LatencyMs: 120, sampleSize: 500 });
    expect(snap.regionalStates['us-east-1']?.status).toBe('PROMOTED_100');
    expect(snap.activeRegionIndex).toBe(1);

    // Wave 2: eu-west-1 -> 25% -> 100%
    snap = orchestrator.advanceActiveRegion();
    expect(snap.regionalStates['eu-west-1']?.currentWeightPercent).toBe(25);

    snap = orchestrator.advanceActiveRegion({ errorRate: 0.002, p99LatencyMs: 140, sampleSize: 500 });
    expect(snap.status).toBe('COMPLETED_ALL_REGIONS');
    expect(snap.regionalStates['eu-west-1']?.status).toBe('PROMOTED_100');
  });

  it('cascades global rollback across already-promoted regions if a downstream region breaches SLO', () => {
    const orchestrator = new MultiRegionCanaryOrchestrator({
      rolloutId: 'mr-2',
      releaseCandidateId: 'rc-multi-1',
      regions: ['us-east-1', 'eu-west-1'],
      attestationAuthority: authority,
      attestations: [validAttestation],
      humanApprovedPromotion: true,
      stepsPerRegion: [25, 100],
      thresholds: { maxErrorRate: 0.01, maxP99LatencyMs: 300 },
    });

    // Promote us-east-1 to 100%
    orchestrator.advanceActiveRegion();
    orchestrator.advanceActiveRegion({ errorRate: 0.001, p99LatencyMs: 100, sampleSize: 500 });

    // Start eu-west-1 at 25%, then breach P99 latency (950ms > 300ms)
    orchestrator.advanceActiveRegion();
    const snap = orchestrator.advanceActiveRegion({ errorRate: 0.001, p99LatencyMs: 950, sampleSize: 500 });

    expect(snap.status).toBe('GLOBAL_ROLLBACK');
    expect(snap.abortReason).toContain("SLO breach in region 'eu-west-1'");
    expect(snap.regionalStates['us-east-1']?.status).toBe('ROLLED_BACK');
    expect(snap.regionalStates['us-east-1']?.currentWeightPercent).toBe(0);
    expect(snap.regionalStates['eu-west-1']?.status).toBe('ROLLED_BACK');
    expect(snap.regionalStates['eu-west-1']?.currentWeightPercent).toBe(0);
  });

  it('aborts globally if SLSA attestation becomes invalid mid-rollout', () => {
    const mutableEnvelope = structuredClone(validAttestation);
    const orchestrator = new MultiRegionCanaryOrchestrator({
      rolloutId: 'mr-3',
      releaseCandidateId: 'rc-multi-1',
      regions: ['us-east-1', 'eu-west-1'],
      attestationAuthority: authority,
      attestations: [mutableEnvelope],
      humanApprovedPromotion: true,
      stepsPerRegion: [100],
    });

    // Region 1 passes
    orchestrator.advanceActiveRegion();

    // Tamper envelope before Region 2 starts
    mutableEnvelope.statement.predicate.runDetails.verdicts[0]!.status = 'FAIL';
    const snap = orchestrator.advanceActiveRegion();

    expect(snap.status).toBe('GLOBAL_ROLLBACK');
    expect(snap.abortReason).toContain('SLSA verification failed');
    expect(snap.regionalStates['us-east-1']?.currentWeightPercent).toBe(0);
  });
});
