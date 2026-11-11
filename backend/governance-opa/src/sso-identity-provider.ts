import type { OperatorPrincipal, OperatorRole } from './policy-engine.js';

/**
 * SSO / OIDC Identity Provider (Phase 3: External Integrations).
 *
 * Validates SSO assertions (OIDC ID tokens, SAML responses, or mock SSO payloads)
 * and maps them to Fable Engine `OperatorPrincipal` objects consumed by
 * `OpaPolicyEvaluator` for RBAC and separation-of-duties enforcement.
 */
export class SsoIdentityProvider {
  private readonly issuer: string;
  private readonly audience: string;

  constructor(options: { issuer: string; audience: string }) {
    this.issuer = options.issuer;
    this.audience = options.audience;
  }

  /**
   * Validate an SSO assertion and produce an OperatorPrincipal.
   *
   * In production this verifies the OIDC ID token signature/JWT against the
   * IdP's JWKS endpoint. Here we accept a normalized SSO payload with an
   * `iss` claim matching our configured issuer and an `aud` claim matching
   * our audience.
   */
  authenticate(
    assertion: Record<string, unknown>,
    nowMs: number = Date.now()
  ): OperatorPrincipal {
    const iss = assertion['iss'];
    const aud = assertion['aud'];
    const sub = assertion['sub'];
    const email = assertion['email'];
    const tenantId = assertion['tenant_id'] ?? assertion['tenantId'];
    const rawRoles = assertion['roles'] ?? assertion['groups'] ?? [];
    const expiresAt = assertion['exp'] ?? assertion['expiresAt'];

    if (iss !== this.issuer) {
      throw new Error(`SSO Authentication Failed: issuer '${iss}' does not match configured issuer '${this.issuer}'.`);
    }

    if (Array.isArray(aud) ? !aud.includes(this.audience) : aud !== this.audience) {
      throw new Error(`SSO Authentication Failed: audience does not match configured audience '${this.audience}'.`);
    }

    if (!sub || typeof sub !== 'string') {
      throw new Error('SSO Authentication Failed: missing subject identifier (sub).');
    }

    if (expiresAt !== undefined && typeof expiresAt === 'number' && nowMs >= expiresAt) {
      throw new Error(`SSO Authentication Failed: assertion expired at ${expiresAt}.`);
    }

    const roles = this.normalizeRoles(rawRoles);

    return {
      subjectId: sub,
      email: typeof email === 'string' ? email : '',
      tenantId: typeof tenantId === 'string' ? tenantId : 'default',
      roles,
      ssoAuthenticated: true,
    };
  }

  /**
   * Normalize role values from SSO claims into `OperatorRole[]`.
   * Unknown roles are dropped (fail-closed: only known roles are granted).
   */
  private normalizeRoles(rawRoles: unknown): OperatorRole[] {
    const validRoles: OperatorRole[] = [
      'DEVELOPER',
      'SENIOR_ENGINEER',
      'SECURITY_LEAD',
      'RELEASE_DIRECTOR',
    ];

    const roleList = Array.isArray(rawRoles) ? rawRoles : [rawRoles];
    const knownRoles = new Set<string>(validRoles);

    return roleList
      .filter((r): r is string => typeof r === 'string')
      .filter(r => knownRoles.has(r.toUpperCase()))
      .map(r => r.toUpperCase() as OperatorRole);
  }

  /**
   * Build a mock SSO assertion for local development / testing.
   * Not for production use.
   */
  static mockAssertion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      iss: 'https://idp.example.com',
      aud: 'fable-engine-v3',
      sub: 'usr-dev-1',
      email: 'dev@example.com',
      tenant_id: 'tenant-acme',
      roles: ['DEVELOPER'],
      exp: Date.now() + 3600 * 1000,
      ...overrides,
    };
  }
}

export type { OperatorPrincipal };