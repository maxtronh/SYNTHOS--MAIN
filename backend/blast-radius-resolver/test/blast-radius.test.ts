import { describe, it, expect } from 'vitest';
import {
  GraphResolver,
  BlastRadiusDispatcher,
  type DependencyEdge,
} from '../src/index.js';

describe('Blast Radius Resolver & Dependency Invalidation Suite', () => {
  // Graph: C depends on B, B depends on A, D depends on B, E is independent
  // Edges: { from: downstream, to: upstream }
  const edges: DependencyEdge[] = [
    { fromUnitId: 'unit-b', toUnitId: 'unit-a' },
    { fromUnitId: 'unit-c', toUnitId: 'unit-b' },
    { fromUnitId: 'unit-d', toUnitId: 'unit-b' },
  ];

  it('correctly identifies SemVer major bumps', () => {
    expect(GraphResolver.isMajorBump('1.4.2', '2.0.0')).toBe(true);
    expect(GraphResolver.isMajorBump('1.4.2', '1.5.0')).toBe(false);
    expect(GraphResolver.isMajorBump('1.4.2', '1.4.3')).toBe(false);
  });

  it('resolves all transitive downstream dependencies', () => {
    const downstreamOfA = GraphResolver.resolveTransitiveDownstream('unit-a', edges);
    // B, C, D all depend directly or indirectly on A
    expect(downstreamOfA.sort()).toEqual(['unit-b', 'unit-c', 'unit-d'].sort());

    const downstreamOfB = GraphResolver.resolveTransitiveDownstream('unit-b', edges);
    expect(downstreamOfB.sort()).toEqual(['unit-c', 'unit-d'].sort());

    const downstreamOfC = GraphResolver.resolveTransitiveDownstream('unit-c', edges);
    expect(downstreamOfC).toEqual([]);
  });

  it('dispatches deduplicated re-verification jobs on MAJOR bump', () => {
    const dispatcher = new BlastRadiusDispatcher({ edges });

    // Patch bump does NOT trigger blast radius
    const patchJobs = dispatcher.handleContractVersionUpdate('unit-a', '1.0.0', '1.0.1');
    expect(patchJobs.length).toBe(0);

    // Major bump triggers jobs for B, C, D
    const majorJobs = dispatcher.handleContractVersionUpdate('unit-a', '1.0.0', '2.0.0');
    expect(majorJobs.length).toBe(3);

    // Re-dispatching the exact same event does NOT duplicate queued jobs
    const duplicateJobs = dispatcher.handleContractVersionUpdate('unit-a', '1.0.0', '2.0.0');
    expect(duplicateJobs.length).toBe(0);
    expect(dispatcher.getAllJobs().length).toBe(3);
  });

  it('holds release until all downstream re-verifications succeed', async () => {
    const dispatcher = new BlastRadiusDispatcher({ edges });

    dispatcher.handleContractVersionUpdate('unit-a', '1.0.0', '2.0.0');

    // Before reconciliation: all jobs are QUEUED -> Release must be held!
    const initialHold = dispatcher.evaluateReleaseHold('unit-a', '2.0.0');
    expect(initialHold.canPromote).toBe(false);
    expect(initialHold.pendingReverifications.length).toBe(3);

    // Reconcile and execute jobs
    await dispatcher.reconcileJobs();

    // After successful reconciliation -> Release is unblocked
    const finalHold = dispatcher.evaluateReleaseHold('unit-a', '2.0.0');
    expect(finalHold.canPromote).toBe(true);
    expect(finalHold.heldReasons.length).toBe(0);
  });

  it('holds release if any downstream re-verification fails', async () => {
    const dispatcher = new BlastRadiusDispatcher({
      edges,
      executeJobFn: async (job) => {
        if (job.downstreamUnitId === 'unit-c') {
          return [
            {
              verdictId: `v-${job.jobId}`,
              workflowId: 'reverify-wf',
              nodeId: job.downstreamUnitId,
              contractId: job.downstreamUnitId,
              contractVersion: job.newVersion,
              gate: 'L1a',
              status: 'FAIL',
              sandboxPath: 'PATH_A_EPHEMERAL',
              executionDurationMs: 800,
              isAuthoritative: true,
              errorDetails: ['Contract breaking change broke downstream unit-c types'],
              metrics: {},
              evaluatedAt: new Date().toISOString(),
            },
          ];
        }
        return [];
      },
    });

    dispatcher.handleContractVersionUpdate('unit-a', '1.0.0', '2.0.0');
    await dispatcher.reconcileJobs();

    const holdStatus = dispatcher.evaluateReleaseHold('unit-a', '2.0.0');
    expect(holdStatus.canPromote).toBe(false);
    expect(holdStatus.heldReasons.some(r => r.includes("unit-c' re-verification FAILED"))).toBe(true);
  });
});
