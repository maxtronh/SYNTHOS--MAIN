import crypto from 'crypto';
import type { IPersistenceStore } from '@fable/persistence-postgres';
import { ASTChunker } from '@fable/retrieval-pgvector';

export interface FileSyncResult {
  filePath: string;
  action: 'SKIPPED_UNCHANGED' | 'REINDEXED';
  chunksUpdated: number;
}

/**
 * Real-time AST Invalidation & Embedding Watcher Daemon.
 * Eliminates stale retrieval by incrementally re-embedding only files whose content hash changed.
 */
export class AstInvalidationWatcher {
  private readonly store: IPersistenceStore;
  private fileHashes = new Map<string, string>();

  constructor(store: IPersistenceStore) {
    this.store = store;
  }

  public async onFileChanged(filePath: string, sourceCode: string): Promise<FileSyncResult> {
    const hash = crypto.createHash('sha256').update(sourceCode, 'utf8').digest('hex');

    if (this.fileHashes.get(filePath) === hash) {
      return {
        filePath,
        action: 'SKIPPED_UNCHANGED',
        chunksUpdated: 0,
      };
    }

    const chunks = ASTChunker.chunkSource(filePath, sourceCode);
    await this.store.upsertCodeChunks(filePath, chunks);
    this.fileHashes.set(filePath, hash);

    return {
      filePath,
      action: 'REINDEXED',
      chunksUpdated: chunks.length,
    };
  }
}
