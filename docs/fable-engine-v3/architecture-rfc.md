# Fable Engine v3 — Production Architecture RFC

**Status:** Approved for implementation  
**Author:** Principal Systems Architect  
**Scope:** Documentation-only architecture specification. No application code is included in this change.

## 1. Context and goals

Fable Engine v2 replaced a hallucination-prone, 3,000-agent voting swarm with a deterministic, tool-first verification pipeline. A production audit identified gaps in distributed DAG state, bounded model context, human-gate lifecycle management, stateful resource testing, AI recall measurement, and dependency-change invalidation.

Version 3 retains deterministic verification and introduces durable workflow orchestration, context-aware retrieval, isolated stateful testing, explicit operational SLAs, dependency re-verification, and precision/recall telemetry.

## 2. Architecture and trust boundaries

The system has six tiers. Inputs and outputs crossing tier boundaries must be schema-validated. Execution environments are ephemeral or isolated stateful sandboxes; AI proposals are advisory and cannot directly alter protected branches or issue final verdicts.

| Tier | Name | Responsibility |
|---|---|---|
| 0 | Distributed Orchestrator | Temporal.io owns durable DAG workflow state, dependency scheduling, retries, timeouts, cancellation, and recovery. PostgreSQL persists Temporal state. |
| 1 | Architect and Meta-Reviewer | Decomposes goals into DAG blueprints and ModuleContracts. An independent LLM family critiques contract consistency before human approval. |
| 2 | Deterministic Builders | Generates adapter code from approved JSON schemas. Builders do not introduce freehand logic. |
| 3 | Gate Runner and Execution Environment | Runs L0, L1, and L3 verification in the appropriate isolated execution environment. |
| 4 | AI Adversarial Layer | Proposes tests, threat models, and edge cases. It does not execute tests or issue final verdicts. |
| 5 | Integration and Release | Assembles verified units, runs end-to-end suites, and manages canary deployments and release promotion. |

## 3. Durable DAG orchestration

A submitted goal is decomposed into a DAG Blueprint. Temporal starts a parent workflow; each DAG node is represented by a child workflow. A node runs only after every declared dependency reports PASS. Workflow state survives worker or orchestrator-process restarts through Temporal's durable history and PostgreSQL persistence.

A failed node causes dependent, not-yet-completed work to receive cancellation; unrelated branches may continue only where the blueprint explicitly allows it. Retries, deadlines, cancellation behavior, and compensation/rollback boundaries must be declared per workflow or activity. Temporal cancellation is not a substitute for an external resource cleanup policy.

### Queue boundary

Temporal is the authoritative workflow and dependency state machine. BullMQ is retained only for explicitly asynchronous, independently retryable work such as blast-radius gate-job dispatch where a queue is operationally useful. A BullMQ message is not a second source of DAG truth: jobs must carry stable workflow/node identifiers, be idempotent, and report results back to the owning Temporal workflow. Duplicate delivery, queue outage, and reconciliation behavior must be covered by operational procedures.

## 4. Execution environments

### Path A — Ephemeral sandbox (pure code)

Used for standard TypeScript/Node modules, pure functions, and UI components. The Gate Runner starts a disposable Docker environment without persistent volumes. Network egress is allowlisted to MinIO and the LLM gateway. On completion, the container and its filesystem are destroyed. Credentials are short-lived and scoped to the job.

### Path B — Managed stateful sandbox (stateful resources)

Used for modules containing Prisma migrations, Terraform scripts, or Kafka topic definitions. A ModuleContract `stateHooks` flag selects this route. The runner provisions an isolated temporary database or equivalent resource environment, applies and verifies the change, then tears the environment down. A successful dry run promotes an artifact to integration; it does not itself authorize production application. Cleanup must run on success, failure, cancellation, and timeout.

## 5. AI context and retrieval

When a build unit is materialized, AST-based ingestion extracts functions, interfaces, and type definitions. Code-specific embeddings and chunks are stored in pgvector. The persona-broker retrieves top-K relevant chunks using the function or interface under review, then assembles a bounded prompt. Retrieval must retain source identifiers so findings can be traced to the relevant code boundary. The system must define chunk limits, top-K limits, freshness/invalidation rules, and behavior when retrieval is empty or stale.

## 6. Verification pipeline and gates

