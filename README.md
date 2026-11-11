# Fable Engine v3

> **Deterministic, Tool-First Software Verification & Durable DAG Orchestration Platform**

Fable Engine v3 replaces legacy unconstrained voting swarms with a deterministic, tool-first verification pipeline featuring durable Temporal workflow orchestration, hardware-isolated MicroVM & stateful sandboxes, eBPF runtime auditing, Ed25519 SLSA provenance, AST code retrieval, cross-repo blast-radius invalidation, and dual-ledger telemetry across **29 implemented phases**.

---

## 📁 Repository Folder Alignment

```text
SYNTHOS--MAIN/
├── backend/                   # 27 Backend orchestration, sandbox, AI, queue, security & CLI packages
├── frontend/                  # Frontend client SDK (@fable/web-console) & IDE extension (@fable/ide-companion)
├── ui/                        # Standalone Operator Control Plane UI (HTML, CSS, JS)
├── docker-infra/              # Dockerfiles (Path A & Path B), docker-compose.yml, production config
├── mermaid-diagrams/          # Mermaid (.mmd) definitions, rendered PNG/SVG images & architectural guides
├── notebooks/                 # Interactive Google Colab walkthrough notebook
├── test/                      # Master Acceptance Checklist verification suite
└── docs/                      # Approved Fable Engine v3 RFC, Runbooks, and Acceptance Plan
```

---

## 📊 Architecture Diagrams

All visual system architectures, sequence flows, security boundaries, and wave execution diagrams are available as `.mmd` sources, `.png`/`.svg` images, and detailed explanations in [`mermaid-diagrams/`](mermaid-diagrams/README.md).

---

## ⚙️ Backend Packages (`backend/`)

| Package | Path | Responsibility |
|---|---|---|
| [`@fable/contracts`](backend/contracts) | `backend/contracts` | Canonical Zod schemas (`ModuleContract`, `DAGBlueprint`, `GateVerdict`, `DecisionMemo`, `AuditTrailEvent`) and `MetaReviewer`. |
| [`@fable/builder-deterministic`](backend/builder-deterministic) | `backend/builder-deterministic` | Generates schema-derived typed adapter code with zero freehand LLM logic. |
| [`@fable/orchestrator-temporal`](backend/orchestrator-temporal) | `backend/orchestrator-temporal` | Durable DAG state machine, dependency `PASS` gating, cancellation trees, and 24h/48h human gate SLAs. |
| [`@fable/temporal-runtime`](backend/temporal-runtime) | `backend/temporal-runtime` | Production Temporal runtime controller, worker crash recovery, and deterministic event-history replay harness. |
| [`@fable/gate-runner`](backend/gate-runner) | `backend/gate-runner` | Dual sandbox engine (Path A Ephemeral & Path B Stateful) with L0/L1a/L1b/L3 execution budgets and cleanup guarantees. |
| [`@fable/runtime-microvm`](backend/runtime-microvm) | `backend/runtime-microvm` | Hardware-isolated Firecracker / gVisor MicroVM sandbox manifest builder with read-only rootfs and memory wiping. |
| [`@fable/ebpf-auditor`](backend/ebpf-auditor) | `backend/ebpf-auditor` | Real-time eBPF kernel syscall filter, cloud metadata SSRF blocker, and egress allowlist auditor. |
| [`@fable/secrets-broker`](backend/secrets-broker) | `backend/secrets-broker` | Least-privilege ephemeral credential broker with hard TTL caps and guaranteed sandbox teardown revocation. |
| [`@fable/attestation-slsa`](backend/attestation-slsa) | `backend/attestation-slsa` | SLSA v1.0 provenance generator and Ed25519 cryptographic signing authority guarding production promotion. |
| [`@fable/blast-radius-resolver`](backend/blast-radius-resolver) | `backend/blast-radius-resolver` | Major-version change detection, transitive graph traversal, and release hold barriers. |
| [`@fable/scip-graph`](backend/scip-graph) | `backend/scip-graph` | Cross-repo compiler-accurate SCIP semantic symbol graph feeding blast-radius detection. |
| [`@fable/queue-redis`](backend/queue-redis) | `backend/queue-redis` | Priority queue router (`CRITICAL`/`HIGH`/`NORMAL`) and Redis Lua atomic sliding-window backpressure limiter. |
| [`@fable/worker-bridge`](backend/worker-bridge) | `backend/worker-bridge` | Temporal-BullMQ bridge with distributed idempotency locks, heartbeat monitoring, and DLQ handling. |
| [`@fable/persistence-postgres`](backend/persistence-postgres) | `backend/persistence-postgres` | PostgreSQL + pgvector HNSW persistence layer, SQL migrations, and immutable append-only audit triggers. |
| [`@fable/retrieval-pgvector`](backend/retrieval-pgvector) | `backend/retrieval-pgvector` | AST chunking, cosine similarity retrieval, bounded prompt assembly, circuit breaker, and 3-cycle patch controller. |
| [`@fable/ast-watcher`](backend/ast-watcher) | `backend/ast-watcher` | Real-time SHA-256 content-hash AST invalidation and incremental vector embedding watcher. |
| [`@fable/llm-gateway`](backend/llm-gateway) | `backend/llm-gateway` | Multi-family LLM routing (Gemini, Claude, OpenAI), Tier 1 independence validation, and adversarial personas. |
| [`@fable/self-healing`](backend/self-healing) | `backend/self-healing` | Production-escape golden regression lock generator and cost-aware adaptive multi-model router. |
| [`@fable/verification-advanced`](backend/verification-advanced) | `backend/verification-advanced` | Diff-scoped StrykerJS mutation engine (`L1b`), stateful chaos fault injector (`L3`), and formal state-space verifier. |
| [`@fable/ledger-telemetry`](backend/ledger-telemetry) | `backend/ledger-telemetry` | Dual precision/recall ledgers, human bug adjudication, and P50/P95 latency/cost metrics. |
| [`@fable/observability-otel`](backend/observability-otel) | `backend/observability-otel` | W3C TraceContext propagator, distributed span tracer, and SRE SLO error-budget burn-rate evaluator. |
| [`@fable/governance-opa`](backend/governance-opa) | `backend/governance-opa` | Multi-tenant RBAC, SSO verification, and separation-of-duties OPA policy evaluator. |
| [`@fable/finops-governor`](backend/finops-governor) | `backend/finops-governor` | FinOps token & sandbox compute budget enforcer throttling optional AI spend before deterministic gates. |
| [`@fable/canary-rollout`](backend/canary-rollout) | `backend/canary-rollout` | Progressive canary traffic shifter and automated SLO-triggered rollback controller guarded by SLSA signatures. |
| [`@fable/gitops-pr-bot`](backend/gitops-pr-bot) | `backend/gitops-pr-bot` | Bidirectional GitHub/GitLab webhook verifier and Mermaid DAG PR Check Run formatter. |
| [`@fable/dashboard`](backend/dashboard) | `backend/dashboard` | Live Operator Control Plane HTTP server serving [`ui/operator-console`](ui/operator-console) and REST APIs. |
| [`@fable/cli`](backend/cli) | `backend/cli` | Fable Developer & Operator CLI (`validate`, `adapter`, `run`, `blast-radius`, `telemetry`, `dashboard`). |

