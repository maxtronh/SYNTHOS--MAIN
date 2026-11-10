# Fable Engine v3 — Operational Runbooks and Policies

**Status:** Approved design policy  
**Scope:** Documentation-only. These procedures define expected operations; they do not implement services or automation.

## 1. Workflow lifecycle

1. Receive a goal and record its owner, requested scope, and correlation identifier.
2. Tier 1 creates a DAG Blueprint and versioned ModuleContracts.
3. An independent meta-review critiques contract consistency; findings are resolved or documented.
4. A human approves the exact blueprint and contract versions. The 24-hour approval timer starts when the request becomes actionable.
5. Temporal starts the parent workflow and child workflows for nodes. Dependencies gate execution on PASS.
6. Tier 2 produces schema-derived adapters. Tier 3 routes each module to its declared sandbox and runs the required gates.
7. Tier 4 may asynchronously provide advisory findings. Its outage or delay is recorded as DEFERRED and does not become an implicit PASS.
8. Tier 5 integrates eligible artifacts, runs end-to-end verification, and creates a release candidate.
9. A human explicitly approves release promotion. No workflow automatically promotes to production.

## 2. Failure, retry, and cancellation policy

- Workflow and activity timeouts must be explicit and observable; do not rely on indefinite waits.
- Retries must be bounded and limited to transient failures. Deterministic test failures are not retried as if they were infrastructure faults.
- When a dependency fails, cancel dependent work that has not started. For already-running activities, issue cancellation and execute cleanup/compensation where supported.
- Preserve the original failure category and retry history. Never overwrite a failure with a later retry success without retaining both events.
- On worker restart, confirm Temporal replay resumes from durable history and that activities with external side effects are idempotent or safely reconciled.

## 3. Sandbox handling

### Ephemeral code jobs

- Create one disposable environment per job; do not mount persistent host volumes.
- Permit egress only to approved MinIO and LLM gateway endpoints required by the job.
- Scope credentials to the job and revoke them on completion.
- Destroy the container and local filesystem on success, failure, timeout, and cancellation.

### Stateful-resource jobs

- Require `stateHooks` and an explicit resource/migration contract before provisioning.
- Provision isolated temporary resources per job; never share mutable schemas between concurrent jobs.
- Capture migration and verification outcomes without copying sensitive production data into the sandbox.
- Tear down resources on every terminal path. Record cleanup failures separately and alert operators; failed cleanup must not be reported as a successful job.
- Promote only the validated artifact to integration. Dry-run success is not production authorization.

## 4. Blast-radius re-verification

On a MAJOR ModuleContract version bump:

1. Record the old and new contract versions and identify the triggering change.
2. Resolve all transitive downstream units from the authoritative dependency graph.
3. Dispatch idempotent L0/L1a jobs through BullMQ with stable identifiers and contract-version correlation.
4. Record each job's queued, started, and terminal state; reconcile jobs after queue outages or duplicate delivery.
5. Update the verdict store only with results matching the relevant downstream unit and triggering contract version.
6. Hold integration/release if any required downstream verdict is missing, failed, or stale.

Temporal remains authoritative for DAG lifecycle and release eligibility. BullMQ is dispatch infrastructure, not a second dependency-state database.

## 5. Human-gate escalation

### Contract and DAG approval

- Start the 24-hour clock once an approval request is complete and available to the reviewer.
- At 24 hours, notify the requester and reviewer through Slack/PagerDuty.
- At 48 hours, mark the DAG STALE, pause execution, and page the engineering lead.
- Resume only after an authorized person reviews and approves the current versions; edits that change the reviewed scope require a new approval.

### Patch-loop expiry

- Limit automated patch attempts to three cycles.
- At three failed cycles or 48 hours, whichever occurs first, stop automated patching.
- Produce a Decision Memo with the diff history, gate output, relevant logs, and unresolved questions; assign it to a senior engineer.
- Keep all proposed patches isolated. A discarded proposal must not modify the main branch.

### Release promotion

- Require explicit, attributable approval of the release candidate and its verification evidence.
- At 48 hours without promotion, archive the candidate and halt the pipeline.
- Revalidate an archived candidate before any later promotion if its dependencies or verification inputs have changed.
- Never auto-promote to production.

## 6. LLM gateway degradation

When latency or availability breaches its configured threshold, the persona-broker trips its circuit breaker and marks outstanding AI findings DEFERRED. Continue deterministic gates only where the module and release policy allow. On recovery, process deferred requests against current source/contract versions; discard or re-run stale requests. AI output remains advisory and cannot override deterministic verdicts.

## 7. Ledger review policy

- Review precision and recall by defined persona and batch, retaining numerator, denominator, cohort, and adjudication evidence.
- Precision below 50% triggers documented down-sampling or retirement.
- Recall below 40% for two consecutive batches triggers documented reduction of the AI layer.
- A production escape is included in recall evaluation only after recording whether the AI layer had an opportunity to detect it and whether the edge case was reasonably catchable.
- Alert on cost per accepted module, P50/P95 pipeline latency, and blast-radius resolution time against operational targets approved by the service owner.

## 8. Required audit trail

Record goal and workflow IDs; DAG and contract versions; approvals; node dependencies and state transitions; gate inputs and outputs; sandbox route and cleanup result; retry/cancellation history; AI model/persona and retrieval provenance; deferred findings; queue correlation and reconciliation; ledger adjudications; release-candidate status; and promotion decision. Logs and artifacts must follow the organization's retention and access-control policy.
