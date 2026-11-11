# Fable Engine v3 — Disaster Recovery & Game-Day Drill Runbook

This operational runbook implements Rollout Step 6 of [`implementation-and-acceptance.md`](../docs/fable-engine-v3/implementation-and-acceptance.md).

---

## 1. Temporal Worker Crash & History Replay Drill
1. Simulate worker SIGKILL mid-DAG execution (between `node-auth` PASS and `node-orders` execution).
2. Boot replacement worker running [`TemporalRuntimeController.recoverAfterWorkerRestart`](../backend/temporal-runtime/src/workflow-runtime.ts).
3. Verify completed nodes (`PASSED`) are **not** re-executed and remaining nodes resume to `COMPLETED`.
4. Run [`ReplayDeterminismHarness.replayHistory`](../backend/temporal-runtime/src/replay-harness.ts) in CI to confirm zero state divergence.

## 2. PostgreSQL Outage & PITR Failover Procedure
1. Verify synchronous standby promotion (`pg_ctl promote`) within `RTO <= 15 minutes`.
2. Restore base snapshot + WAL replay to target recovery timestamp (`RPO <= 5 minutes`).
3. Confirm `trg_audit_immutable` trigger remains active on `fable_audit_trail`.
4. Verify vector index health on `fable_code_chunks` (`idx_fable_chunks_embedding_hnsw`).

## 3. BullMQ / Redis Outage Reconciliation
1. On Redis outage recovery, drain `PriorityQueueRouter` starting with `CRITICAL` MAJOR-bump jobs (`drainBatch`).
2. Inspect `TemporalBullMQBridge.getDLQRecords()` for exhausted retries.
3. Verify `BlastRadiusDispatcher.evaluateReleaseHold()` blocks integration until all downstream units record current-version `PASS` verdicts.

## 4. Human Gate SLA & Release Archival Verification
1. Fast-forward approval clock past `24h` -> verify alert trigger (`sla24hAlertTriggered: true`).
2. Fast-forward approval clock past `48h` -> verify `STALE_PAUSED` transition.
3. Verify unpromoted Release Candidate transitions to archived (`RELEASE_CANDIDATE_ARCHIVED`) at `48h` without auto-promotion.
