import crypto from 'crypto';
import type { SandboxPath } from '@fable/contracts';
import type { EphemeralLease, IssueLeaseRequest, SecretScope } from './types.js';

/**
 * Policy table defining maximum permitted scopes per sandbox route.
 * Path A never receives database write scopes; neither path ever receives production credentials.
 */
const PERMITTED_SCOPES_BY_PATH: Record<SandboxPath, ReadonlySet<SecretScope>> = {
  PATH_A_EPHEMERAL: new Set<SecretScope>(['minio:read', 'llm:invoke']),
  PATH_B_STATEFUL: new Set<SecretScope>(['minio:read', 'minio:write', 'llm:invoke', 'sandbox:tmp_db']),
};

const MAX_SANDBOX_TTL_MS = 15 * 60 * 1000; // Hard 15-minute ceiling for ephemeral job credentials

/**
 * Vault / OIDC style ephemeral secrets broker issuing short-lived, strictly scoped job credentials.
 */
export class SecretsBroker {
  private leasesById = new Map<string, EphemeralLease>();
  private leasesByToken = new Map<string, EphemeralLease>();

  /**
   * Issues a short-lived credential lease bound to a specific jobId and sandboxPath.
   */
  public issueLease(request: IssueLeaseRequest, nowMs: number = Date.now()): EphemeralLease {
    const allowedSet = PERMITTED_SCOPES_BY_PATH[request.sandboxPath];
    const validatedScopes: SecretScope[] = [];

    for (const scope of request.requestedScopes) {
      if (scope.startsWith('prod:') || !allowedSet.has(scope as SecretScope)) {
        throw new Error(
          `Security Policy Violation: Scope '${scope}' is prohibited for sandbox path '${request.sandboxPath}'.`
        );
      }
      validatedScopes.push(scope as SecretScope);
    }

    const ttlMs = Math.min(request.ttlMs ?? 300000, MAX_SANDBOX_TTL_MS);
    if (ttlMs <= 0) {
      throw new Error('Lease TTL must be positive.');
    }

    const leaseId = `lease-${request.jobId}-${crypto.randomUUID()}`;
    const token = `fbl_${crypto.randomBytes(24).toString('hex')}`;

    const lease: EphemeralLease = {
      leaseId,
      jobId: request.jobId,
      sandboxPath: request.sandboxPath,
      token,
      scopes: validatedScopes,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
      revoked: false,
    };

    this.leasesById.set(leaseId, lease);
    this.leasesByToken.set(token, lease);
    return lease;
  }

  /**
   * Verifies token authenticity, non-revocation, TTL validity, and requested scope.
   */
  public validateLease(
    token: string,
    requiredScope: SecretScope,
    nowMs: number = Date.now()
  ): boolean {
    const lease = this.leasesByToken.get(token);
    if (!lease || lease.revoked) return false;
    if (nowMs >= lease.expiresAtMs) return false;
    return lease.scopes.includes(requiredScope);
  }

  public revokeLease(leaseId: string): boolean {
    const lease = this.leasesById.get(leaseId);
    if (!lease || lease.revoked) return false;
    lease.revoked = true;
    return true;
  }

  /**
   * Revokes all active leases associated with a sandbox job on teardown.
   */
  public revokeAllForJob(jobId: string): number {
    let revokedCount = 0;
    for (const lease of this.leasesById.values()) {
      if (lease.jobId === jobId && !lease.revoked) {
        lease.revoked = true;
        revokedCount++;
      }
    }
    return revokedCount;
  }
}
