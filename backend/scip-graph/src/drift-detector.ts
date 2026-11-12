import { GraphResolver } from '@fable/blast-radius-resolver';
import type { ScipSemanticGraph } from './scip-indexer.js';

export type DriftCategory =
  | 'MAJOR_VERSION_DRIFT'
  | 'MINOR_VERSION_DRIFT'
  | 'ORPHANED_SYMBOL_REFERENCE'
  | 'UNKNOWN_CONTRACT';

export type DriftSeverity = 'BREAKING' | 'WARNING';

export interface PublishedContractRecord {
  contractId: string;
  version: string;
  symbolIds?: string[] | undefined;
}

export interface ConsumerPinRecord {
  consumerUnitId: string;
  contractId: string;
  pinnedVersion: string;
  referencedSymbolIds?: string[] | undefined;
}

export interface DriftFinding {
  category: DriftCategory;
  severity: DriftSeverity;
  consumerUnitId: string;
  contractId: string;
  pinnedVersion: string;
  latestVersion?: string | undefined;
  detail: string;
}

export interface DriftReport {
  hasBreakingDrift: boolean;
  findings: DriftFinding[];
  impactedTransitiveUnits: string[];
  evaluatedAt: string;
}

/**
 * Phase 35: Cross-Repo Contract & SCIP Symbol Drift Detector.
 * Identifies breaking version drift and orphaned compiler symbol references across consumers
 * before code reaches integration or production.
 */
export class DriftDetector {
  /**
   * Evaluates consumer pins and SCIP symbol references against published contract versions.
   */
  public static detectDrift(input: {
    publishedContracts: PublishedContractRecord[];
    consumerPins: ConsumerPinRecord[];
    scipGraph?: ScipSemanticGraph | undefined;
  }): DriftReport {
    const publishedMap = new Map(
      input.publishedContracts.map(c => [c.contractId, c])
    );
    const findings: DriftFinding[] = [];
    const directlyDriftedUnits = new Set<string>();

    for (const pin of input.consumerPins) {
      const published = publishedMap.get(pin.contractId);
      if (!published) {
        directlyDriftedUnits.add(pin.consumerUnitId);
        findings.push({
          category: 'UNKNOWN_CONTRACT',
          severity: 'BREAKING',
          consumerUnitId: pin.consumerUnitId,
          contractId: pin.contractId,
          pinnedVersion: pin.pinnedVersion,
          detail: `Consumer '${pin.consumerUnitId}' pins missing contract '${pin.contractId}'.`,
        });
        continue;
      }

      this.evaluateVersionDrift(pin, published, findings, directlyDriftedUnits);
      this.evaluateSymbolDrift(pin, published, input.scipGraph, findings, directlyDriftedUnits);
    }

    const impactedTransitiveUnits = this.resolveTransitiveImpact(
      Array.from(directlyDriftedUnits),
      input.scipGraph
    );

    const hasBreakingDrift = findings.some(f => f.severity === 'BREAKING');

    return {
      hasBreakingDrift,
      findings,
      impactedTransitiveUnits,
      evaluatedAt: new Date().toISOString(),
    };
  }

  private static evaluateVersionDrift(
    pin: ConsumerPinRecord,
    published: PublishedContractRecord,
    findings: DriftFinding[],
    driftedUnits: Set<string>
  ): void {
    if (pin.pinnedVersion === published.version) return;

    if (GraphResolver.isMajorBump(pin.pinnedVersion, published.version)) {
      driftedUnits.add(pin.consumerUnitId);
      findings.push({
        category: 'MAJOR_VERSION_DRIFT',
        severity: 'BREAKING',
        consumerUnitId: pin.consumerUnitId,
        contractId: pin.contractId,
        pinnedVersion: pin.pinnedVersion,
        latestVersion: published.version,
        detail: `Consumer '${pin.consumerUnitId}' pins ${pin.contractId}@${pin.pinnedVersion}, behind MAJOR version ${published.version}.`,
      });
      return;
    }

    if (isNewerNonMajor(pin.pinnedVersion, published.version)) {
      findings.push({
        category: 'MINOR_VERSION_DRIFT',
        severity: 'WARNING',
        consumerUnitId: pin.consumerUnitId,
        contractId: pin.contractId,
        pinnedVersion: pin.pinnedVersion,
        latestVersion: published.version,
        detail: `Consumer '${pin.consumerUnitId}' pins ${pin.contractId}@${pin.pinnedVersion}; non-breaking update ${published.version} available.`,
      });
    }
  }

  private static evaluateSymbolDrift(
    pin: ConsumerPinRecord,
    published: PublishedContractRecord,
    scipGraph: ScipSemanticGraph | undefined,
    findings: DriftFinding[],
    driftedUnits: Set<string>
  ): void {
    const refs = pin.referencedSymbolIds ?? [];
    if (refs.length === 0) return;

    const declaredSymbols = published.symbolIds ? new Set(published.symbolIds) : null;

    for (const symbolId of refs) {
      const missingInContract = declaredSymbols !== null && !declaredSymbols.has(symbolId);
      const missingInGraph = scipGraph !== undefined && !scipGraph.hasDefinition(symbolId);

      if (missingInContract || missingInGraph) {
        driftedUnits.add(pin.consumerUnitId);
        findings.push({
          category: 'ORPHANED_SYMBOL_REFERENCE',
          severity: 'BREAKING',
          consumerUnitId: pin.consumerUnitId,
          contractId: pin.contractId,
          pinnedVersion: pin.pinnedVersion,
          latestVersion: published.version,
          detail: `Consumer '${pin.consumerUnitId}' references removed/undefined SCIP symbol '${symbolId}'.`,
        });
      }
    }
  }

  private static resolveTransitiveImpact(
    driftedUnits: string[],
    scipGraph: ScipSemanticGraph | undefined
  ): string[] {
    if (!scipGraph || driftedUnits.length === 0) {
      return driftedUnits.sort();
    }

    const edges = scipGraph.exportPackageEdges();
    const allImpacted = new Set<string>(driftedUnits);

    for (const unit of driftedUnits) {
      for (const downstream of GraphResolver.resolveTransitiveDownstream(unit, edges)) {
        allImpacted.add(downstream);
      }
    }

    return Array.from(allImpacted).sort();
  }
}

function isNewerNonMajor(pinned: string, latest: string): boolean {
  const [pMaj = 0, pMin = 0, pPat = 0] = pinned.split('.').map(n => parseInt(n, 10) || 0);
  const [lMaj = 0, lMin = 0, lPat = 0] = latest.split('.').map(n => parseInt(n, 10) || 0);
  if (lMaj !== pMaj) return false;
  return lMin > pMin || (lMin === pMin && lPat > pPat);
}
