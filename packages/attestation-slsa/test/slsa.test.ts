import { describe, it, expect } from 'vitest';
import type { GateVerdict } from '@fable/contracts';
import { SlsaAttestationAuthority } from '../src/index.js';

describe('Phase 11: Cryptographic SLSA Provenance Attestation Suite', () => {
  const passVerdict: GateVerdict = {
    verdictId: 'v-slsa-1',
    workflowId: 'wf-slsa',
    nodeId: 'node-auth',
    contractId: 'c-auth',
    contractVersion: '1.0.0',
    gate: 'L0',
    status: 'PASS',
    sandboxPath: 'PATH_A_EPHEMERAL',
    executionDurationMs: 420,
    isAuthoritative: true,
    errorDetails: [],
    metrics: {},
    evaluatedAt: new Date().toISOString(),
  };

  it('signs SLSA v1.0 provenance using Ed25519 and authorizes valid PASS releases', () => {
    const authority = new SlsaAttestationAuthority();

    const envelope = authority.signProvenance({
      subjectName: 'rc-auth-v1.0.0',
      artifactContent: 'export const auth = true;',
      workflowId: 'wf-slsa',
      blueprintId: 'bp-slsa',
      contractId: 'c-auth',
      contractVersion: '1.0.0',
      builderId: 'firecracker-microvm-runner',
      verdicts: [passVerdict],
    });

    expect(envelope.algorithm).toBe('ed25519');
    expect(authority.verifyAttestation(envelope)).toBe(true);
    expect(() => authority.assertReleaseAuthorized([envelope])).not.toThrow();
  });

  it('rejects tampered attestations where payload or verdicts were modified after signing', () => {
    const authority = new SlsaAttestationAuthority();
    const failVerdict: GateVerdict = { ...passVerdict, status: 'FAIL' };

    const envelope = authority.signProvenance({
      subjectName: 'rc-auth-v1.0.0',
      artifactContent: 'export const auth = false;',
      workflowId: 'wf-slsa',
      blueprintId: 'bp-slsa',
      contractId: 'c-auth',
      contractVersion: '1.0.0',
      builderId: 'firecracker-microvm-runner',
      verdicts: [failVerdict],
    });

    // Tamper: attacker flips FAIL -> PASS after signing
    const tampered = structuredClone(envelope);
    tampered.statement.predicate.runDetails.verdicts[0]!.status = 'PASS';

    expect(authority.verifyAttestation(tampered)).toBe(false);
    expect(() => authority.assertReleaseAuthorized([tampered])).toThrow(
      'Invalid or tampered SLSA cryptographic signature'
    );
  });

  it('blocks release promotion when valid signature contains a failing authoritative gate', () => {
    const authority = new SlsaAttestationAuthority();
    const failVerdict: GateVerdict = { ...passVerdict, gate: 'L1a', status: 'FAIL' };

    const envelope = authority.signProvenance({
      subjectName: 'rc-auth-bad',
      artifactContent: 'bad code',
      workflowId: 'wf-slsa',
      blueprintId: 'bp-slsa',
      contractId: 'c-auth',
      contractVersion: '1.0.0',
      builderId: 'ephemeral-runner',
      verdicts: [passVerdict, failVerdict],
    });

    expect(authority.verifyAttestation(envelope)).toBe(true);
    expect(() => authority.assertReleaseAuthorized([envelope])).toThrow(
      'non-passing authoritative gates [L1a:FAIL]'
    );
  });
});
