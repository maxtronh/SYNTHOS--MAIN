import { describe, it, expect } from 'vitest';
import {
  ModuleContractSchema,
  GateVerdictSchema,
  DecisionMemoSchema,
  AuditTrailEventSchema,
  MetaReviewer,
  type ModuleContract,
  type DAGBlueprint,
} from '../src/index.js';

describe('Contracts & Schemas Verification Suite', () => {
  it('should validate a compliant ModuleContract', () => {
    const rawContract = {
      id: 'contract-auth-service',
      name: 'auth-service',
      version: '1.2.0',
      description: 'Handles JWT issue and verification',
      inputs: {
        username: { type: 'string', required: true },
        password: { type: 'string', required: true },
      },
      outputs: {
        token: { type: 'string', required: true },
        expiresIn: { type: 'number', required: true },
      },
      stateHooks: false,
      dependencies: [],
      requiredGates: ['L0', 'L1a'],
      executionBudgetMs: 45000,
    };

    const parsed = ModuleContractSchema.parse(rawContract);
    expect(parsed.name).toBe('auth-service');
    expect(parsed.version).toBe('1.2.0');
    expect(parsed.stateHooks).toBe(false);
  });

  it('should reject a ModuleContract with non-SemVer version', () => {
    const invalidContract = {
      id: 'contract-bad',
      name: 'bad-contract',
      version: 'v1-invalid',
      description: 'Test invalid version',
      inputs: {},
      outputs: {},
    };

    expect(() => ModuleContractSchema.parse(invalidContract)).toThrow();
  });

  it('should validate a compliant GateVerdict', () => {
    const rawVerdict = {
      verdictId: 'v-101',
      workflowId: 'wf-999',
      nodeId: 'node-auth',
      contractId: 'contract-auth-service',
      contractVersion: '1.2.0',
      gate: 'L0',
      status: 'PASS',
      sandboxPath: 'PATH_A_EPHEMERAL',
      executionDurationMs: 1240,
      metrics: {
        lintErrors: 0,
        coveragePercent: 94.5,
      },
    };

    const parsed = GateVerdictSchema.parse(rawVerdict);
    expect(parsed.status).toBe('PASS');
    expect(parsed.isAuthoritative).toBe(true);
  });

  it('should validate a DecisionMemo when 3 cycles fail', () => {
    const rawMemo = {
      memoId: 'memo-001',
      goalId: 'goal-42',
      workflowId: 'wf-100',
      nodeId: 'node-prisma-migration',
      contractId: 'contract-prisma',
      contractVersion: '2.0.0',
      totalCyclesAttempted: 3,
      patchHistory: [
        {
          cycle: 1,
          timestamp: new Date().toISOString(),
          patchDiff: '--- a/src/db.ts\n+++ b/src/db.ts',
          failureGate: 'L1a',
          failureOutput: 'Migration dry run deadlock',
          modelPersona: 'security-specialist',
        },
        {
          cycle: 2,
          timestamp: new Date().toISOString(),
          patchDiff: '--- a/src/db.ts\n+++ b/src/db.ts',
          failureGate: 'L1a',
          failureOutput: 'Schema drift on foreign key',
          modelPersona: 'db-architect',
        },
        {
          cycle: 3,
          timestamp: new Date().toISOString(),
          patchDiff: '--- a/src/db.ts\n+++ b/src/db.ts',
          failureGate: 'L1a',
          failureOutput: 'Foreign key constraint violated',
          modelPersona: 'db-architect',
        },
      ],
      consolidatedErrorLogs: 'Fatal 3 cycles failed consecutively.',
      unresolvedQuestions: ['Should the foreign key constraint be deferred?'],
      assignedTo: 'senior-engineer@company.com',
    };

    const parsed = DecisionMemoSchema.parse(rawMemo);
    expect(parsed.totalCyclesAttempted).toBe(3);
    expect(parsed.patchHistory.length).toBe(3);
  });

  it('should validate immutable AuditTrailEvent records', () => {
    const rawEvent = {
      eventId: 'evt-001',
      correlationId: 'corr-1234',
      goalId: 'goal-42',
      workflowId: 'wf-100',
      eventType: 'DAG_APPROVAL_REQUESTED',
      actor: {
        type: 'TEMPORAL_WORKFLOW',
        id: 'temporal-worker-1',
      },
      payload: {
        slaRemainingHours: 24,
      },
    };

    const parsed = AuditTrailEventSchema.parse(rawEvent);
    expect(parsed.eventType).toBe('DAG_APPROVAL_REQUESTED');
  });
});

