import { describe, it, expect } from 'vitest';
import {
  DiffMutationRunner,
  ChaosFaultInjector,
  FormalSpecVerifier,
} from '../src/index.js';

describe('Phases 21, 19, 20: Advanced Mutation, Chaos & Formal Verification Suite', () => {
  it('Phase 21: computes diff-scoped L1b mutation score and enforces threshold', () => {
    const verdict = DiffMutationRunner.evaluateDiffMutants({
      workflowId: 'wf-m1',
      nodeId: 'node-calc',
      contractId: 'c-calc',
      contractVersion: '1.0.0',
      diffHunks: [{ filePath: 'src/calc.ts', startLine: 10, endLine: 20 }],
      mutants: [
        { mutantId: 'm1', filePath: 'src/calc.ts', line: 12, status: 'KILLED' },
        { mutantId: 'm2', filePath: 'src/calc.ts', line: 15, status: 'KILLED' },
        { mutantId: 'm3', filePath: 'src/calc.ts', line: 18, status: 'KILLED' },
        { mutantId: 'm4', filePath: 'src/calc.ts', line: 19, status: 'SURVIVED' },
        // Outside diff hunk -> ignored!
        { mutantId: 'm5', filePath: 'src/calc.ts', line: 99, status: 'SURVIVED' },
      ],
      minMutationScorePercent: 75,
    });

    expect(verdict.gate).toBe('L1b');
    expect(verdict.status).toBe('PASS');
    expect(verdict.metrics.mutationScore).toBe(75);
    expect(verdict.isAuthoritative).toBe(false);
  });

  it('Phase 19: executes L3 Chaos fault injection and catches invariant violations', async () => {
    const verdict = await ChaosFaultInjector.runChaosGate({
      workflowId: 'wf-chaos',
      nodeId: 'node-db',
      contractId: 'c-db',
      contractVersion: '1.0.0',
      scenarios: [
        {
          faultType: 'DB_DEADLOCK',
          intensity: 1,
          executeUnderFault: async () => true, // Recovered cleanly
        },
        {
          faultType: 'PACKET_LOSS',
          intensity: 0.3,
          executeUnderFault: async () => false, // Data lost!
        },
      ],
    });

    expect(verdict.gate).toBe('L3');
    expect(verdict.sandboxPath).toBe('PATH_B_STATEFUL');
    expect(verdict.status).toBe('FAIL');
    expect(verdict.errorDetails[0]).toContain('PACKET_LOSS');
  });

  it('Phase 20: explores ledger state space formally to prove conservation of money', () => {
    interface LedgerState {
      alice: number;
      bob: number;
    }

    const passVerdict = FormalSpecVerifier.verifyStateSpace<LedgerState>({
      workflowId: 'wf-formal',
      nodeId: 'node-ledger',
      contractId: 'c-ledger',
      contractVersion: '1.0.0',
      initialState: { alice: 100, bob: 50 },
      transitions: [
        s => (s.alice >= 10 ? { alice: s.alice - 10, bob: s.bob + 10 } : s),
        s => (s.bob >= 10 ? { alice: s.alice + 10, bob: s.bob - 10 } : s),
      ],
      invariants: [
        { name: 'NON_NEGATIVE_BALANCES', predicate: s => s.alice >= 0 && s.bob >= 0 },
        { name: 'CONSERVATION_OF_TOTAL', predicate: s => s.alice + s.bob === 150 },
      ],
      maxDepth: 4,
    });

    expect(passVerdict.status).toBe('PASS');

    // Now test a buggy transition that creates money out of thin air
    const failVerdict = FormalSpecVerifier.verifyStateSpace<LedgerState>({
      workflowId: 'wf-formal-bad',
      nodeId: 'node-ledger',
      contractId: 'c-ledger',
      contractVersion: '1.0.0',
      initialState: { alice: 100, bob: 50 },
      transitions: [s => ({ alice: s.alice - 10, bob: s.bob + 20 })],
      invariants: [{ name: 'CONSERVATION_OF_TOTAL', predicate: s => s.alice + s.bob === 150 }],
      maxDepth: 2,
    });

    expect(failVerdict.status).toBe('FAIL');
    expect(failVerdict.errorDetails[0]).toContain('CONSERVATION_OF_TOTAL');
  });
});
