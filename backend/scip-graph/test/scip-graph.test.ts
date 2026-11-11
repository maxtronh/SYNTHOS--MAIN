import { describe, it, expect } from 'vitest';
import { ScipSemanticGraph } from '../src/index.js';

describe('Phase 22: Cross-Repo SCIP Semantic Graph Suite', () => {
  it('resolves transitive cross-repository downstream packages from compiler symbols', () => {
    const graph = new ScipSemanticGraph();

    graph.indexOccurrences([
      // Core Auth Token defined in repo-auth/core
      {
        symbolId: 'scip:repo-auth/core#JwtPayload.',
        repository: 'repo-auth',
        packageName: 'core',
        filePath: 'src/jwt.ts',
        role: 'DEFINITION',
      },
      // Referenced by repo-orders/api
      {
        symbolId: 'scip:repo-auth/core#JwtPayload.',
        repository: 'repo-orders',
        packageName: 'api',
        filePath: 'src/middleware.ts',
        role: 'REFERENCE',
      },
      // repo-orders/api defines OrderEvent
      {
        symbolId: 'scip:repo-orders/api#OrderEvent.',
        repository: 'repo-orders',
        packageName: 'api',
        filePath: 'src/events.ts',
        role: 'DEFINITION',
      },
      // Referenced by repo-billing/worker
      {
        symbolId: 'scip:repo-orders/api#OrderEvent.',
        repository: 'repo-billing',
        packageName: 'worker',
        filePath: 'src/consumer.ts',
        role: 'REFERENCE',
      },
    ]);

    const impacted = graph.findImpactedPackagesForSymbol('scip:repo-auth/core#JwtPayload.');
    expect(impacted.sort()).toEqual(['repo-billing/worker', 'repo-orders/api']);
  });
});
