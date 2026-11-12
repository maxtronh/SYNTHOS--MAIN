import type { SecretScope } from './types.js';

/**
 * Cloud Secrets Backend abstraction (Phase 3: External Integrations).
 *
 * Pluggable backend for external secret managers (HashiCorp Vault, AWS
 * Secrets Manager, GCP Secret Manager). The `SecretsBroker` issues
 * short-lived leases locally; this abstraction delegates long-term secret
 * storage/retrieval to an external provider so production credentials are
 * never embedded in the broker itself.
 */
export interface CloudSecretsBackend {
  /** Backend provider name for audit logging. */
  readonly provider: string;

  /** Retrieve a secret value by path/key. */
  getSecret(secretPath: string): Promise<string | null>;

  /** Store or rotate a secret value by path/key. */
  setSecret(secretPath: string, value: string): Promise<void>;

  /** Delete a secret by path/key. */
  deleteSecret(secretPath: string): Promise<boolean>;

  /** Check if the backend is reachable and healthy. */
  healthCheck(): Promise<boolean>;
}

/**
 * HashiCorp Vault KV v2 backend (skeleton for production wiring).
 * In production, makes HTTP calls to Vault's `/v1/secret/data/{path}`.
 */
export class VaultSecretsBackend implements CloudSecretsBackend {
  public readonly provider = 'hashicorp-vault';

  constructor(
    private readonly vaultAddr: string,
    private readonly vaultToken: string,
    private readonly mountPath = 'secret'
  ) {}

  public async getSecret(secretPath: string): Promise<string | null> {
    // Production: GET ${vaultAddr}/v1/${mountPath}/data/${secretPath}
    // with X-Vault-Token header; return data.data.value.
    void this.vaultAddr;
    void this.vaultToken;
    void this.mountPath;
    void secretPath;
    return null;
  }

  public async setSecret(secretPath: string, value: string): Promise<void> {
    // Production: POST ${vaultAddr}/v1/${mountPath}/data/${secretPath}
    void this.vaultAddr;
    void this.vaultToken;
    void this.mountPath;
    void secretPath;
    void value;
  }

  public async deleteSecret(secretPath: string): Promise<boolean> {
    // Production: DELETE ${vaultAddr}/v1/${mountPath}/metadata/${secretPath}
    void this.vaultAddr;
    void this.vaultToken;
    void this.mountPath;
    void secretPath;
    return false;
  }

  public async healthCheck(): Promise<boolean> {
    // Production: GET ${vaultAddr}/v1/sys/health
    void this.vaultAddr;
    void this.vaultToken;
    return false;
  }
}

/**
 * AWS Secrets Manager backend (skeleton for production wiring).
 * In production, uses AWS SDK GetSecretValue/PutSecretValue/DeleteSecret.
 */
export class AwsSecretsManagerBackend implements CloudSecretsBackend {
  public readonly provider = 'aws-secrets-manager';

  constructor(
    private readonly region: string,
    private readonly secretIdPrefix: string
  ) {}

  public async getSecret(secretPath: string): Promise<string | null> {
    // Production: AWS SDK GetSecretValue with SecretId = ${prefix}/${path}
    void this.region;
    void this.secretIdPrefix;
    void secretPath;
    return null;
  }

  public async setSecret(secretPath: string, value: string): Promise<void> {
    // Production: AWS SDK PutSecretValue
    void this.region;
    void this.secretIdPrefix;
    void secretPath;
    void value;
  }

  public async deleteSecret(secretPath: string): Promise<boolean> {
    // Production: AWS SDK DeleteSecret
    void this.region;
    void this.secretIdPrefix;
    void secretPath;
    return false;
  }

  public async healthCheck(): Promise<boolean> {
    // Production: AWS SDK GetSecretValue on a known health-check secret
    void this.region;
    void this.secretIdPrefix;
    return false;
  }
}

/**
 * GCP Secret Manager backend (skeleton for production wiring).
 * In production, uses @google-cloud/secret-manager AccessSecretValue etc.
 */
export class GcpSecretManagerBackend implements CloudSecretsBackend {
  public readonly provider = 'gcp-secret-manager';

  constructor(
    private readonly projectId: string,
    private readonly secretIdPrefix: string
  ) {}

  public async getSecret(secretPath: string): Promise<string | null> {
    // Production: AccessSecretValue with name = projects/${projectId}/secrets/${prefix}/${path}/versions/latest
    void this.projectId;
    void this.secretIdPrefix;
    void secretPath;
    return null;
  }

  public async setSecret(secretPath: string, value: string): Promise<void> {
    // Production: AddSecretVersion + AccessSecretValue
    void this.projectId;
    void this.secretIdPrefix;
    void secretPath;
    void value;
  }

  public async deleteSecret(secretPath: string): Promise<boolean> {
    // Production: DeleteSecret
    void this.projectId;
    void this.secretIdPrefix;
    void secretPath;
    return false;
  }

  public async healthCheck(): Promise<boolean> {
    // Production: AccessSecretValue on a known health-check secret
    void this.projectId;
    void this.secretIdPrefix;
    return false;
  }
}

export type VaultFetchFn = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Live HashiCorp Vault KV v2 HTTP backend (P36).
 * Communicates with Vault's REST API using X-Vault-Token header authentication.
 */
export class LiveVaultHttpSecretsBackend implements CloudSecretsBackend {
  public readonly provider = 'hashicorp-vault-http';
  private readonly baseUrl: string;
  private readonly fetchFn: VaultFetchFn;

  constructor(
    vaultAddr: string,
    private readonly vaultToken: string,
    private readonly mountPath = 'secret',
    options: { fetchFn?: VaultFetchFn } = {}
  ) {
    this.baseUrl = vaultAddr.replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  }

  public async getSecret(secretPath: string): Promise<string | null> {
    const res = await this.vaultRequest('GET', `/v1/${this.mountPath}/data/${secretPath}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Vault getSecret failed (${res.status})`);
    const body = (await res.json()) as { data?: { data?: { value?: string } } };
    return body.data?.data?.value ?? null;
  }

  public async setSecret(secretPath: string, value: string): Promise<void> {
    const res = await this.vaultRequest('POST', `/v1/${this.mountPath}/data/${secretPath}`, {
      data: { value },
    });
    if (!res.ok) throw new Error(`Vault setSecret failed (${res.status})`);
  }

  public async deleteSecret(secretPath: string): Promise<boolean> {
    const res = await this.vaultRequest('DELETE', `/v1/${this.mountPath}/metadata/${secretPath}`);
    return res.ok;
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const res = await this.vaultRequest('GET', '/v1/sys/health');
      return res.ok || res.status === 429 || res.status === 472;
    } catch {
      return false;
    }
  }

  private async vaultRequest(
    method: 'GET' | 'POST' | 'DELETE',
    apiPath: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        'X-Vault-Token': this.vaultToken,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    return this.fetchFn(`${this.baseUrl}${apiPath}`, init);
  }
}

export type { SecretScope };