import { describe, it, expect } from 'vitest';
import { SecretsBroker } from '../src/index.js';

describe('Phase 13: Ephemeral Secrets Broker Suite', () => {
  it('issues least-privilege scoped leases and rejects production or mismatched scopes', () => {
    const broker = new SecretsBroker();
    const now = 1000000;

    // Path A permits minio:read and llm:invoke
    const leaseA = broker.issueLease(
      {
        jobId: 'job-pure-1',
        sandboxPath: 'PATH_A_EPHEMERAL',
        requestedScopes: ['minio:read', 'llm:invoke'],
        ttlMs: 60000,
      },
      now
    );

    expect(leaseA.token.startsWith('fbl_')).toBe(true);
    expect(broker.validateLease(leaseA.token, 'minio:read', now + 1000)).toBe(true);
    expect(broker.validateLease(leaseA.token, 'sandbox:tmp_db', now + 1000)).toBe(false);

    // Path A must reject database write scope
    expect(() =>
      broker.issueLease({
        jobId: 'job-pure-2',
        sandboxPath: 'PATH_A_EPHEMERAL',
        requestedScopes: ['sandbox:tmp_db'],
      })
    ).toThrow('Security Policy Violation');

    // Neither path can ever request production credentials
    expect(() =>
      broker.issueLease({
        jobId: 'job-stateful-1',
        sandboxPath: 'PATH_B_STATEFUL',
        requestedScopes: ['prod:db_master'],
      })
    ).toThrow('Security Policy Violation');
  });

  it('expires leases after TTL and immediately revokes all leases on job teardown', () => {
    const broker = new SecretsBroker();
    const t0 = 500000;

    const lease = broker.issueLease(
      {
        jobId: 'job-teardown-99',
        sandboxPath: 'PATH_B_STATEFUL',
        requestedScopes: ['sandbox:tmp_db', 'minio:write'],
        ttlMs: 5000,
      },
      t0
    );

    expect(broker.validateLease(lease.token, 'sandbox:tmp_db', t0 + 4999)).toBe(true);
    // Expired at t0 + 5000
    expect(broker.validateLease(lease.token, 'sandbox:tmp_db', t0 + 5000)).toBe(false);

    // Test immediate teardown revocation before TTL
    const activeLease = broker.issueLease(
      {
        jobId: 'job-active-10',
        sandboxPath: 'PATH_B_STATEFUL',
        requestedScopes: ['sandbox:tmp_db'],
        ttlMs: 300000,
      },
      t0
    );

    expect(broker.validateLease(activeLease.token, 'sandbox:tmp_db', t0 + 100)).toBe(true);
    const revoked = broker.revokeAllForJob('job-active-10');
    expect(revoked).toBe(1);
    expect(broker.validateLease(activeLease.token, 'sandbox:tmp_db', t0 + 100)).toBe(false);
  });
});
