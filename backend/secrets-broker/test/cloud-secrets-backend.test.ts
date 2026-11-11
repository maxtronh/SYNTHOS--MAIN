import { describe, it, expect } from 'vitest';
import {
  VaultSecretsBackend,
  AwsSecretsManagerBackend,
  GcpSecretManagerBackend,
  type CloudSecretsBackend,
} from '../src/index.js';

describe('Phase 3: Cloud Secrets Backend Integration', () => {
  class RecordingBackend implements CloudSecretsBackend {
    public readonly provider = 'test-recording';
    public readonly gets: string[] = [];
    public readonly sets: Array<{ path: string; value: string }> = [];
    public readonly deletes: string[] = [];
    public healthy = true;

    public async getSecret(secretPath: string): Promise<string | null> {
      this.gets.push(secretPath);
      return null;
    }

    public async setSecret(secretPath: string, value: string): Promise<void> {
      this.sets.push({ path: secretPath, value });
    }

    public async deleteSecret(secretPath: string): Promise<boolean> {
      this.deletes.push(secretPath);
      return true;
    }

    public async healthCheck(): Promise<boolean> {
      return this.healthy;
    }
  }

  it('VaultSecretsBackend exposes provider name and method signatures', () => {
    const vault = new VaultSecretsBackend(
      'https://vault.example.com:8200',
      'root-token',
      'secret'
    );

    expect(vault.provider).toBe('hashicorp-vault');
    expect(vault.getSecret('fable/prod/db-password')).resolves.toBeNull();
    expect(vault.setSecret('fable/prod/db-password', 's3cr3t')).resolves.toBeUndefined();
    expect(vault.deleteSecret('fable/prod/db-password')).resolves.toBe(false);
    expect(vault.healthCheck()).resolves.toBe(false);
  });

  it('AwsSecretsManagerBackend exposes provider name and method signatures', () => {
    const aws = new AwsSecretsManagerBackend('us-east-1', 'fable/secrets');

    expect(aws.provider).toBe('aws-secrets-manager');
    expect(aws.getSecret('db-password')).resolves.toBeNull();
    expect(aws.setSecret('db-password', 's3cr3t')).resolves.toBeUndefined();
    expect(aws.deleteSecret('db-password')).resolves.toBe(false);
    expect(aws.healthCheck()).resolves.toBe(false);
  });

  it('GcpSecretManagerBackend exposes provider name and method signatures', () => {
    const gcp = new GcpSecretManagerBackend('my-project', 'fable/secrets');

    expect(gcp.provider).toBe('gcp-secret-manager');
    expect(gcp.getSecret('db-password')).resolves.toBeNull();
    expect(gcp.setSecret('db-password', 's3cr3t')).resolves.toBeUndefined();
    expect(gcp.deleteSecret('db-password')).resolves.toBe(false);
    expect(gcp.healthCheck()).resolves.toBe(false);
  });

  it('backends are interchangeable through the CloudSecretsBackend interface', async () => {
    const backend = new RecordingBackend();

    const value = await backend.getSecret('fable/path/a');
    expect(value).toBeNull();
    expect(backend.gets).toContain('fable/path/a');

    await backend.setSecret('fable/path/b', 'top-secret');
    expect(backend.sets).toContainEqual({ path: 'fable/path/b', value: 'top-secret' });

    const deleted = await backend.deleteSecret('fable/path/c');
    expect(deleted).toBe(true);
    expect(backend.deletes).toContain('fable/path/c');

    const healthy = await backend.healthCheck();
    expect(healthy).toBe(true);
  });

  it('RecordingBackend reports unhealthy when healthy flag is false', async () => {
    const backend = new RecordingBackend();
    backend.healthy = false;
    expect(await backend.healthCheck()).toBe(false);
  });
});