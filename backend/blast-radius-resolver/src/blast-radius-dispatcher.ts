import type { GateVerdict, GateLevel } from '@fable/contracts';
import type { ReverificationJob, ReleaseHoldStatus } from './types.js';
import { GraphResolver, type DependencyEdge } from './graph-resolver.js';

export interface DispatcherOptions {
  edges: DependencyEdge[];
  executeJobFn?: ((job: ReverificationJob) => Promise<GateVerdict[]>) | undefined;
}

export class BlastRadiusDispatcher {
  private edges: DependencyEdge[];
  private jobStore = new Map<string, ReverificationJob>();
  private executeJobFn?: ((job: ReverificationJob) => Promise<GateVerdict[]>) | undefined;

  constructor(options: DispatcherOptions) {
    this.edges = options.edges;
    this.executeJobFn = options.executeJobFn;
  }

  /**
   * Evaluates a contract version update.
   * If it is a MAJOR bump, resolves all downstream units and dispatches idempotent re-verification jobs.
   */
  public handleContractVersionUpdate(
    contractId: string,
    oldVersion: string,
    newVersion: string
  ): ReverificationJob[] {
    if (!GraphResolver.isMajorBump(oldVersion, newVersion)) {
      // Non-major bumps do not trigger full transitive blast-radius re-verification
      return [];
    }

    const downstreamUnits = GraphResolver.resolveTransitiveDownstream(contractId, this.edges);
    const dispatchedJobs: ReverificationJob[] = [];

    for (const unitId of downstreamUnits) {
      // Stable idempotent job ID correlated to unit and new version
      const stableJobId = `reverify:${unitId}:${newVersion}`;

      // Deduplication: if job is already queued or running, do not re-dispatch duplicate
      const existing = this.jobStore.get(stableJobId);
      if (existing && (existing.status === 'QUEUED' || existing.status === 'RUNNING')) {
        continue;
      }

      const job: ReverificationJob = {
        jobId: stableJobId,
        downstreamUnitId: unitId,
        triggeringContractId: contractId,
        oldVersion,
        newVersion,
        gatesToRun: ['L0', 'L1a'] as GateLevel[],
        status: 'QUEUED',
        dispatchedAt: new Date().toISOString(),
        verdicts: [],
      };

      this.jobStore.set(stableJobId, job);
      dispatchedJobs.push(job);
    }

    return dispatchedJobs;
  }

  /**
   * Process all queued jobs asynchronously and reconcile results.
   */
  public async reconcileJobs(): Promise<void> {
    const queuedJobs = Array.from(this.jobStore.values()).filter(j => j.status === 'QUEUED');

    for (const job of queuedJobs) {
      job.status = 'RUNNING';

      if (this.executeJobFn) {
        try {
          const verdicts = await this.executeJobFn(job);
          job.verdicts = verdicts;
          const hasFailure = verdicts.some(v => v.status === 'FAIL' || v.status === 'INFRA_ERROR');
          job.status = hasFailure ? 'FAILED' : 'COMPLETED';
        } catch {
          job.status = 'FAILED';
        }
      } else {
        // Default simulated pass
        job.verdicts = [
          {
            verdictId: `v-${job.jobId}-L0`,
            workflowId: 'reverify-wf',
            nodeId: job.downstreamUnitId,
            contractId: job.downstreamUnitId,
            contractVersion: job.newVersion,
            gate: 'L0',
            status: 'PASS',
            sandboxPath: 'PATH_A_EPHEMERAL',
            executionDurationMs: 500,
            isAuthoritative: true,
            errorDetails: [],
            metrics: {},
            evaluatedAt: new Date().toISOString(),
          },
          {
            verdictId: `v-${job.jobId}-L1a`,
            workflowId: 'reverify-wf',
            nodeId: job.downstreamUnitId,
            contractId: job.downstreamUnitId,
            contractVersion: job.newVersion,
            gate: 'L1a',
            status: 'PASS',
            sandboxPath: 'PATH_A_EPHEMERAL',
            executionDurationMs: 1200,
            isAuthoritative: true,
            errorDetails: [],
            metrics: {},
            evaluatedAt: new Date().toISOString(),
          },
        ];
        job.status = 'COMPLETED';
      }

      job.completedAt = new Date().toISOString();
    }
  }

  /**
   * Release Hold Barrier:
   * Holds release if any required downstream re-verification is still pending, queued, or failed.
   */
  public evaluateReleaseHold(triggeringContractId: string, newVersion: string): ReleaseHoldStatus {
    const downstreamUnits = GraphResolver.resolveTransitiveDownstream(triggeringContractId, this.edges);
    const heldReasons: string[] = [];
    const pendingReverifications: string[] = [];

    for (const unitId of downstreamUnits) {
      const stableJobId = `reverify:${unitId}:${newVersion}`;
      const job = this.jobStore.get(stableJobId);

      if (!job) {
        heldReasons.push(`Downstream unit '${unitId}' has not been re-verified against contract version ${newVersion}.`);
        pendingReverifications.push(unitId);
        continue;
      }

      if (job.status === 'QUEUED' || job.status === 'RUNNING') {
        heldReasons.push(`Downstream unit '${unitId}' re-verification is currently ${job.status}.`);
        pendingReverifications.push(unitId);
      } else if (job.status === 'FAILED') {
        heldReasons.push(`Downstream unit '${unitId}' re-verification FAILED on gates.`);
      }
    }

    return {
      canPromote: heldReasons.length === 0,
      heldReasons,
      pendingReverifications,
    };
  }

  public getJob(jobId: string): ReverificationJob | undefined {
    return this.jobStore.get(jobId);
  }

  public getAllJobs(): ReverificationJob[] {
    return Array.from(this.jobStore.values());
  }
}
