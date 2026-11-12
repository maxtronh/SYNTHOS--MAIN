import { describe, it, expect, vi } from 'vitest';
import { LiveVaultHttpSecretsBackend, type VaultFetchFn } from '../src/index.js';

describe('P36: Live HashiCorp Vault HTTP Secrets Backend Suite', () => {
  it('stores, retrieves, deletes secrets and checks Vault sys/health via HTTP REST API', async () => {
    const kvStore = new Map<string, string>();
    const mockFetch: VaultFetchFn = vi.fn(async (url, init) => {
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Vault-Token']).toBe('hvs.token-123');

      if (url.endsWith('/v1/sys/health')) {
        return new Response(JSON.stringify({ initialized: true }), { status: 200 });
      }

      if (url.includes('/v1/secret/data/')) {
        const key = url.split('/v1/secret/data/')[1]!;
        if (init.method === 'POST') {
          const parsed = JSON.parse(String(init.body)) as { data: { value: string } };
          kvStore.set(key, parsed.data.value);
          return new Response(JSON.stringify({ data: { version: 1 } }), { status: 200 });
        }
        if (init.method === 'GET') {
          const val = kvStore.get(key);
          if (!val) return new Response('not found', { status: 404 });
          return new Response(JSON.stringify({ data: { data: { value: val } } }), { status: 200 });
        }
      }

      if (url.includes('/v1/secret/metadata/') && init.method === 'DELETE') {
        const key = url.split('/v1/secret/metadata/')[1]!;
        const existed = kvStore.delete(key);
        return new Response(null, { status: existed ? 204 : 404 });
      }

      return new Response('unexpected', { status: 500 });
    });

    const vault = new LiveVaultHttpSecretsBackend('https://vault.internal:8200/', 'hvs.token-123', 'secret', {
      fetchFn: mockFetch,
    });

    expect(await vault.healthCheck()).toBe(true);
    expect(await vault.getSecret('fable/minio')).toBeNull();

    await vault.setSecret('fable/minio', 'super-secret-value');
    expect(await vault.getSecret('fable/minio')).toBe('super-secret-value');

    expect(await vault.deleteSecret('fable/minio')).toBe(true);
    expect(await vault.getSecret('fable/minio')).toBeNull();
  });
});
