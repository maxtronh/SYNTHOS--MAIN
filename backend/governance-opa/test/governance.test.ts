import { describe, it, expect } from 'vitest';
import { OpaPolicyEvaluator, type OperatorPrincipal } from '../src/index.js';

describe('Phase 26: Multi-Tenant RBAC & OPA Policy-as-Code Suite', () => {
  const developer: OperatorPrincipal = {
    subjectId: 'usr-dev-1',
    email: 'dev@acme.dev',
    tenantId: 'tenant-acme',
    roles: ['DEVELOPER'],
    ssoAuthenticated: true,
  };

  const securityLead: OperatorPrincipal = {
    subjectId: 'usr-sec-1',
    email: 'ciso@acme.dev',
    tenantId: 'tenant-acme',
    roles: ['SECURITY_LEAD'],
    ssoAuthenticated: true,
  };

  const director: OperatorPrincipal = {
    subjectId: 'usr-dir-1',
    email: 'vp@acme.dev',
    tenantId: 'tenant-acme',
    roles: ['RELEASE_DIRECTOR'],
    ssoAuthenticated: true,
  };

  it('enforces RBAC role requirements and Separation of Duties', () => {
    // Developer can submit blueprint, cannot promote production
    expect(
      OpaPolicyEvaluator.evaluate({
        principal: developer,
        action: 'SUBMIT_BLUEPRINT',
        resourceTenantId: 'tenant-acme',
      }).allowed
    ).toBe(true);

    const devPromote = OpaPolicyEvaluator.evaluate({
      principal: developer,
      action: 'PROMOTE_PRODUCTION',
      resourceTenantId: 'tenant-acme',
    });
    expect(devPromote.allowed).toBe(false);
    expect(devPromote.reasons[0]).toContain('RBAC Denied');

    // Director cannot self-promote their own authored blueprint!
    const selfPromote = OpaPolicyEvaluator.evaluate({
      principal: director,
      action: 'PROMOTE_PRODUCTION',
      resourceTenantId: 'tenant-acme',
      resourceAuthorId: 'usr-dir-1',
    });
    expect(selfPromote.allowed).toBe(false);
    expect(selfPromote.reasons[0]).toContain('Separation of Duties Violation');

    // Director can promote another author's blueprint
    expect(
      OpaPolicyEvaluator.evaluate({
        principal: director,
        action: 'PROMOTE_PRODUCTION',
        resourceTenantId: 'tenant-acme',
        resourceAuthorId: 'usr-dev-1',
      }).allowed
    ).toBe(true);
  });

  it('enforces cross-tenant isolation and Security Lead critical overrides', () => {
    const crossTenant = OpaPolicyEvaluator.evaluate({
      principal: securityLead,
      action: 'OVERRIDE_CRITICAL_THREAT',
      resourceTenantId: 'tenant-other-corp',
    });
    expect(crossTenant.allowed).toBe(false);
    expect(crossTenant.reasons[0]).toContain('Tenant Isolation Violation');

    expect(
      OpaPolicyEvaluator.evaluate({
        principal: securityLead,
        action: 'OVERRIDE_CRITICAL_THREAT',
        resourceTenantId: 'tenant-acme',
      }).allowed
    ).toBe(true);
  });
});
