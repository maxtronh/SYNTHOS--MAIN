import { describe, it, expect } from 'vitest';
import {
  MetaReviewer,
  DAGBlueprintSchema,
  ModuleContractSchema,
} from '@fable/contracts';
import { DeterministicAdapterBuilder } from '@fable/builder-deterministic';
import { GraphResolver, BlastRadiusDispatcher } from '@fable/blast-radius-resolver';
import { PrecisionLedger } from '@fable/ledger-telemetry';
import { DAGEngine, type NodeExecutionHandler } from '@fable/orchestrator-temporal';
import { DriftDetector } from '@fable/scip-graph';

const testBlueprint = () =>
  DAGBlueprintSchema.parse({
    blueprintId: 'bp-cli-human-gate',
    goalId: 'goal-human-gate',
    version: '1.0.0',
    title: 'Human Gate CLI Test',
    description: 'Testing approve and promote CLI commands',
    nodes: [
      {
        nodeId: 'node-1',
        contractId: 'contract-auth',
        contractVersion: '1.0.0',
        dependencies: [],
        allowBranchFailure: false,
        timeoutMs: 30000,
        retryPolicy: { maxAttempts: 1, initialIntervalMs: 100, backoffCoefficient: 1, maximumIntervalMs: 100 },
      },
    ],
  });

const passHandler: NodeExecutionHandler = {
  executeNode: async () => [
    {
      verdictId: 'v-node-1',
      workflowId: 'wf-cli-test',
      nodeId: 'node-1',
      contractId: 'contract-auth',
      contractVersion: '1.0.0',
      gate: 'L0',
      status: 'PASS',
      sandboxPath: 'PATH_A_EPHEMERAL',
      executionDurationMs: 50,
      isAuthoritative: true,
      errorDetails: [],
      metrics: {},
      evaluatedAt: new Date().toISOString(),
    },
  ],
};

