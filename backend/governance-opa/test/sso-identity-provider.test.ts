import { describe, it, expect } from 'vitest';
import { SsoIdentityProvider, OpaPolicyEvaluator } from '../src/index.js';

describe('Phase 3: SSO / OIDC Identity Provider Integration', () => {
  const idp = new SsoIdentityProvider({
    issuer: 'https://idp.example.com',
    audience: 'fable-engine-v3',
  });

  it('authenticates a valid SSO assertion and maps roles to OperatorPrincipal', () => {
    const principal = idp.authenticate({
      iss: 'https://idp.example.com',
      aud: 'fable-engine-v3',
      sub: 'usr-sec-1',
      email: 'ciso@example.com',
      tenant_id: 'tenant-acme',
      roles: ['SECURITY_LEAD'],
      exp: Date.now() + 3600 * 1000,
    });

    expect(principal.ssoAuthenticated).toBe(true);
    expect(principal.subjectId).toBe('usr-sec-1');
    expect(principal.email).toBe('ciso@example.com');
    expect(principal.tenantId).toBe('tenant-acme');
    expect(principal.roles).toContain('SECURITY_LEAD');
  });

  it('rejects assertions with mismatched issuer', () => {
    expect(() =>
      idp.authenticate({
        iss: 'https://evil-idp.example.com',
        aud: 'fable-engine-v3',
        sub: 'usr-1',
        email: 'a@b.com',
        tenant_id: 'tenant-acme',
        roles: [],
      })
    ).toThrow(/issuer/);
  });

  it('rejects assertions with mismatched audience', () => {
    expect(() =>
      idp.authenticate({
        iss: 'https://idp.example.com',
        aud: 'wrong-audience',
        sub: 'usr-1',
        email: 'a@b.com',
        tenant_id: 'tenant-acme',
        roles: [],
      })
    ).toThrow(/audience/);
  });

  it('rejects expired assertions', () => {
    expect(() =>
      idp.authenticate({
        iss: 'https://idp.example.com',
        aud: 'fable-engine-v3',
        sub: 'usr-1',
        email: 'a@b.com',
        tenant_id: 'tenant-acme',
        roles: [],
        exp: Date.now() - 1000,
      })
    ).toThrow(/expired/);
  });

  it('filters unknown roles (fail-closed)', () => {
    const principal = idp.authenticate({
      iss: 'https://idp.example.com',
      aud: 'fable-engine-v3',
      sub: 'usr-1',
      email: 'a@b.com',
      tenant_id: 'tenant-acme',
      roles: ['DEVELOPER', 'UNKNOWN_ROLE', 'SENIOR_ENGINEER'],
    });

    expect(principal.roles).toEqual(['DEVELOPER', 'SENIOR_ENGINEER']);
  });

  it('maps lowercase roles to uppercase OperatorRole', () => {
    const principal = idp.authenticate({
      iss: 'https://idp.example.com',
      aud: 'fable-engine-v3',
      sub: 'usr-1',
      email: 'a@b.com',
      tenant_id: 'tenant-acme',
      roles: ['release_director'],
    });

    expect(principal.roles).toContain('RELEASE_DIRECTOR');
  });

  it('works with OpaPolicyEvaluator end-to-end: authenticated principal can act', () => {
    const principal = idp.authenticate({
      iss: 'https://idp.example.com',
      aud: 'fable-engine-v3',
      sub: 'usr-dir-1',
      email: 'vp@example.com',
      tenant_id: 'tenant-acme',
      roles: ['RELEASE_DIRECTOR'],
      exp: Date.now() + 3600 * 1000,
    });

    const decision = OpaPolicyEvaluator.evaluate({
      principal,
      action: 'PROMOTE_PRODUCTION',
      resourceTenantId: 'tenant-acme',
      resourceAuthorId: 'usr-dev-1',
    });

    expect(decision.allowed).toBe(true);
  });

  it('uses mockAssertion helper for local development', () => {
    const assertion = SsoIdentityProvider.mockAssertion({
      sub: 'usr-mock-1',
      roles: ['SENIOR_ENGINEER'],
    });

    const principal = idp.authenticate(assertion);
    expect(principal.subjectId).toBe('usr-mock-1');
    expect(principal.roles).toContain('SENIOR_ENGINEER');
    expect(principal.ssoAuthenticated).toBe(true);
  });
});