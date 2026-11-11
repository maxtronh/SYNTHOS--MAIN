-- Fable Engine v3 — PostgreSQL + pgvector Production Schema (Phase 14)

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Durable Workflow State Mirror
CREATE TABLE IF NOT EXISTS fable_workflows (
    workflow_id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,
    blueprint_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'RUNNING', 'STALE_PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED')),
    state_snapshot JSONB NOT NULL,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    release_candidate_id TEXT,
    release_promoted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fable_workflows_status ON fable_workflows (status);

-- 2. Authoritative Gate Verdicts
CREATE TABLE IF NOT EXISTS fable_gate_verdicts (
    verdict_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES fable_workflows(workflow_id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    gate TEXT NOT NULL CHECK (gate IN ('L0', 'L1a', 'L1b', 'L3')),
    status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'DEFERRED', 'TIMEOUT', 'INFRA_ERROR')),
    sandbox_path TEXT NOT NULL CHECK (sandbox_path IN ('PATH_A_EPHEMERAL', 'PATH_B_STATEFUL')),
    execution_duration_ms INTEGER NOT NULL,
    is_authoritative BOOLEAN NOT NULL DEFAULT TRUE,
    payload JSONB NOT NULL,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fable_verdicts_wf_node ON fable_gate_verdicts (workflow_id, node_id);

-- 3. Immutable Append-Only Audit Trail
CREATE TABLE IF NOT EXISTS fable_audit_trail (
    event_id TEXT PRIMARY KEY,
    correlation_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor JSONB NOT NULL,
    payload JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fable_audit_wf ON fable_audit_trail (workflow_id, recorded_at);

-- Enforce immutability at database level (RFC Section 11)
CREATE OR REPLACE FUNCTION reject_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'fable_audit_trail is strictly append-only; UPDATE and DELETE are prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_immutable ON fable_audit_trail;
CREATE TRIGGER trg_audit_immutable
BEFORE UPDATE OR DELETE ON fable_audit_trail
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- 4. Escalated Decision Memos (3-Cycle Patch Cap)
CREATE TABLE IF NOT EXISTS fable_decision_memos (
    memo_id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    status TEXT NOT NULL,
    assigned_to TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. AST Code Chunks & pgvector Embeddings (HNSW Cosine Similarity Index)
CREATE TABLE IF NOT EXISTS fable_code_chunks (
    chunk_id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    symbol_type TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fable_chunks_embedding_hnsw
ON fable_code_chunks USING hnsw (embedding vector_cosine_ops);

-- 6. Dual Precision & Recall Ledgers
CREATE TABLE IF NOT EXISTS fable_precision_ledger (
    persona_id TEXT NOT NULL,
    cohort_id TEXT NOT NULL,
    total_proposed_tests INTEGER NOT NULL,
    verified_catching_bugs INTEGER NOT NULL,
    precision_ratio DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DOWN_SAMPLED', 'RETIRED')),
    adjudication_evidence TEXT NOT NULL,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (persona_id, cohort_id)
);

CREATE TABLE IF NOT EXISTS fable_recall_ledger (
    escape_id TEXT PRIMARY KEY,
    persona_involved TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    had_opportunity BOOLEAN NOT NULL,
    was_catchable BOOLEAN NOT NULL,
    adjudicated_by TEXT NOT NULL,
    payload JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
