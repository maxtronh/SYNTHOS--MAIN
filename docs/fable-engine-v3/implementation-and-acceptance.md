# Fable Engine v3 — Implementation and Acceptance Plan

**Status:** Proposed execution plan for the approved architecture  
**Scope:** Documentation-only plan. No code, workflows, infrastructure, or configuration is included.

## 1. Delivery principles

- Implement the deterministic control plane and verification path before expanding autonomous AI behavior.
- Keep Temporal as the sole authoritative DAG/workflow state machine; treat BullMQ as a dispatch mechanism for explicitly queued work.
- Require versioned schemas and observable ownership at every tier boundary.
- Ship stateful-resource support only with isolated provisioning and reliable cleanup on all terminal paths.
- Release only after operational acceptance. Production promotion always requires an explicit human decision.

## 2. Recommended workstreams and exit evidence

### Workstream A — Workflow orchestration

**Deliverables:** Temporal workflow model, parent/child workflow boundaries, dependency and PASS semantics, retry/timeout/cancellation policy, persistence and recovery design.

**Exit evidence:** Demonstration that a worker restart resumes from durable history; a failed prerequisite prevents dependent execution; cancellation and cleanup behavior is recorded; duplicate activity execution does not corrupt external state.

### Workstream B — Contracts and deterministic builders

**Deliverables:** Versioned ModuleContract and DAG Blueprint schemas, schema validation policy, deterministic adapter-generation boundaries, independent meta-review and human approval records.

**Exit evidence:** Invalid or unsupported payloads are rejected at the boundary; builders are constrained to approved schemas; an approval is tied to exact contract and blueprint versions.

### Workstream C — Gate Runner and sandbox isolation

**Deliverables:** L0/L1a/L1b/L3 gate definitions, ephemeral and stateful routing policy, network/credential boundaries, resource cleanup and verdict taxonomy.

**Exit evidence:** Budgets are measured against the specified limits; pure-code jobs have no persistent volume; stateful jobs use isolated temporary resources; failure, timeout, and cancellation all exercise cleanup; infrastructure failures are distinguishable from code failures.

### Workstream D — Retrieval and AI advisory layer

**Deliverables:** AST chunking and source provenance policy, embedding/index lifecycle, bounded top-K prompt assembly, circuit-breaker and deferred-result semantics, AI patch isolation and cycle cap.

**Exit evidence:** Retrieval is bounded, relevant source chunks can be traced, stale or empty retrieval has defined behavior, gateway outage does not block permitted deterministic verification, and AI proposals cannot directly alter a protected branch.

### Workstream E — Dependency invalidation

**Deliverables:** MAJOR-version detection, authoritative downstream graph query, BullMQ dispatch/correlation/idempotency and reconciliation policy, stale-verdict release hold.

**Exit evidence:** A major contract bump identifies all downstream units; duplicate and delayed messages do not produce incorrect verdicts; queue recovery reconciles outstanding work; release remains held until required current-version checks complete.

### Workstream F — Human gates, telemetry, and release operations

**Deliverables:** SLA timers/escalations, Decision Memo policy, precision/recall measurement definitions, operational dashboards, release-candidate archival and explicit promotion policy.

**Exit evidence:** 24/48-hour approval behavior and 3-cycle/48-hour patch expiry are auditable; ledger scores expose denominators and adjudication; 48-hour unpromoted candidates are archived and halted; no automatic production promotion exists.

## 3. Acceptance checklist

### Workflow correctness

- [ ] DAG nodes execute only after all declared dependencies pass.
- [ ] A dependency failure prevents dependent work and triggers defined cancellation/cleanup.
- [ ] Workflow history survives orchestrator/worker interruption and resumes without lost state.
- [ ] Retry policies distinguish transient infrastructure faults from deterministic verification failures.

### Verification and isolation

- [ ] L0 runs on every commit and has a measured budget below 60 seconds.
- [ ] L1a runs on every merge and has a measured budget below 3 minutes.
- [ ] L1b runs asynchronously, has a maximum 30-minute budget, and blocks the next release candidate on failure without blocking developer merge velocity.
- [ ] Egress restrictions, short-lived credentials, ephemeral filesystem destruction, and stateful-resource cleanup are verified.
- [ ] Stateful dry-run artifacts cannot be interpreted as production approval.

### Retrieval and AI

- [ ] Prompt context is bounded by documented chunk and top-K limits.
- [ ] Retrieved chunks include sufficient provenance for audit and freshness validation.
- [ ] Gateway outage produces DEFERRED AI findings and does not create an implicit PASS.
- [ ] AI patch proposals are isolated, discarded on apply/L1a failure, and capped at three cycles.

### Dependency and human controls

- [ ] MAJOR contract changes re-run L0/L1a for all downstream units.
- [ ] BullMQ dispatch is idempotent and reconciled; Temporal remains authoritative for workflow/release state.
- [ ] Approval alerts at 24 hours and stale/pause/page behavior at 48 hours are verified.
- [ ] Patch expiry produces a Decision Memo after three cycles or 48 hours, whichever comes first.
- [ ] An unpromoted candidate is archived and the pipeline halted at 48 hours; production promotion is never automatic.

### Observability and release readiness

- [ ] Precision and recall ledgers retain cohort definitions, numerators, denominators, and adjudication.
- [ ] Cost per accepted module, P50/P95 latency, and blast-radius resolution time are measurable.
- [ ] Audit trail covers approvals, workflow transitions, verdicts, AI provenance, retries, cleanup, and release decisions.
- [ ] Operational owners, alert routing, retention policy, and target thresholds are documented before production rollout.

## 4. Rollout sequence

1. Agree on schema/versioning, workflow ownership, failure taxonomy, and service-level targets.
2. Validate the Temporal state model and deterministic L0/L1a path in a non-production environment.
3. Validate isolated sandbox execution and cleanup, including stateful dry-runs.
4. Introduce retrieval and AI advisory behavior behind an operationally controlled rollout; preserve deterministic fallback.
5. Enable major-version blast-radius dispatch with release holds and queue reconciliation.
6. Exercise human-gate escalations, ledger adjudication, release archival, and disaster-recovery procedures.
7. Proceed to production only after all acceptance evidence is reviewed and signed off by designated owners.

## 5. Open decisions to resolve before production

- Define exact Temporal deployment topology, availability objectives, backup/restore, and PostgreSQL recovery objectives.
- Specify BullMQ ownership, persistence/retention, dead-letter handling, and reconciliation cadence.
- Define the L3 gate catalog and module-specific budget/required verdict policy.
- Define stateful sandbox providers, resource quotas, data classification, and cleanup ownership.
- Set retrieval chunk size/top-K bounds, embedding model/version, index freshness, and retention controls.
- Establish concrete targets and alert thresholds for cost, latency, and blast-radius resolution.
- Define ledger batch sizes, bug adjudication ownership, and how confidence/uncertainty is represented.
- Name operational approvers and escalation destinations for each human gate.
