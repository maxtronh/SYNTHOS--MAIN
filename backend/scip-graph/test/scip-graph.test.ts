import { describe, it, expect } from 'vitest';
import { ScipSemanticGraph, DriftDetector } from '../src/index.js';

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

  it('Phase 35: detects MAJOR version drift, minor warnings, and orphaned SCIP symbol references', () => {
    const graph = new ScipSemanticGraph();
    graph.indexOccurrences([
      {
        symbolId: 'scip:repo-auth/core#JwtPayload.',
        repository: 'repo-auth',
        packageName: 'core',
        filePath: 'src/jwt.ts',
        role: 'DEFINITION',
      },
      {
        symbolId: 'scip:repo-orders/api#OrderEvent.',
        repository: 'repo-orders',
        packageName: 'api',
        filePath: 'src/events.ts',
        role: 'DEFINITION',
      },
      {
        symbolId: 'scip:repo-orders/api#OrderEvent.',
        repository: 'repo-billing',
        packageName: 'worker',
        filePath: 'src/consumer.ts',
        role: 'REFERENCE',
      },
    ]);

    const report = DriftDetector.detectDrift({
      publishedContracts: [
        { contractId: 'c-auth', version: '2.0.0', symbolIds: ['scip:repo-auth/core#JwtPayload.'] },
        { contractId: 'c-payments', version: '1.2.0' },
      ],
      consumerPins: [
        {
          consumerUnitId: 'repo-orders/api',
          contractId: 'c-auth',
          pinnedVersion: '1.4.0', // Behind MAJOR 2.0.0 + references removed symbol
          referencedSymbolIds: ['scip:repo-auth/core#JwtPayload.', 'scip:repo-auth/core#LegacyToken.'],
        },
        {
          consumerUnitId: 'repo-checkout/web',
          contractId: 'c-payments',
          pinnedVersion: '1.0.0', // Non-breaking minor behind 1.2.0
        },
      ],
      scipGraph: graph,
    });

    expect(report.hasBreakingDrift).toBe(true);
    expect(report.findings.some(f => f.category === 'MAJOR_VERSION_DRIFT' && f.severity === 'BREAKING')).toBe(true);
    expect(report.findings.some(f => f.category === 'ORPHANED_SYMBOL_REFERENCE' && f.severity === 'BREAKING')).toBe(true);
    expect(report.findings.some(f => f.category === 'MINOR_VERSION_DRIFT' && f.severity === 'WARNING')).toBe(true);
    expect(report.impactedTransitiveUnits).toEqual(['repo-billing/worker', 'repo-orders/api']);
  });
});
