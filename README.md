# Fable Engine v3

> **Deterministic, Tool-First Software Verification & Durable DAG Orchestration Platform**

Fable Engine v3 replaces legacy unconstrained voting swarms with a deterministic, tool-first verification pipeline featuring durable Temporal workflow orchestration, dual-path sandbox isolation, AST code retrieval, blast-radius dependency invalidation, and strict dual-ledger telemetry.

---

## 🏛️ Architecture Overview

The system operates across six coordinated tiers with schema-validated boundaries:

```
[ Tier 1: Architect & Meta-Reviewer ]
  └── Produces DAGBlueprint & ModuleContracts (Validated by MetaReviewer)
      └── [ Human Approval Gate (24h Alert / 48h Stale SLA) ]
          │
          ▼
[ Tier 0: Durable DAG Orchestrator (Temporal.io) ]
  ├── Manages parent/child workflow lifecycles
  ├── Enforces PASS dependency gates and cancellation propagation
  └── Bounded retries distinguishing infrastructure errors from code failures
      │
      ▼
[ Tier 2 & 3: Deterministic Builders & Gate Runner ]
  ├── Path A (Ephemeral Sandbox): Disposable container, egress allowlist (pure code)
  ├── Path B (Managed Stateful Sandbox): Dynamic temporary DB/Kafka for `stateHooks`
  └── Gates: L0 (<60s) ➔ L1a (<3m) ➔ L1b (<30m) ➔ L3 (Stateful dry-run)
      │
      ▼
[ Tier 4: AI Adversarial & Retrieval Layer ]
  ├── AST Ingestion & pgvector similarity search with bounded top-K prompt budgets
  ├── Circuit-broken LLM gateway (trips to DEFERRED, never blocks deterministic gates)
  └── Isolated patch loop capped at 3 cycles before human Decision Memo escalation
      │
      ▼
[ Tier 5: Integration, Blast-Radius Resolver & Release ]
  ├── Major-version bump detection and transitive downstream query
  ├── Idempotent BullMQ dispatch and release hold barrier
  ├── Dual precision/recall ledgers (down-sampling <50%, layer reduction <40%)
  └── Release promotion SLA (48h archival; production never auto-promoted)
```

---

## 📦 Packages in Monorepo

| Package | Path | Responsibility |
|---|---|---|
| [`@fable/contracts`](packages/contracts) | `packages/contracts` | Canonical Zod schemas (`ModuleContract`, `DAGBlueprint`, `GateVerdict`, `DecisionMemo`, `AuditTrailEvent`) and the deterministic `MetaReviewer`. |
| [`@fable/builder-deterministic`](packages/builder-deterministic) | `packages/builder-deterministic` | Generates schema-derived typed adapter code with ingress/egress validation and zero freehand LLM logic. |
| [`@fable/orchestrator-temporal`](packages/orchestrator-temporal) | `packages/orchestrator-temporal` | Temporal workflow engine, dependency PASS scheduling, cancellation trees, and human gate SLA state machines. |
| [`@fable/gate-runner`](packages/gate-runner) | `packages/gate-runner` | Dual sandbox engine (Path A Ephemeral & Path B Stateful) with L0/L1a/L1b/L3 execution budgets and cleanup guarantees. |
| [`@fable/blast-radius-resolver`](packages/blast-radius-resolver) | `packages/blast-radius-resolver` | Major-version change detection, transitive graph traversal, idempotent BullMQ re-verification dispatch, and release hold barriers. |
| [`@fable/retrieval-pgvector`](packages/retrieval-pgvector) | `packages/retrieval-pgvector` | AST chunking, cosine vector similarity, bounded prompt assembly, LLM circuit breaker, and 3-cycle patch controller. |
| [`@fable/llm-gateway`](packages/llm-gateway) | `packages/llm-gateway` | Multi-family LLM routing (Gemini, Claude, OpenAI), Tier 1 model independence validation, and adversarial persona engine. |
| [`@fable/ledger-telemetry`](packages/ledger-telemetry) | `packages/ledger-telemetry` | Dual precision/recall ledgers, human bug adjudication, and P50/P95 latency/cost metrics. |
| [`@fable/worker-bridge`](packages/worker-bridge) | `packages/worker-bridge` | Temporal-BullMQ bridge with Redis distributed idempotency locks, activity heartbeat monitoring, and DLQ handling. |
| [`@fable/persistence-postgres`](packages/persistence-postgres) | `packages/persistence-postgres` | PostgreSQL + pgvector HNSW persistence layer, SQL migrations, immutable audit triggers, and in-memory parity store. |
| [`@fable/temporal-runtime`](packages/temporal-runtime) | `packages/temporal-runtime` | Production Temporal runtime controller, worker crash recovery, and deterministic event-history replay harness. |
| [`@fable/queue-redis`](packages/queue-redis) | `packages/queue-redis` | Priority queue router (`CRITICAL`/`HIGH`/`NORMAL`) and Redis Lua atomic sliding-window backpressure limiter. |
| [`@fable/secrets-broker`](packages/secrets-broker) | `packages/secrets-broker` | Least-privilege ephemeral credential broker with hard TTL caps and guaranteed sandbox teardown revocation. |
| [`@fable/dashboard`](packages/dashboard) | `packages/dashboard` | Live Operator Control Plane HTTP server and interactive UI for human gates, DAG inspection, and Decision Memos. |
| [`@fable/cli`](packages/cli) | `packages/cli` | Fable Developer & Operator CLI (`validate`, `adapter`, `run`, `blast-radius`, `telemetry`, `dashboard`). |

---

## 📓 Interactive Google Colab Notebook

An interactive notebook implementing the entire Fable Engine v3 lifecycle is provided in the repository:
* [Fable_Engine_v3.ipynb](Fable_Engine_v3.ipynb)
* [notebooks/fable_engine_v3_master.ipynb](notebooks/fable_engine_v3_master.ipynb)

You can open and execute it directly in Google Colab or JupyterLab to interactively step through all six tiers, SLA alerts, sandboxes, and ledgers.

---

## 🚀 Quickstart

### Prerequisites
- Node.js >= 20 (v24.x recommended)
- npm >= 10

### Installation & Build

```bash
# Install workspace dependencies
npm install

# Build all packages with TypeScript compiler
npm run build

# Run test suites across the monorepo (31 tests)
npm test
```

### Running Tests for a Specific Package

```bash
npm test --workspace=@fable/contracts
npm test --workspace=@fable/orchestrator-temporal
npm test --workspace=@fable/gate-runner
npm test --workspace=@fable/blast-radius-resolver
npm test --workspace=@fable/retrieval-pgvector
npm test --workspace=@fable/ledger-telemetry
```

---

## 📑 Documentation

The complete architectural specifications are preserved under [`docs/fable-engine-v3/`](docs/fable-engine-v3):
- [Production Architecture RFC](docs/fable-engine-v3/architecture-rfc.md)
- [Operational Runbooks and Policies](docs/fable-engine-v3/operations-and-runbooks.md)
- [Implementation and Acceptance Plan](docs/fable-engine-v3/implementation-and-acceptance.md)
