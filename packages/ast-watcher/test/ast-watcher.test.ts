import { describe, it, expect, vi } from 'vitest';
import { InMemoryPersistenceStore } from '@fable/persistence-postgres';
import { AstInvalidationWatcher } from '../src/index.js';

describe('Phase 25: Real-Time AST Invalidation Watcher Suite', () => {
  it('re-indexes modified files incrementally and skips unchanged files', async () => {
    const store = new InMemoryPersistenceStore();
    const upsertSpy = vi.spyOn(store, 'upsertCodeChunks');
    const watcher = new AstInvalidationWatcher(store);

    const codeV1 = 'export function calcTotal(a: number): number { return a * 1.1; }';
    const res1 = await watcher.onFileChanged('src/pricing.ts', codeV1);
    expect(res1.action).toBe('REINDEXED');
    expect(res1.chunksUpdated).toBe(1);
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    // Same file contents again -> Must be skipped!
    const res2 = await watcher.onFileChanged('src/pricing.ts', codeV1);
    expect(res2.action).toBe('SKIPPED_UNCHANGED');
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    // File changed -> Re-indexed immediately
    const codeV2 = 'export function calcTotal(a: number): number { return a * 1.2; }';
    const res3 = await watcher.onFileChanged('src/pricing.ts', codeV2);
    expect(res3.action).toBe('REINDEXED');
    expect(upsertSpy).toHaveBeenCalledTimes(2);
  });
});