---

## 💻 Frontend & UI (`frontend/` & `ui/`)

| Component | Path | Responsibility |
|---|---|---|
| [`@fable/web-console`](frontend/web-console) | `frontend/web-console` | Strongly-typed Frontend API Client SDK for workflows, approvals, promotion, and telemetry. |
| [`@fable/ide-companion`](frontend/ide-companion) | `frontend/ide-companion` | IDE extension backend providing contract hints, SCIP blast-radius heatmaps, and 1-click local sandbox dry-runs. |
| [`Operator Console UI`](ui/operator-console/index.html) | `ui/operator-console` | Standalone dark-mode HTML/CSS/JS Control Plane console served by `@fable/dashboard`. |

---

## 🐳 Docker Infrastructure (`docker-infra/`)

* [`docker-compose.yml`](docker-infra/docker-compose.yml) — Local Temporal, PostgreSQL, Redis, and MinIO stack (`docker compose -f docker-infra/docker-compose.yml up`).
* [`sandbox-ephemeral/Dockerfile`](docker-infra/sandbox-ephemeral/Dockerfile) — Path A unprivileged ephemeral container.
* [`sandbox-stateful/Dockerfile`](docker-infra/sandbox-stateful/Dockerfile) — Path B isolated PostgreSQL/Prisma dry-run container.
* [`config/fable.config.json`](docker-infra/config/fable.config.json) — Production topology, SLA thresholds, sandbox quotas, and multi-family AI settings.

---

## 🚀 Quickstart

```bash
# Install and link all backend & frontend workspaces
npm install

# Compile all 29 workspace packages
npm run build

# Run all workspace unit tests + Master Acceptance Checklist
npm test
npm run test:acceptance

# Launch Operator Control Plane UI (http://localhost:3000)
node backend/cli/dist/bin.js dashboard --port 3000
```
