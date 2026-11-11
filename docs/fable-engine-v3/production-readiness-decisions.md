# Fable Engine v3 — Pre-Production Open Decisions Resolution (Wave 4.5)

**Status:** Resolved for Production Readiness  
**Reference:** [`implementation-and-acceptance.md`](implementation-and-acceptance.md) Section 5

---

## 1. Temporal Topology, Backup & PostgreSQL Recovery Objectives
* **Topology**: Multi-AZ Temporal Server deployment (Frontend, History, Matching, Worker services) backed by PostgreSQL 16 HA cluster (Primary + synchronous Standby replica).
* **Recovery Objectives**:
  * **RPO (Recovery Point Objective)**: `<= 5 minutes` via continuous WAL archiving to S3/MinIO.
  * **RTO (Recovery Time Objective)**: `<= 15 minutes` via automated standby promotion and [`ReplayDeterminismHarness`](../../backend/temporal-runtime/src/replay-harness.ts) verification.
* **Backup Cadence**: Automated daily base backups + continuous WAL streaming; tested monthly via [`dr-runbook.md`](../../docker-infra/dr-runbook.md).

## 2. BullMQ Ownership, Persistence, Dead-Letter & Reconciliation
* **Ownership**: Infrastructure Platform Team owns Redis Cluster + [`@fable/queue-redis`](../../backend/queue-redis) and [`@fable/worker-bridge`](../../backend/worker-bridge).
* **Persistence & Retention**: Redis AOF `appendfsync everysec`; completed job keys retained 24h (`idempotencyTtlSeconds: 86400`), DLQ records retained 14 days in `blast-radius-dlq`.
* **Reconciliation Cadence**: Every 60 seconds, workers reconcile in-flight locks (`DistributedLockManager`) and report missing terminal verdicts back to Temporal workflow state.

## 3. L3 Gate Catalog & Module Policy Matrix

| Module Category | Required Gates | Sandbox Path | Max Budget | Release Gate Semantics |
|---|---|---|---|---|
| Pure Utilities / UI / Adapters | `L0`, `L1a` | Path A (`PATH_A_EPHEMERAL`) | L0 `< 60s`, L1a `< 3m` | Blocking commit & merge |
| Core Services (`auth`, `billing`, `api`) | `L0`, `L1a`, `L1b` (Diff Mutation) | Path A (`MicroVMSandbox`) | L1b `<= 30m` (min score `75%`) | L1b failure blocks next RC |
| Stateful Migrations (`stateHooks: true`) | `L0`, `L1a`, `L3` (Dry-Run + Chaos) | Path B (`PATH_B_STATEFUL`) | L3 `<= 5m` | Dry-run validates integration only |
| Financial / Ledger State Machines | `L0`, `L1a`, `L1b`, `L3` (Chaos + Formal) | Path A + Path B | L3 Formal `<= 5m` | Zero invariant violations required |

## 4. Stateful Sandbox Providers, Quotas, Classification & Cleanup
* **Provider**: Firecracker MicroVM ([`@fable/runtime-microvm`](../../backend/runtime-microvm)) with ephemeral isolated PostgreSQL schemas (`tmp_schema_<jobId>`).
* **Resource Quotas**: Max `2` vCPU, `4 GiB` RAM, `SMT = false`, `seccompLevel >= 2`, `read-only` rootfs.
* **Data Classification**: Strictly `SYNTHETIC` / `NON-PRODUCTION` fixtures; production PII and `prod:*` credential scopes are rejected by [`SecretsBroker`](../../backend/secrets-broker/src/secrets-broker.ts).
* **Cleanup Ownership**: `GateRunner` owns guaranteed teardown (`sandbox.destroy()` + `broker.revokeAllForJob()`) inside `finally`; orphaned resource sweeps run every 15 minutes and page Platform On-Call on cleanup errors.

## 5. Retrieval Chunk Bounds, Embedding Model & Freshness
* **Bounds**: `topKDefault = 5` chunks, `maxTokensApprox = 2000` tokens per bounded prompt ([`@fable/retrieval-pgvector`](../../backend/retrieval-pgvector)).
* **Index Freshness**: Real-time SHA-256 hash watcher ([`@fable/ast-watcher`](../../backend/ast-watcher)) incrementally updates only changed symbols in `fable_code_chunks` (pgvector HNSW cosine index).
* **Retention**: Embeddings invalidated immediately on file deletion or branch merge; 30-day TTL on ephemeral branch indexes.

## 6. Concrete Operational SLO Targets & Alert Thresholds
* **Pipeline Latency**: `P50 <= 45,000 ms`, `P95 <= 180,000 ms`.
* **Cost per Accepted Module**: Target `<= $0.25 USD` (LLM + compute); [`FinOpsBudgetGovernor`](../../backend/finops-governor/src/budget-governor.ts) throttles non-critical AI advisory at `80%` budget utilization.
* **Blast-Radius Resolution Time**: `P95 <= 300,000 ms` (5 minutes) for transitive downstream re-verification.
* **Alert Routing**: Burn rate `>= 2.0x` creates Engineering Ticket; burn rate `>= 14.4x` triggers `CRITICAL_PAGE` via PagerDuty (`SloBurnRateEvaluator`).

## 7. Ledger Batch Sizes, Adjudication & Uncertainty
* **Batch / Cohort Sizes**: `50` AI-proposed tests per Precision cohort; `50` production modules or 14-day release window per Recall batch.
* **Adjudication Ownership**: Designated `Staff / Principal Engineer` adjudicates escapes within 48 hours (`Precision < 50%` triggers `DOWN_SAMPLED`; `< 30%` triggers `RETIRED`; 2 consecutive Recall batches `< 40%` shrinks AI layer).
* **Uncertainty Representation**: Degraded or timed-out AI reviews emit `DEFERRED` (never implicit `PASS`) and never override deterministic `L0`/`L1a`/`L3` verdicts.

## 8. Named Human Gate Approvers & Escalation Destinations

| Human Gate | Authorized OPA Role (`@fable/governance-opa`) | 24h Alert Target | 48h Escalation Action & Owner |
|---|---|---|---|
| **Blueprint & Contract Approval** | `SENIOR_ENGINEER` or `RELEASE_DIRECTOR` | Slack `#fable-approvals` + Requester | Mark `STALE_PAUSED` + PagerDuty `Engineering Lead` |
| **Patch-Loop Expiry (3 Cycles / 48h)** | `SENIOR_ENGINEER` or `SECURITY_LEAD` | Assigned Decision Memo Notification | Escalate unresolved `DecisionMemo` to `Staff On-Call` |
| **Critical Threat Override** | `SECURITY_LEAD` (strictly required) | Security Slack `#sec-fable-gates` | Block RC until explicit `SECURITY_LEAD` sign-off |
| **Production Release Promotion** | `RELEASE_DIRECTOR` (author self-promote blocked) | Slack `#release-candidates` | Archive RC at 48h & halt pipeline (never auto-promote) |
