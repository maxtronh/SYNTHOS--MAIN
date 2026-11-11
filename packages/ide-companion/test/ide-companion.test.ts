import { describe, it, expect } from 'vitest';
import type { ModuleContract } from '@fable/contracts';
import { ScipSemanticGraph } from '@fable/scip-graph';
import { IdeCompanionProvider } from '../src/index.js';

describe('Phase 29: IDE Companion & Local Dry-Run Simulator Suite', () => {
  const statefulContract: ModuleContract = {
    id: 'c-ledger',
    name: 'ledger-db',
    version: '2.0.0',
    description: 'Stateful financial schema',
    inputs: {},
    outputs: {},
    stateHooks: true,
    dependencies: [],
    requiredGates: ['L0', 'L1a', 'L3'],
    executionBudgetMs: 60000,
    author: 'dev',
    createdAt: new Date().toISOString(),
  };

  it('generates inline contract hints and SCIP hover blast-radius heatmaps', () => {
    const hint = IdeCompanionProvider.getContractHint(statefulContract);
    expect(hint.sandboxRoute).toBe('PATH_B_STATEFUL');
    expect(hint.badgeLabel).toContain('Path B: Stateful Dry-Run');

    const scip = new ScipSemanticGraph();
    scip.indexOccurrences([
      { symbolId: 'scip:core#Auth.', repository: 'core', packageName: 'auth', filePath: 'a.ts', role: 'DEFINITION' },
      { symbolId: 'scip:core#Auth.', repository: 'svc-1', packageName: 'api', filePath: 'b.ts', role: 'REFERENCE' },
      { symbolId: 'scip:core#Auth.', repository: 'svc-2', packageName: 'worker', filePath: 'c.ts', role: 'REFERENCE' },
    ]);

    const heatmap = IdeCompanionProvider.getBlastRadiusHeatmap('scip:core#Auth.', scip);
    expect(heatmap.impactedCount).toBe(2);
    expect(heatmap.severity).toBe('MEDIUM');
  });

  it('executes 1-click local L0/L1a/L3 sandbox dry-run directly from IDE', async () => {
    const verdicts = await IdeCompanionProvider.runLocalDryRun(statefulContract);
    expect(verdicts.length).toBe(3);
    expect(verdicts.every(v => v.status === 'PASS')).toBe(true);
    expect(verdicts[2]?.sandboxPath).toBe('PATH_B_STATEFUL');
  });
});
