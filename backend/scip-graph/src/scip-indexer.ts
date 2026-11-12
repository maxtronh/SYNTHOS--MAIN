import { GraphResolver, type DependencyEdge } from '@fable/blast-radius-resolver';

export interface ScipSymbolOccurrence {
  symbolId: string;        // e.g., "scip:synthos/contracts#ModuleContract."
  repository: string;
  packageName: string;
  filePath: string;
  role: 'DEFINITION' | 'REFERENCE' | 'IMPLEMENTATION';
}

/**
 * Compiler-accurate Cross-Repo SCIP Semantic Graph Engine.
 * Converts symbol occurrences across repositories into DependencyEdges
 * consumed directly by GraphResolver for zero-false-negative blast-radius detection.
 */
export class ScipSemanticGraph {
  private definitions = new Map<string, ScipSymbolOccurrence>();
  private references = new Map<string, ScipSymbolOccurrence[]>();

  public indexOccurrences(occurrences: ScipSymbolOccurrence[]): void {
    for (const occ of occurrences) {
      if (occ.role === 'DEFINITION') {
        this.definitions.set(occ.symbolId, occ);
      } else {
        const list = this.references.get(occ.symbolId) ?? [];
        list.push(occ);
        this.references.set(occ.symbolId, list);
      }
    }
  }

  public hasDefinition(symbolId: string): boolean {
    return this.definitions.has(symbolId);
  }

  /**
   * Builds cross-repository package dependency edges from SCIP symbol references.
   */
  public exportPackageEdges(): DependencyEdge[] {
    const uniqueEdges = new Map<string, DependencyEdge>();

    for (const [symbolId, refs] of this.references.entries()) {
      const def = this.definitions.get(symbolId);
      if (!def) continue;

      const upstreamUnit = `${def.repository}/${def.packageName}`;
      for (const ref of refs) {
        const downstreamUnit = `${ref.repository}/${ref.packageName}`;
        if (downstreamUnit === upstreamUnit) continue;

        const key = `${downstreamUnit}->${upstreamUnit}`;
        if (!uniqueEdges.has(key)) {
          uniqueEdges.set(key, {
            fromUnitId: downstreamUnit,
            toUnitId: upstreamUnit,
          });
        }
      }
    }

    return Array.from(uniqueEdges.values());
  }

  /**
   * Resolves all cross-repository downstream packages impacted when a symbol changes.
   */
  public findImpactedPackagesForSymbol(symbolId: string): string[] {
    const def = this.definitions.get(symbolId);
    if (!def) return [];

    const triggeringUnit = `${def.repository}/${def.packageName}`;
    const edges = this.exportPackageEdges();
    return GraphResolver.resolveTransitiveDownstream(triggeringUnit, edges);
  }
}
