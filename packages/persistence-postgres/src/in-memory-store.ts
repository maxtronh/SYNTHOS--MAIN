import type { AuditTrailEvent, DecisionMemo, GateVerdict } from '@fable/contracts';
import type { WorkflowProgressState } from '@fable/orchestrator-temporal';
import type { CodeChunk } from '@fable/retrieval-pgvector';
import type { PersonaPrecisionRecord, ProductionEscapeRecord } from '@fable/ledger-telemetry';
import type { IPersistenceStore } from './types.js';

/**
 * Deterministic in-memory implementation of IPersistenceStore for unit testing
 * and zero-infrastructure execution parity.
 */
export class InMemoryPersistenceStore implements IPersistenceStore {
  private workflows = new Map<string, WorkflowProgressState>();
  private verdicts = new Map<string, GateVerdict>();
  private auditEvents = new Map<string, AuditTrailEvent>();
  private memos = new Map<string, DecisionMemo>();
  private chunks = new Map<string, CodeChunk>();
  private precisionRecords = new Map<string, PersonaPrecisionRecord>();
  private escapeRecords = new Map<string, ProductionEscapeRecord>();

  public async saveWorkflow(state: WorkflowProgressState): Promise<void> {
    this.workflows.set(state.workflowId, structuredClone(state));
  }

  public async getWorkflow(workflowId: string): Promise<WorkflowProgressState | null> {
    const found = this.workflows.get(workflowId);
    return found ? structuredClone(found) : null;
  }

  public async listWorkflows(): Promise<WorkflowProgressState[]> {
    return Array.from(this.workflows.values()).map(w => structuredClone(w));
  }

  public async saveVerdict(verdict: GateVerdict): Promise<void> {
    if (!this.verdicts.has(verdict.verdictId)) {
      this.verdicts.set(verdict.verdictId, structuredClone(verdict));
    }
  }

  public async getVerdictsForWorkflow(workflowId: string): Promise<GateVerdict[]> {
    return Array.from(this.verdicts.values())
      .filter(v => v.workflowId === workflowId)
      .map(v => structuredClone(v));
  }

  public async appendAuditEvent(event: AuditTrailEvent): Promise<void> {
    // Strictly append-only: ignore duplicate eventId to preserve immutability
    if (!this.auditEvents.has(event.eventId)) {
      this.auditEvents.set(event.eventId, structuredClone(event));
    }
  }

  public async getAuditEvents(workflowId: string): Promise<AuditTrailEvent[]> {
    return Array.from(this.auditEvents.values())
      .filter(e => e.workflowId === workflowId)
      .map(e => structuredClone(e));
  }

  public async saveDecisionMemo(memo: DecisionMemo): Promise<void> {
    this.memos.set(memo.memoId, structuredClone(memo));
  }

  public async listDecisionMemos(): Promise<DecisionMemo[]> {
    return Array.from(this.memos.values()).map(m => structuredClone(m));
  }

  public async upsertCodeChunks(filePath: string, chunks: CodeChunk[]): Promise<void> {
    for (const [id, chunk] of this.chunks.entries()) {
      if (chunk.filePath === filePath) {
        this.chunks.delete(id);
      }
    }
    for (const chunk of chunks) {
      this.chunks.set(chunk.chunkId, structuredClone(chunk));
    }
  }

  public async searchSimilarChunks(queryEmbedding: number[], topK: number): Promise<CodeChunk[]> {
    const scored = Array.from(this.chunks.values()).map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => structuredClone(s.chunk));
  }

  public async savePrecisionRecord(record: PersonaPrecisionRecord): Promise<void> {
    this.precisionRecords.set(`${record.personaId}:${record.cohortId}`, structuredClone(record));
  }

  public async saveEscapeRecord(escape: ProductionEscapeRecord): Promise<void> {
    if (!this.escapeRecords.has(escape.escapeId)) {
      this.escapeRecords.set(escape.escapeId, structuredClone(escape));
    }
  }

  public getEscapeRecords(): ProductionEscapeRecord[] {
    return Array.from(this.escapeRecords.values());
  }

  public getPrecisionRecords(): PersonaPrecisionRecord[] {
    return Array.from(this.precisionRecords.values());
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}
