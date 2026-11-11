import { describe, it, expect, vi } from 'vitest';
import type { WorkflowProgressState } from '@fable/orchestrator-temporal';
import type { CodeChunk } from '@fable/retrieval-pgvector';
import {
  PostgresPersistenceStore,
  InMemoryPersistenceStore,
  type SqlExecutor,
} from '../src/index.js';

describe('Phase 14: PostgreSQL + pgvector Persistence Suite', () => {
  const sampleWorkflow: WorkflowProgressState = {
    workflowId: 'wf-pg-100',
    goalId: 'goal-pg',
    blueprintId: 'bp-pg',
    status: 'RUNNING',
    createdAt: '2026-11-11T10:00:00.000Z',
    sla24hAlertTriggered: false,
    sla48hStalePaused: false,
    nodeStates: {},
    auditLog: [],
    releasePromoted: false,
  };

  it('executes parameterized SQL upserts and pgvector cosine distance queries', async () => {
    const executedQueries: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
    const mockExecutor: SqlExecutor = {
      query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
        executedQueries.push({ sql, params });
        if (sql.includes('SELECT state_snapshot FROM fable_workflows WHERE workflow_id')) {
          return { rows: [{ state_snapshot: sampleWorkflow }] } as { rows: never[] };
        }
        if (sql.includes('ORDER BY embedding <=> $1::vector ASC')) {
          return {
            rows: [
              {
                chunk_id: 'src/auth.ts:1:5',
                file_path: 'src/auth.ts',
                start_line: 1,
                end_line: 5,
                symbol_type: 'function',
                symbol_name: 'verifyJwt',
                content: 'function verifyJwt() {}',
              },
            ],
          } as { rows: never[] };
        }
        return { rows: [] };
      }),
    };

    const pgStore = new PostgresPersistenceStore(mockExecutor);
    await pgStore.saveWorkflow(sampleWorkflow);
    expect(executedQueries[0]?.sql).toContain('ON CONFLICT (workflow_id) DO UPDATE');
    expect(executedQueries[0]?.params?.[0]).toBe('wf-pg-100');

    const loaded = await pgStore.getWorkflow('wf-pg-100');
    expect(loaded?.workflowId).toBe('wf-pg-100');

    const chunks: CodeChunk[] = [
      {
        chunkId: 'src/auth.ts:1:5',
        filePath: 'src/auth.ts',
        startLine: 1,
        endLine: 5,
        symbolType: 'function',
        symbolName: 'verifyJwt',
        content: 'function verifyJwt() {}',
        embedding: [0.1, 0.2, 0.3],
      },
    ];
    await pgStore.upsertCodeChunks('src/auth.ts', chunks);
    expect(executedQueries.some(q => q.sql.includes('DELETE FROM fable_code_chunks WHERE file_path = $1'))).toBe(true);
    expect(executedQueries.some(q => q.sql.includes('INSERT INTO fable_code_chunks'))).toBe(true);

    const similar = await pgStore.searchSimilarChunks([0.1, 0.2, 0.3], 5);
    expect(similar.length).toBe(1);
    expect(similar[0]?.symbolName).toBe('verifyJwt');
  });

  it('maintains full parity in InMemoryPersistenceStore including immutable audit events', async () => {
    const store = new InMemoryPersistenceStore();
    await store.saveWorkflow(sampleWorkflow);

    const retrieved = await store.getWorkflow('wf-pg-100');
    expect(retrieved?.status).toBe('RUNNING');

    // Append-only audit event enforcement
    await store.appendAuditEvent({
      eventId: 'evt-immutable-1',
      correlationId: 'corr-1',
      goalId: 'goal-pg',
      workflowId: 'wf-pg-100',
      eventType: 'WORKFLOW_INITIALIZED',
      actor: { type: 'SYSTEM', id: 'sys' },
      payload: { original: true },
      timestamp: new Date().toISOString(),
    });

    // Attempting to overwrite same eventId must be ignored
    await store.appendAuditEvent({
      eventId: 'evt-immutable-1',
      correlationId: 'corr-1',
      goalId: 'goal-pg',
      workflowId: 'wf-pg-100',
      eventType: 'WORKFLOW_INITIALIZED',
      actor: { type: 'SYSTEM', id: 'attacker' },
      payload: { original: false },
      timestamp: new Date().toISOString(),
    });

    const events = await store.getAuditEvents('wf-pg-100');
    expect(events.length).toBe(1);
    expect(events[0]?.payload['original']).toBe(true);

    // Vector search cosine ranking
    await store.upsertCodeChunks('a.ts', [
      {
        chunkId: 'c1',
        filePath: 'a.ts',
        startLine: 1,
        endLine: 2,
        symbolType: 'function',
        symbolName: 'fn1',
        content: 'fn1',
        embedding: [1, 0, 0],
      },
      {
        chunkId: 'c2',
        filePath: 'a.ts',
        startLine: 4,
        endLine: 6,
        symbolType: 'function',
        symbolName: 'fn2',
        content: 'fn2',
        embedding: [0, 1, 0],
      },
    ]);

    const hits = await store.searchSimilarChunks([0.9, 0.1, 0], 1);
    expect(hits.length).toBe(1);
    expect(hits[0]?.chunkId).toBe('c1');
  });
});
