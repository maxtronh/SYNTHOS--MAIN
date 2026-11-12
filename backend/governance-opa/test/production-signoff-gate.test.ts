import { describe, it, expect } from 'vitest';
import { ProductionSignOffGate, type OperatorPrincipal } from '../src/index.js';

describe('Phase 38: Production Readiness Sign-Off Gate Suite', () => {
  const secLead: OperatorPrincipal = {
    subjectId: 'sec-1',
    email: 'ciso@synthos.dev',
    tenantId: 'tenant-main',
    roles: ['SECURITY_LEAD'],
    ssoAuthenticated: true,
  };

  const director: OperatorPrincipal = {
    subjectId: 'dir-1',
    email: 'vp-eng@synthos.dev',
    tenantId: 'tenant-main',
    roles: ['RELEASE_DIRECTOR'],
    ssoAuthenticated: true,
  };

  const allEvidencePassed = {
    temporalReplayVerified: true,
    redisReconciliationVerified: true,
    sandboxCleanupVerified: true,
    slsaProvenanceVerified: true,
    drGameDayPassed: true,
    openPreProdDecisionsResolved: true,
  };

  it('approves Go-Live when all evidence checks pass and both Security Lead and Release Director sign off', () => {
    const verdict = ProductionSignOffGate.evaluate({
      releaseCandidateId: 'rc-prod-v3',
      resourceTenantId: 'tenant-main',
      resourceAuthorId: 'dev-99',
      evidence: allEvidencePassed,
      signatures: [
        { principal: secLead, signedAt: new Date().toISOString() },
        { principal: director, signedAt: new Date().toISOString() },
      ],
    });

    expect(verdict.approved).toBe(true);
    expect(verdict.blockingReasons).toHaveLength(0);
    expect(verdict.verifiedApprovers).toEqual([
      'ciso@synthos.dev (SECURITY_LEAD)',
      'vp-eng@synthos.dev (RELEASE_DIRECTOR)',
    ]);
  });

  it('blocks Go-Live if DR game-day failed, Security Lead sign-off missing, or author attempts self-promotion', () => {
    const verdict = ProductionSignOffGate.evaluate({
      releaseCandidateId: 'rc-prod-v3',
      resourceTenantId: 'tenant-main',
      resourceAuthorId: 'dir-1', // Director authored the change -> Separation of Duties blocks!
      evidence: { ...allEvidencePassed, drGameDayPassed: false },
      signatures: [{ principal: director, signedAt: new Date().toISOString() }],
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.blockingReasons).toContain('Disaster Recovery game-day drill has not passed');
    expect(verdict.blockingReasons).toContain('Missing authorized SSO SECURITY_LEAD sign-off.');
    expect(verdict.blockingReasons.some(r => r.includes('Separation of Duties Violation'))).toBe(true);
  });
});
