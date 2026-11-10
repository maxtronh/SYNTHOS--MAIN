# Fable Engine v3 — Documentation Index

This directory contains the documentation-only production architecture package for Fable Engine v3. It does not include application code or infrastructure configuration.

- [Production Architecture RFC](architecture-rfc.md) — system tiers, trust boundaries, DAG orchestration, execution environments, retrieval, gates, blast-radius resolution, SLAs, telemetry, security, and failure mitigations.
- [Operational Runbooks and Policies](operations-and-runbooks.md) — workflow lifecycle, retry/cancellation behavior, sandbox handling, dependency re-verification, human escalation, LLM degradation, ledger review, and audit records.
- [Implementation and Acceptance Plan](implementation-and-acceptance.md) — workstreams, exit evidence, acceptance checklist, rollout sequence, and decisions required before production.

**Authority note:** Temporal is the authoritative workflow/DAG state machine. BullMQ is used only for idempotent asynchronous dispatch such as blast-radius gate jobs; it is not a second source of dependency or release state. Production promotion always requires explicit human approval.
