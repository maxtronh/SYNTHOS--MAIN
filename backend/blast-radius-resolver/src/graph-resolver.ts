export interface DependencyEdge {
  fromUnitId: string; // Downstream unit
  toUnitId: string;   // Upstream dependency
}

export class GraphResolver {
  /**
   * Determine if a version change represents a MAJOR bump in SemVer.
   */
  public static isMajorBump(oldVersion: string, newVersion: string): boolean {
    const oldMajor = parseInt(oldVersion.split('.')[0] ?? '0', 10);
    const newMajor = parseInt(newVersion.split('.')[0] ?? '0', 10);
    return newMajor > oldMajor;
  }

  /**
   * Find all transitive downstream units that directly or indirectly depend on `triggeringUnitId`.
   */
  public static resolveTransitiveDownstream(
    triggeringUnitId: string,
    edges: DependencyEdge[]
  ): string[] {
    // Build reverse adjacency list: upstream -> downstream[]
    const downstreamMap = new Map<string, string[]>();
    for (const edge of edges) {
      const list = downstreamMap.get(edge.toUnitId) ?? [];
      list.push(edge.fromUnitId);
      downstreamMap.set(edge.toUnitId, list);
    }

    const visited = new Set<string>();
    const queue: string[] = [...(downstreamMap.get(triggeringUnitId) ?? [])];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!visited.has(current)) {
        visited.add(current);
        const nextLevel = downstreamMap.get(current) ?? [];
        for (const next of nextLevel) {
          if (!visited.has(next)) {
            queue.push(next);
          }
        }
      }
    }

    return Array.from(visited);
  }
}