| Gate | Mode | Tools and checks | Budget | Policy |
|---|---|---|---|---|
| L0 | Synchronous, blocking | Strict `tsc`, ESLint, Semgrep, Zod conformance | Under 60 seconds | Runs on every commit; any failure fails the build. |
| L1a | Synchronous, blocking | Vitest, fast-check, coverage budgets, madge cycle detection | Under 3 minutes | Runs on every merge; verifies basic logic and contract compliance. |
| L1b | Asynchronous, non-blocking | StrykerJS mutation testing and fuzzing | Up to 30 minutes | Runs nightly or on incremental changes. Failure blocks the next release candidate, not developer merge velocity. |
| L3 | Gate Runner phase | Defined by the applicable module contract and release policy | Contract-defined | Executed in the appropriate sandbox; verdicts are deterministic and recorded. |

A deferred AI result is not a passing or failing deterministic gate. LLM availability must not prevent the deterministic L0/L1a/L3 path from completing, where applicable.

## 7. Contract changes and blast radius

The verdict-store monitors ModuleContract version changes. On a MAJOR version bump, the Blast Radius Resolver queries the dependency graph for all downstream units and dispatches L0 and L1a re-verification jobs through BullMQ. Jobs must be deduplicated and correlated to the contract version that triggered them. Results are returned to the authoritative workflow/verdict store. The release policy must prevent integration or release from treating stale downstream verdicts as current.

## 8. Human gates and SLAs

| Gate | SLA and action |
|---|---|
| Contract and DAG approval | At 24 hours, send Slack/PagerDuty alert. At 48 hours, mark the DAG STALE, pause execution, and page the engineering lead. |
| Patch loop expiry | After three unsuccessful cycles or 48 hours, whichever occurs first, generate a Decision Memo containing diff history and error logs and assign it to a senior engineer. |
| Release promotion | At 48 hours without promotion, archive the Release Candidate and halt the pipeline. Production is never auto-promoted. |

All timers, notifications, escalation ownership, pause/resume behavior, and audit events must be visible to operators. Human approval must be explicit, attributable, and bound to the exact artifact/contract version reviewed.

## 9. Telemetry and dual ledger

### Precision ledger

Track the ratio of AI-proposed tests that catch real, reproducible bugs to the total AI-proposed tests, with the measurement cohort and adjudication method recorded. Personas below 50% precision are down-sampled or retired according to an auditable policy.

### Recall ledger

For each production escape, record whether the AI layer had a reasonable opportunity to detect it during verification. A critical missed edge case judged catchable by a human reduces the applicable persona's recall score. If recall is below 40% for two consecutive batches, shrink the AI layer according to a documented policy.

### Operational metrics

Track cost per accepted module (LLM plus compute), pipeline latency at P50 and P95, and blast-radius resolution time. Metrics must be attributable to workflow, module, gate, and model/persona as applicable. Precision/recall decisions require documented denominators, batch definitions, and human adjudication to avoid misleading scores.

## 10. Failure modes and mitigations

| Failure | Impact | Required mitigation |
|---|---|---|
| Temporal outage | DAG execution pauses | Use Temporal high availability and durable persistence. Buffer incoming submissions in a dead-letter/retry mechanism; reconcile and resume after recovery without losing workflow state. |
| LLM gateway outage/latency | Tier 4 stalls | Circuit-break persona requests. Continue deterministic gates where policy permits; mark AI findings DEFERRED and process later. |
| Stateful sandbox lock/contention | Migration dry-run fails | Isolate temporary resources per job. Distinguish syntax/contract failures from infrastructure verdicts and ensure teardown. |
| Invalid AI patch | Build may break | Apply proposals only in an ephemeral container. Discard patches that fail to apply or fail L1a. Never let AI mutate the main branch. Cap at three cycles before human escalation. |

## 11. Security and audit requirements

- Validate ModuleContracts, DAG blueprints, gate results, and cross-tier messages against versioned schemas.
- Apply least privilege, short-lived credentials, and explicit network allowlists to both sandbox paths.
- Do not expose production credentials or persistent production data to test environments or model prompts.
- Preserve immutable audit records for approvals, workflow transitions, verdicts, AI proposals, retrieval provenance, retries, cancellation, and release decisions.
- Treat retrieved source and model-generated content as untrusted input; deterministic gates remain authoritative.

## 12. Implementation completion criteria

The architecture is ready for production acceptance when the operational scenarios and measurable criteria in [the implementation and acceptance plan](implementation-and-acceptance.md) pass, including worker restart/replay, dependency cancellation, queue duplicate/recovery, stateful cleanup, bounded retrieval, human-gate expiry, and release hold behavior.
