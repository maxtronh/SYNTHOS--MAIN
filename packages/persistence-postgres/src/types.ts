import type { AuditTrailEvent, DecisionMemo, GateVerdict } from '@fable/contracts';
import type { WorkflowProgressState } from '@fable/orchestrator-temporal';
import type { CodeChunk } from '@fable/retrieval-pgvector';
import type { PersonaPrecisionRecord, ProductionEscapeRecord } from '@fable/ledger-telemetry';

/**
 * Abstract SQL execution engine compatible with node-postgres (`pg.Pool`) or test mocks.
 */
export interface SqlExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ rows: Row[] }>;
}

/**
 * Unified persistence contract shared by PostgreSQL and In-Memory stores.
 */
export interface IPersistenceStore {
  saveWorkflow(state: WorkflowProgressState): Promise<void>;
  getWorkflow(workflowId: string): Promise<WorkflowProgressState | null>;
  listWorkflows(): Promise<WorkflowProgressState[]>;

  saveVerdict(verdict: GateVerdict): Promise<void>;
  getVerdictsForWorkflow(workflowId: string): Promise<GateVerdict[]>;

  appendAuditEvent(event: AuditTrailEvent): Promise<void>;
  getAuditEvents(workflowId: string): Promise<AuditTrailEvent[]>;

  saveDecisionMemo(memo: DecisionMemo): Promise<void>;
  listDecisionMemos(): Promise<DecisionMemo[]>;

  upsertCodeChunks(filePath: string, chunks: CodeChunk[]): Promise<void>;
  searchSimilarChunks(queryEmbedding: number[], topK: number): Promise<CodeChunk[]>;

  savePrecisionRecord(record: PersonaPrecisionRecord): Promise<void>;
  saveEscapeRecord(escape: ProductionEscapeRecord): Promise<void>;
}
