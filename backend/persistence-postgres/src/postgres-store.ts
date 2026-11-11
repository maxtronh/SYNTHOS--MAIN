import type { AuditTrailEvent, DecisionMemo, GateVerdict } from '@fable/contracts';
import type { WorkflowProgressState } from '@fable/orchestrator-temporal';
import type { CodeChunk } from '@fable/retrieval-pgvector';
import type { PersonaPrecisionRecord, ProductionEscapeRecord } from '@fable/ledger-telemetry';
import type { IPersistenceStore, SqlExecutor } from './types.js';

/**
 * PostgreSQL + pgvector implementation of IPersistenceStore.
 * Uses strictly parameterized SQL queries and idempotent upserts.
 */
export class PostgresPersistenceStore implements IPersistenceStore {
  private readonly sql: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.sql = executor;
  }

  /**
   * Persists or updates durable workflow snapshot.
   */
  public async saveWorkflow(state: WorkflowProgressState): Promise<void> {
    const query = `
      INSERT INTO fable_workflows (
        workflow_id, goal_id, blueprint_id, status, state_snapshot,
        approved_by, approved_at, release_candidate_id, release_promoted, updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, NOW())
      ON CONFLICT (workflow_id) DO UPDATE SET
        status = EXCLUDED.status,
        state_snapshot = EXCLUDED.state_snapshot,
        approved_by = EXCLUDED.approved_by,
        approved_at = EXCLUDED.approved_at,
        release_candidate_id = EXCLUDED.release_candidate_id,
        release_promoted = EXCLUDED.release_promoted,
        updated_at = NOW();
    `;

    await this.sql.query(query, [
      state.workflowId,
      state.goalId,
      state.blueprintId,
      state.status,
      JSON.stringify(state),
      state.approvedBy ?? null,
      state.approvedAt ?? null,
      state.releaseCandidateId ?? null,
      state.releasePromoted,
    ]);
  }

  public async getWorkflow(workflowId: string): Promise<WorkflowProgressState | null> {
    const res = await this.sql.query<{ state_snapshot: WorkflowProgressState }>(
      'SELECT state_snapshot FROM fable_workflows WHERE workflow_id = $1 LIMIT 1;',
      [workflowId]
    );
    return res.rows[0]?.state_snapshot ?? null;
  }

  public async listWorkflows(): Promise<WorkflowProgressState[]> {
    const res = await this.sql.query<{ state_snapshot: WorkflowProgressState }>(
      'SELECT state_snapshot FROM fable_workflows ORDER BY created_at DESC;'
    );
    return res.rows.map(r => r.state_snapshot);
  }

  public async saveVerdict(verdict: GateVerdict): Promise<void> {
    const query = `
      INSERT INTO fable_gate_verdicts (
        verdict_id, workflow_id, node_id, contract_id, contract_version,
        gate, status, sandbox_path, execution_duration_ms, is_authoritative, payload, evaluated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      ON CONFLICT (verdict_id) DO NOTHING;
    `;

    await this.sql.query(query, [
      verdict.verdictId,
      verdict.workflowId,
      verdict.nodeId,
      verdict.contractId,
      verdict.contractVersion,
      verdict.gate,
      verdict.status,
      verdict.sandboxPath,
      verdict.executionDurationMs,
      verdict.isAuthoritative,
      JSON.stringify(verdict),
      verdict.evaluatedAt,
    ]);
  }

  public async getVerdictsForWorkflow(workflowId: string): Promise<GateVerdict[]> {
    const res = await this.sql.query<{ payload: GateVerdict }>(
      'SELECT payload FROM fable_gate_verdicts WHERE workflow_id = $1 ORDER BY evaluated_at ASC;',
      [workflowId]
    );
    return res.rows.map(r => r.payload);
  }

  /**
   * Append-only audit log insertion; updates/deletes are blocked by DB trigger.
   */
  public async appendAuditEvent(event: AuditTrailEvent): Promise<void> {
    const query = `
      INSERT INTO fable_audit_trail (
        event_id, correlation_id, goal_id, workflow_id, event_type, actor, payload, recorded_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
      ON CONFLICT (event_id) DO NOTHING;
    `;

    await this.sql.query(query, [
      event.eventId,
      event.correlationId,
      event.goalId,
      event.workflowId,
      event.eventType,
      JSON.stringify(event.actor),
      JSON.stringify(event.payload),
      event.timestamp,
    ]);
  }

  public async getAuditEvents(workflowId: string): Promise<AuditTrailEvent[]> {
    const res = await this.sql.query<{
      event_id: string;
      correlation_id: string;
      goal_id: string;
      workflow_id: string;
      event_type: AuditTrailEvent['eventType'];
      actor: AuditTrailEvent['actor'];
      payload: Record<string, unknown>;
      recorded_at: string;
    }>(
      `SELECT event_id, correlation_id, goal_id, workflow_id, event_type, actor, payload, recorded_at
       FROM fable_audit_trail WHERE workflow_id = $1 ORDER BY recorded_at ASC;`,
      [workflowId]
    );

    return res.rows.map(row => ({
      eventId: row.event_id,
      correlationId: row.correlation_id,
      goalId: row.goal_id,
      workflowId: row.workflow_id,
      eventType: row.event_type,
      actor: row.actor,
      payload: row.payload,
      timestamp: row.recorded_at,
    }));
  }

  public async saveDecisionMemo(memo: DecisionMemo): Promise<void> {
    const query = `
      INSERT INTO fable_decision_memos (
        memo_id, goal_id, workflow_id, node_id, status, assigned_to, payload, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (memo_id) DO UPDATE SET
        status = EXCLUDED.status,
        assigned_to = EXCLUDED.assigned_to,
        payload = EXCLUDED.payload;
    `;

    await this.sql.query(query, [
      memo.memoId,
      memo.goalId,
      memo.workflowId,
      memo.nodeId,
      memo.status,
      memo.assignedTo,
      JSON.stringify(memo),
      memo.createdAt,
    ]);
  }

  public async listDecisionMemos(): Promise<DecisionMemo[]> {
    const res = await this.sql.query<{ payload: DecisionMemo }>(
      'SELECT payload FROM fable_decision_memos ORDER BY created_at DESC;'
    );
    return res.rows.map(r => r.payload);
  }

  /**
   * Replaces stale AST chunks for a modified file atomically.
   */
  public async upsertCodeChunks(filePath: string, chunks: CodeChunk[]): Promise<void> {
    await this.sql.query('DELETE FROM fable_code_chunks WHERE file_path = $1;', [filePath]);

    const insertQuery = `
      INSERT INTO fable_code_chunks (
        chunk_id, file_path, start_line, end_line, symbol_type, symbol_name, content, embedding
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
      ON CONFLICT (chunk_id) DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        updated_at = NOW();
    `;

    for (const chunk of chunks) {
      const vectorLiteral = `[${chunk.embedding.join(',')}]`;
      await this.sql.query(insertQuery, [
        chunk.chunkId,
        chunk.filePath,
        chunk.startLine,
        chunk.endLine,
        chunk.symbolType,
        chunk.symbolName,
        chunk.content,
        vectorLiteral,
      ]);
    }
  }

  /**
   * Executes HNSW cosine distance search (`<=>` operator in pgvector).
   */
  public async searchSimilarChunks(queryEmbedding: number[], topK: number): Promise<CodeChunk[]> {
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const query = `
      SELECT chunk_id, file_path, start_line, end_line, symbol_type, symbol_name, content
      FROM fable_code_chunks
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $2;
    `;

    const res = await this.sql.query<{
      chunk_id: string;
      file_path: string;
      start_line: number;
      end_line: number;
      symbol_type: CodeChunk['symbolType'];
      symbol_name: string;
      content: string;
    }>(query, [vectorLiteral, topK]);

    return res.rows.map(r => ({
      chunkId: r.chunk_id,
      filePath: r.file_path,
      startLine: r.start_line,
      endLine: r.end_line,
      symbolType: r.symbol_type,
      symbolName: r.symbol_name,
      content: r.content,
      embedding: [], // Omitted from projection to minimize payload overhead
    }));
  }

  public async savePrecisionRecord(record: PersonaPrecisionRecord): Promise<void> {
    const query = `
      INSERT INTO fable_precision_ledger (
        persona_id, cohort_id, total_proposed_tests, verified_catching_bugs,
        precision_ratio, status, adjudication_evidence, evaluated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (persona_id, cohort_id) DO UPDATE SET
        precision_ratio = EXCLUDED.precision_ratio,
        status = EXCLUDED.status,
        adjudication_evidence = EXCLUDED.adjudication_evidence,
        evaluated_at = EXCLUDED.evaluated_at;
    `;

    await this.sql.query(query, [
      record.personaId,
      record.cohortId,
      record.totalProposedTests,
      record.verifiedCatchingBugs,
      record.precisionRatio,
      record.status,
      record.adjudicationEvidence,
      record.evaluatedAt,
    ]);
  }

  public async saveEscapeRecord(escape: ProductionEscapeRecord): Promise<void> {
    const query = `
      INSERT INTO fable_recall_ledger (
        escape_id, persona_involved, batch_id, had_opportunity,
        was_catchable, adjudicated_by, payload, recorded_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (escape_id) DO NOTHING;
    `;

    await this.sql.query(query, [
      escape.escapeId,
      escape.personaInvolved,
      escape.batchId,
      escape.hadOpportunityToDetect,
      escape.wasReasonablyCatchable,
      escape.adjudicatedBy,
      JSON.stringify(escape),
      escape.timestamp,
    ]);
  }
}
