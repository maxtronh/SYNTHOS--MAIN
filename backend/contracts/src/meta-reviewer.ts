import { DAGBlueprint } from './dag-blueprint.js';
import { ModuleContract } from './module-contract.js';

export interface MetaReviewFinding {
  severity: 'ERROR' | 'WARNING';
  code: string;
  nodeId?: string;
  message: string;
}

export interface MetaReviewResult {
  passed: boolean;
  errors: MetaReviewFinding[];
  warnings: MetaReviewFinding[];
  evaluatedAt: string;
  topologicalOrder?: string[] | undefined;
}

/**
 * MetaReviewer performs deterministic structural and contract-consistency validation
 * on a DAGBlueprint and its corresponding ModuleContracts.
 */
export class MetaReviewer {
  /**
   * Run full verification suite against a blueprint and contract dictionary.
   */
  public static review(
    blueprint: DAGBlueprint,
    contractMap: Map<string, ModuleContract>
  ): MetaReviewResult {
    const errors: MetaReviewFinding[] = [];
    const warnings: MetaReviewFinding[] = [];

    const nodeIds = new Set<string>();
    const adjacencyList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // 1. Check duplicate node IDs & collect graph structure
    for (const node of blueprint.nodes) {
      if (nodeIds.has(node.nodeId)) {
        errors.push({
          severity: 'ERROR',
          code: 'DUPLICATE_NODE_ID',
          nodeId: node.nodeId,
          message: `Node with ID '${node.nodeId}' is declared more than once in blueprint.`,
        });
      }
      nodeIds.add(node.nodeId);
      adjacencyList.set(node.nodeId, []);
      inDegree.set(node.nodeId, 0);
    }

    // 2. Validate node contract mappings & dependencies
    for (const node of blueprint.nodes) {
      // Validate contract existence
      const contract = contractMap.get(node.contractId);
      if (!contract) {
        errors.push({
          severity: 'ERROR',
          code: 'MISSING_CONTRACT',
          nodeId: node.nodeId,
          message: `Node '${node.nodeId}' references non-existent contract '${node.contractId}'.`,
        });
      } else {
        // Version check
        if (contract.version !== node.contractVersion) {
          errors.push({
            severity: 'ERROR',
            code: 'CONTRACT_VERSION_MISMATCH',
            nodeId: node.nodeId,
            message: `Node '${node.nodeId}' specifies contract version '${node.contractVersion}', but available contract version is '${contract.version}'.`,
          });
        }

        // Warn if stateHooks is true but execution budget is low (< 30s)
        if (contract.stateHooks && node.timeoutMs < 30000) {
          warnings.push({
            severity: 'WARNING',
            code: 'SHORT_STATEFUL_TIMEOUT',
            nodeId: node.nodeId,
            message: `Node '${node.nodeId}' has stateHooks enabled but has a low timeout (${node.timeoutMs}ms). Stateful setup/teardown may time out.`,
          });
        }
      }

      // Check self-dependency
      if (node.dependencies.includes(node.nodeId)) {
        errors.push({
          severity: 'ERROR',
          code: 'SELF_DEPENDENCY',
          nodeId: node.nodeId,
          message: `Node '${node.nodeId}' cannot depend on itself.`,
        });
      }

      // Check dangling dependencies
      for (const depId of node.dependencies) {
        if (!nodeIds.has(depId)) {
          errors.push({
            severity: 'ERROR',
            code: 'DANGLING_DEPENDENCY',
            nodeId: node.nodeId,
            message: `Node '${node.nodeId}' depends on unknown node '${depId}'.`,
          });
        } else {
          // Add edge: depId -> node.nodeId (depId must complete before node runs)
          adjacencyList.get(depId)?.push(node.nodeId);
          inDegree.set(node.nodeId, (inDegree.get(node.nodeId) ?? 0) + 1);
        }
      }
    }

    // 3. Cycle Detection using Kahn's Algorithm (Topological Sort)
    let topologicalOrder: string[] | undefined = undefined;
    if (errors.length === 0) {
      const queue: string[] = [];
      const currentInDegrees = new Map(inDegree);

      for (const [nodeId, degree] of currentInDegrees.entries()) {
        if (degree === 0) {
          queue.push(nodeId);
        }
      }

      const order: string[] = [];
      while (queue.length > 0) {
        const current = queue.shift()!;
        order.push(current);

        const neighbors = adjacencyList.get(current) ?? [];
        for (const neighbor of neighbors) {
          const newDeg = (currentInDegrees.get(neighbor) ?? 0) - 1;
          currentInDegrees.set(neighbor, newDeg);
          if (newDeg === 0) {
            queue.push(neighbor);
          }
        }
      }

      if (order.length !== blueprint.nodes.length) {
        const remainingCycles = [...currentInDegrees.entries()]
          .filter(([, deg]) => deg > 0)
          .map(([id]) => id);

        errors.push({
          severity: 'ERROR',
          code: 'CYCLIC_DEPENDENCY_DETECTED',
          message: `Cyclic dependency detected involving nodes: [${remainingCycles.join(', ')}]. DAG must be strictly acyclic.`,
        });
      } else {
        topologicalOrder = order;
      }
    }

    // 4. Output-to-input interface compatibility warnings
    for (const node of blueprint.nodes) {
      const downstreamContract = contractMap.get(node.contractId);
      if (!downstreamContract) continue;

      for (const depId of node.dependencies) {
        const upstreamNode = blueprint.nodes.find(n => n.nodeId === depId);
        if (!upstreamNode) continue;
        const upstreamContract = contractMap.get(upstreamNode.contractId);
        if (!upstreamContract) continue;

        // Verify if upstream outputs can satisfy any required downstream inputs
        const upstreamOutputKeys = Object.keys(upstreamContract.outputs);
        const downstreamInputKeys = Object.keys(downstreamContract.inputs);
        const sharedKeys = downstreamInputKeys.filter(k => upstreamOutputKeys.includes(k));

        if (downstreamInputKeys.length > 0 && sharedKeys.length === 0 && upstreamOutputKeys.length > 0) {
          warnings.push({
            severity: 'WARNING',
            code: 'INTERFACE_SCHEMA_DISJOINT',
            nodeId: node.nodeId,
            message: `Node '${node.nodeId}' depends on '${depId}', but shares no common schema field names between inputs and upstream outputs. Verify data mapping.`,
          });
        }
      }
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      evaluatedAt: new Date().toISOString(),
      topologicalOrder,
    };
  }
}
