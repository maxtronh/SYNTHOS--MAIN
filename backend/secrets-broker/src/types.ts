import type { SandboxPath } from '@fable/contracts';

export type SecretScope =
  | 'minio:read'
  | 'minio:write'
  | 'llm:invoke'
  | 'sandbox:tmp_db';

export interface EphemeralLease {
  leaseId: string;
  jobId: string;
  sandboxPath: SandboxPath;
  token: string;
  scopes: SecretScope[];
  issuedAtMs: number;
  expiresAtMs: number;
  revoked: boolean;
}

export interface IssueLeaseRequest {
  jobId: string;
  sandboxPath: SandboxPath;
  requestedScopes: string[];
  ttlMs?: number | undefined;
}
