import crypto from 'node:crypto';
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
   * Verify an HS256-signed compact JWT token (`header.payload.signature`) using
   * constant-time signature comparison, then authenticate its decoded claims.
   */
  public verifySignedToken(
    token: string,
    hmacSecret: string,
    nowMs: number = Date.now()
  ): OperatorPrincipal {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('SSO Authentication Failed: malformed compact JWT.');
    }
    const [encodedHeader, encodedPayload, encodedSig] = parts as [string, string, string];
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSig = crypto
      .createHmac('sha256', hmacSecret)
      .update(signingInput)
      .digest('base64url');

    const providedBuf = Buffer.from(encodedSig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw new Error('SSO Authentication Failed: invalid JWT signature.');
    }

    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    return this.authenticate(claims, nowMs);
  }

  /**
   * Issue an HS256-signed compact JWT for testing and local signed SSO flows.
   */
  public static issueSignedToken(
    claims: Record<string, unknown>,
    hmacSecret: string
  ): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', hmacSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${signature}`;
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