describe('Fable CLI Commands & Integration Suite', () => {
  it('validates blueprint and contracts correctly for CLI validate command', () => {
    const rawContract = {
      id: 'c-test',
      name: 'test-module',
      version: '1.0.0',
      description: 'Test module',
      inputs: {},
      outputs: {},
      stateHooks: false,
      dependencies: [],
      requiredGates: ['L0'],
      executionBudgetMs: 30000,
    };
    const contract = ModuleContractSchema.parse(rawContract);
    const contractMap = new Map([[contract.id, contract]]);

    const blueprint = DAGBlueprintSchema.parse({
      blueprintId: 'bp-cli-test',
      goalId: 'goal-1',
      version: '1.0.0',
      title: 'CLI Test Flow',
      description: 'Validating CLI execution',
      nodes: [
        {
          nodeId: 'node-1',
          contractId: 'c-test',
          contractVersion: '1.0.0',
          dependencies: [],
          allowBranchFailure: false,
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 1, initialIntervalMs: 100, backoffCoefficient: 1, maximumIntervalMs: 100 },
        },
      ],
    });

    const result = MetaReviewer.review(blueprint, contractMap);
    expect(result.passed).toBe(true);
    expect(result.topologicalOrder).toEqual(['node-1']);
  });

  it('generates deterministic adapter code for CLI adapter command', () => {
    const contract = ModuleContractSchema.parse({
      id: 'c-auth',
      name: 'auth-service',
      version: '1.0.0',
      description: 'Auth service',
      inputs: { apiKey: { type: 'string', required: true } },
      outputs: { valid: { type: 'boolean', required: true } },
    });

    const code = DeterministicAdapterBuilder.generateAdapter(contract);
    expect(code.sourceCode).toContain('AuthServiceAdapter');
    expect(code.inputValidatorName).toBe('AuthServiceInputSchema');
    expect(code.outputValidatorName).toBe('AuthServiceOutputSchema');
  });

  it('calculates blast radius and dispatch correctly for CLI blast-radius command', () => {
    expect(GraphResolver.isMajorBump('1.0.0', '2.0.0')).toBe(true);
    expect(GraphResolver.isMajorBump('1.0.0', '1.1.0')).toBe(false);

    const edges = [{ fromUnitId: 'downstream-svc', toUnitId: 'upstream-core' }];
    const downstream = GraphResolver.resolveTransitiveDownstream('upstream-core', edges);
    expect(downstream).toEqual(['downstream-svc']);

    const dispatcher = new BlastRadiusDispatcher({ edges });
    const jobs = dispatcher.handleContractVersionUpdate('upstream-core', '1.0.0', '2.0.0');
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.downstreamUnitId).toBe('downstream-svc');
  });

  it('tracks telemetry for CLI telemetry command', () => {
    const ledger = new PrecisionLedger();
    const rec = ledger.adjudicateCohort({
      personaId: 'fuzzer',
      cohortId: 'cohort-1',
      totalProposedTests: 10,
      verifiedCatchingBugs: 8,
      adjudicationEvidence: '8 bugs caught',
    });
    expect(rec.precisionRatio).toBe(0.8);
    expect(rec.status).toBe('ACTIVE');
  });

  describe('Human Gate: Approve & Promote (CLI)', () => {
    it('approveBlueprint transitions PENDING_APPROVAL -> RUNNING and records audit', () => {
      const blueprint = testBlueprint();
      const engine = new DAGEngine('wf-approve-01', blueprint, {
        executeNode: async () => [],
      });

      expect(engine.getState().status).toBe('PENDING_APPROVAL');

      engine.approveBlueprint({ approvedBy: 'lead-operator@synthos.dev' });

      const state = engine.getState();
      expect(state.status).toBe('RUNNING');
      expect(state.approvedBy).toBe('lead-operator@synthos.dev');
      expect(state.approvedAt).toBeDefined();

      const approvalAudit = state.auditLog.find(e => e.eventType === 'DAG_APPROVAL_GRANTED');
      expect(approvalAudit).toBeDefined();
      expect(approvalAudit?.payload['approvedBy']).toBe('lead-operator@synthos.dev');
    });

    it('rejects approval when blueprint is not in PENDING_APPROVAL or STALE_PAUSED', () => {
      const blueprint = testBlueprint();
      const engine = new DAGEngine('wf-approve-02', blueprint, {
        executeNode: async () => [],
      });
      engine.approveBlueprint({ approvedBy: 'operator' });

      expect(() =>
        engine.approveBlueprint({ approvedBy: 'operator' }),
      ).toThrow(/Cannot approve blueprint/);
    });

    it('promoteRelease requires COMPLETED status and sets releasePromoted', async () => {
      const blueprint = testBlueprint();
      const engine = new DAGEngine('wf-promote-01', blueprint, passHandler);

      // Cannot promote before completion
      expect(() =>
        engine.promoteRelease({
          approvedBy: 'release-manager@synthos.dev',
          targetEnvironment: 'PRODUCTION',
        }),
      ).toThrow(/Cannot promote release/);

      // Approve and run to completion
      engine.approveBlueprint({ approvedBy: 'lead-operator@synthos.dev' });
      await engine.runUntilDone();
      expect(engine.getState().status).toBe('COMPLETED');

      // Now promote
      engine.promoteRelease({
        approvedBy: 'release-manager@synthos.dev',
        targetEnvironment: 'PRODUCTION',
      });

      const state = engine.getState();
      expect(state.releasePromoted).toBe(true);

      const promoAudit = state.auditLog.find(e => e.eventType === 'RELEASE_PROMOTION_GRANTED');
      expect(promoAudit).toBeDefined();
      expect(promoAudit?.payload['targetEnvironment']).toBe('PRODUCTION');
      expect(promoAudit?.payload['approvedBy']).toBe('release-manager@synthos.dev');
    });

    it('supports STAGING target environment for promotion', async () => {
      const blueprint = testBlueprint();
      const engine = new DAGEngine('wf-promote-02', blueprint, passHandler);

      engine.approveBlueprint({ approvedBy: 'release-manager@synthos.dev' });
      await engine.runUntilDone();

      engine.promoteRelease({
        approvedBy: 'release-manager@synthos.dev',
        targetEnvironment: 'STAGING',
      });

      const state = engine.getState();
      expect(state.releasePromoted).toBe(true);

      const promoAudit = state.auditLog.find(e => e.eventType === 'RELEASE_PROMOTION_GRANTED');
      expect(promoAudit?.payload['targetEnvironment']).toBe('STAGING');
    });

    it('detects breaking drift across contracts for CLI drift-detect command', () => {
      const report = DriftDetector.detectDrift({
        publishedContracts: [{ contractId: 'c-auth', version: '2.0.0' }],
        consumerPins: [{ consumerUnitId: 'orders', contractId: 'c-auth', pinnedVersion: '1.0.0' }],
      });

      expect(report.hasBreakingDrift).toBe(true);
      expect(report.findings[0]?.category).toBe('MAJOR_VERSION_DRIFT');
    });
  });
});
