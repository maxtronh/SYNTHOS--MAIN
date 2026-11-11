import { describe, it, expect } from 'vitest';
import {
  MetaReviewer,
  DAGBlueprintSchema,
  ModuleContractSchema,
} from '@fable/contracts';
import { DeterministicAdapterBuilder } from '@fable/builder-deterministic';
import { GraphResolver, BlastRadiusDispatcher } from '@fable/blast-radius-resolver';
import { PrecisionLedger } from '@fable/ledger-telemetry';

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
});