describe('MetaReviewer Graph & Blueprint Verification', () => {
  const contractA: ModuleContract = {
    id: 'contract-a',
    name: 'module-a',
    version: '1.0.0',
    description: 'Module A description',
    inputs: {},
    outputs: { dataA: { type: 'string', required: true } },
    stateHooks: false,
    dependencies: [],
    requiredGates: ['L0'],
    executionBudgetMs: 10000,
    author: 'architect',
    createdAt: new Date().toISOString(),
  };

  const contractB: ModuleContract = {
    id: 'contract-b',
    name: 'module-b',
    version: '1.0.0',
    description: 'Module B description',
    inputs: { dataA: { type: 'string', required: true } },
    outputs: { resultB: { type: 'number', required: true } },
    stateHooks: true,
    dependencies: [{ contractId: 'contract-a', name: 'module-a', versionRange: '^1.0.0' }],
    requiredGates: ['L0', 'L1a'],
    executionBudgetMs: 40000,
    author: 'architect',
    createdAt: new Date().toISOString(),
  };

  const contractMap = new Map<string, ModuleContract>([
    ['contract-a', contractA],
    ['contract-b', contractB],
  ]);

  it('should pass a valid DAG and return correct topological order', () => {
    const blueprint: DAGBlueprint = {
      blueprintId: 'bp-001',
      goalId: 'goal-1',
      version: '1.0.0',
      title: 'Valid Pipeline',
      description: 'Linear dependency from A to B',
      status: 'DRAFT',
      author: 'lead-architect',
      createdAt: new Date().toISOString(),
      nodes: [
        {
          nodeId: 'node-b',
          contractId: 'contract-b',
          contractVersion: '1.0.0',
          dependencies: ['node-a'],
          allowBranchFailure: false,
          timeoutMs: 60000,
          retryPolicy: { maxAttempts: 3, initialIntervalMs: 1000, backoffCoefficient: 2, maximumIntervalMs: 5000 },
        },
        {
          nodeId: 'node-a',
          contractId: 'contract-a',
          contractVersion: '1.0.0',
          dependencies: [],
          allowBranchFailure: false,
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, initialIntervalMs: 1000, backoffCoefficient: 2, maximumIntervalMs: 5000 },
        },
      ],
    };

    const review = MetaReviewer.review(blueprint, contractMap);
    expect(review.passed).toBe(true);
    expect(review.errors.length).toBe(0);
    expect(review.topologicalOrder).toEqual(['node-a', 'node-b']);
  });

  it('should detect cyclic dependencies in a blueprint', () => {
    const blueprint: DAGBlueprint = {
      blueprintId: 'bp-cyclic',
      goalId: 'goal-1',
      version: '1.0.0',
      title: 'Cyclic Pipeline',
      description: 'A depends on B and B depends on A',
      status: 'DRAFT',
      author: 'lead-architect',
      createdAt: new Date().toISOString(),
      nodes: [
        {
          nodeId: 'node-a',
          contractId: 'contract-a',
          contractVersion: '1.0.0',
          dependencies: ['node-b'],
          allowBranchFailure: false,
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, initialIntervalMs: 1000, backoffCoefficient: 2, maximumIntervalMs: 5000 },
        },
        {
          nodeId: 'node-b',
          contractId: 'contract-b',
          contractVersion: '1.0.0',
          dependencies: ['node-a'],
          allowBranchFailure: false,
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, initialIntervalMs: 1000, backoffCoefficient: 2, maximumIntervalMs: 5000 },
        },
      ],
    };

    const review = MetaReviewer.review(blueprint, contractMap);
    expect(review.passed).toBe(false);
    expect(review.errors.some(e => e.code === 'CYCLIC_DEPENDENCY_DETECTED')).toBe(true);
  });

  it('should detect dangling dependencies and non-existent contracts', () => {
    const blueprint: DAGBlueprint = {
      blueprintId: 'bp-dangling',
      goalId: 'goal-1',
      version: '1.0.0',
      title: 'Dangling Pipeline',
      description: 'References missing nodes and contracts',
      status: 'DRAFT',
      author: 'lead-architect',
      createdAt: new Date().toISOString(),
      nodes: [
        {
          nodeId: 'node-x',
          contractId: 'contract-missing',
          contractVersion: '1.0.0',
          dependencies: ['non-existent-node'],
          allowBranchFailure: false,
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, initialIntervalMs: 1000, backoffCoefficient: 2, maximumIntervalMs: 5000 },
        },
      ],
    };

    const review = MetaReviewer.review(blueprint, contractMap);
    expect(review.passed).toBe(false);
    expect(review.errors.some(e => e.code === 'MISSING_CONTRACT')).toBe(true);
    expect(review.errors.some(e => e.code === 'DANGLING_DEPENDENCY')).toBe(true);
  });
});
