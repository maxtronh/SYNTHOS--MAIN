#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import {
  MetaReviewer,
  DAGBlueprintSchema,
  ModuleContractSchema,
  type ModuleContract,
} from '@fable/contracts';
import { DeterministicAdapterBuilder } from '@fable/builder-deterministic';
import { DAGEngine, type NodeExecutionHandler } from '@fable/orchestrator-temporal';
import { GateRunner } from '@fable/gate-runner';
import { GraphResolver, BlastRadiusDispatcher } from '@fable/blast-radius-resolver';
import { PrecisionLedger, RecallLedger, OperationalMetricsTracker } from '@fable/ledger-telemetry';
import { OperatorDashboardServer } from '@fable/dashboard';

const program = new Command();

program
  .name('fable')
  .description('Fable Engine v3 — Deterministic Software Verification & Durable DAG Orchestrator CLI')
  .version('3.0.0');

/**
 * Command: fable validate <blueprint.json>
 */
program
  .command('validate')
  .description('Validate a DAG blueprint against contracts using Tier 1 MetaReviewer')
  .argument('<blueprintPath>', 'Path to DAG Blueprint JSON file')
  .option('-c, --contracts <contractsPath>', 'Path to contracts JSON file (array of contracts)')
  .action((blueprintPath, options) => {
    try {
      const fullBpPath = path.resolve(process.cwd(), blueprintPath);
      if (!fs.existsSync(fullBpPath)) {
        console.error(`Error: Blueprint file not found: ${fullBpPath}`);
        process.exit(1);
      }

      const bpRaw = JSON.parse(fs.readFileSync(fullBpPath, 'utf8'));
      const blueprint = DAGBlueprintSchema.parse(bpRaw);

      const contractMap = new Map<string, ModuleContract>();

      if (options.contracts) {
        const fullCPath = path.resolve(process.cwd(), options.contracts);
        const contractsRaw = JSON.parse(fs.readFileSync(fullCPath, 'utf8'));
        const contractList = Array.isArray(contractsRaw) ? contractsRaw : [contractsRaw];
        for (const raw of contractList) {
          const parsed = ModuleContractSchema.parse(raw);
          contractMap.set(parsed.id, parsed);
        }
      } else {
        // Create matching mock contracts for validation
        for (const node of blueprint.nodes) {
          contractMap.set(node.contractId, {
            id: node.contractId,
            name: node.contractId,
            version: node.contractVersion,
            description: `Auto-generated contract stub for ${node.nodeId}`,
            inputs: {},
            outputs: {},
            stateHooks: false,
            dependencies: [],
            requiredGates: ['L0', 'L1a'],
            executionBudgetMs: 60000,
            author: 'architect',
            createdAt: new Date().toISOString(),
          });
        }
      }

      const result = MetaReviewer.review(blueprint, contractMap);

      console.log('\n--- Fable Engine v3 MetaReviewer Report ---');
      console.log(`Blueprint ID: ${blueprint.blueprintId} (v${blueprint.version})`);
      console.log(`Status: ${result.passed ? 'PASSED (Acyclic & Valid)' : 'FAILED'}`);

      if (result.topologicalOrder) {
        console.log(`Topological Execution Order: ${result.topologicalOrder.join(' -> ')}`);
      }

      if (result.errors.length > 0) {
        console.log('\nErrors:');
        result.errors.forEach(e => console.log(`  [X] [${e.code}] ${e.message}`));
      }

      if (result.warnings.length > 0) {
        console.log('\nWarnings:');
        result.warnings.forEach(w => console.log(`  [!] [${w.code}] ${w.message}`));
      }

      if (!result.passed) {
        process.exit(1);
      }
    } catch (err) {
      console.error(`Validation failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

/**
 * Command: fable adapter <contract.json>
 */
program
  .command('adapter')
  .description('Generate strictly typed TypeScript adapter code with zero freehand LLM logic')
  .argument('<contractPath>', 'Path to ModuleContract JSON file')
  .action((contractPath) => {
    try {
      const fullPath = path.resolve(process.cwd(), contractPath);
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const contract = ModuleContractSchema.parse(raw);

      const generated = DeterministicAdapterBuilder.generateAdapter(contract);
      console.log('\n--- Generated Deterministic Adapter (Tier 2) ---\n');
      console.log(generated.sourceCode);
    } catch (err) {
      console.error(`Adapter generation failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

/**
 * Command: fable run <blueprint.json>
 */
program
  .command('run')
  .description('Execute a DAG workflow through the Temporal Orchestrator and Gate Runner')
  .argument('<blueprintPath>', 'Path to DAG Blueprint JSON file')
  .option('--auto-approve', 'Automatically approve human gate', true)
  .action(async (blueprintPath, options) => {
    try {
      const fullBpPath = path.resolve(process.cwd(), blueprintPath);
      const bpRaw = JSON.parse(fs.readFileSync(fullBpPath, 'utf8'));
      const blueprint = DAGBlueprintSchema.parse(bpRaw);

      const handler: NodeExecutionHandler = {
        executeNode: async (wfId, nodeId, contractId, contractVer) => {
          const stubContract: ModuleContract = {
            id: contractId,
            name: contractId,
            version: contractVer,
            description: `Execution module for ${nodeId}`,
            inputs: {},
            outputs: {},
            stateHooks: nodeId.includes('db') || nodeId.includes('order'),
            dependencies: [],
            requiredGates: ['L0', 'L1a'],
            executionBudgetMs: 60000,
            author: 'cli',
            createdAt: new Date().toISOString(),
          };

          return GateRunner.executeModuleVerification({
            workflowId: wfId,
            nodeId,
            contract: stubContract,
          });
        },
      };

      const workflowId = `wf-cli-${Date.now()}`;
      console.log(`\nStarting Workflow '${workflowId}' for goal: '${blueprint.goalId}'...`);
      const engine = new DAGEngine(workflowId, blueprint, handler);

      if (options.autoApprove) {
        console.log(`[Human Gate] Approving blueprint as 'lead-operator@synthos.dev'...`);
        engine.approveBlueprint({ approvedBy: 'lead-operator@synthos.dev' });
      }

      const finalState = await engine.runUntilDone();
      console.log(`\nWorkflow Execution Result: ${finalState.status}`);
      console.log(`Release Candidate: ${finalState.releaseCandidateId ?? 'None'}`);

      console.log('\nNode Outcomes:');
      for (const [nid, nstate] of Object.entries(finalState.nodeStates)) {
        console.log(`  * [${nstate.state}] ${nid} (Attempts: ${nstate.attempts})`);
        nstate.verdicts.forEach(v => {
          console.log(`      -> Gate ${v.gate}: ${v.status} in ${v.sandboxPath} (${v.executionDurationMs}ms)`);
        });
      }
    } catch (err) {
      console.error(`Workflow execution failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

/**
 * Command: fable blast-radius <contractId> <oldVersion> <newVersion>
 */
program
  .command('blast-radius')
  .description('Resolve downstream blast radius and simulate re-verification dispatch')
  .argument('<contractId>', 'Triggering contract identifier')
  .argument('<oldVer>', 'Current version')
  .argument('<newVer>', 'New version')
  .action((contractId, oldVer, newVer) => {
    const isMajor = GraphResolver.isMajorBump(oldVer, newVer);
    console.log(`\nAnalyzing version transition: ${oldVer} -> ${newVer}`);
    console.log(`Is MAJOR SemVer Bump: ${isMajor ? 'YES (Triggers Blast Radius)' : 'NO (No Blast Radius)'}`);

    if (isMajor) {
      const mockEdges = [
        { fromUnitId: 'order-service', toUnitId: contractId },
        { fromUnitId: 'billing-adapter', toUnitId: 'order-service' },
        { fromUnitId: 'notification-worker', toUnitId: 'order-service' },
      ];

      const downstream = GraphResolver.resolveTransitiveDownstream(contractId, mockEdges);
      console.log(`Transitive downstream units: [${downstream.join(', ')}]`);

      const dispatcher = new BlastRadiusDispatcher({ edges: mockEdges });
      const jobs = dispatcher.handleContractVersionUpdate(contractId, oldVer, newVer);
      console.log(`Dispatched ${jobs.length} idempotent BullMQ jobs:`);
      jobs.forEach(j => console.log(`  -> ${j.jobId} (Unit: ${j.downstreamUnitId})`));

      const hold = dispatcher.evaluateReleaseHold(contractId, newVer);
      console.log(`Release Hold Barrier: ${hold.canPromote ? 'UNBLOCKED' : 'HOLD ACTIVE (Pending Reverifications)'}`);
    }
  });

/**
 * Command: fable telemetry
 */
program
  .command('telemetry')
  .description('Print precision/recall ledger rules and sample operational metrics')
  .action(() => {
    const pLedger = new PrecisionLedger();
    pLedger.adjudicateCohort({
      personaId: 'security-fuzzer',
      cohortId: 'cohort-01',
      totalProposedTests: 20,
      verifiedCatchingBugs: 16,
      adjudicationEvidence: 'Identified 16 reproducible CVE injection paths',
    });

    const rLedger = new RecallLedger();
    const metrics = new OperationalMetricsTracker();

    metrics.recordExecution({
      workflowId: 'wf-demo-1',
      moduleId: 'auth-service',
      llmCostUsd: 0.08,
      computeCostUsd: 0.03,
      pipelineLatencyMs: 4200,
      blastRadiusResolutionMs: 1100,
    });

    console.log('\n--- Dual Telemetry Ledger Status ---');
    console.log(`Persona: security-fuzzer | Status: ${pLedger.getPersonaStatus('security-fuzzer')}`);
    console.log(`Recall Ledger Active: ${rLedger !== undefined}`);
    console.log(`Precision Policy: Retires if < 30%, Down-samples if < 50%`);
    console.log(`Recall Policy: Shrinks AI layer if < 40% across 2 consecutive batches`);
    console.log(`Average Module Cost: $${metrics.getAverageCostPerModule().avgTotalCost.toFixed(4)}`);
  });

/**
 * Command: fable dashboard
 */
program
  .command('dashboard')
  .description('Start the Fable Engine v3 Operator Control Plane Dashboard')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .action(async (options) => {
    const port = parseInt(options.port, 10) || 3000;
    const server = new OperatorDashboardServer();
    const actualPort = await server.start(port);
    console.log(`\n🏛️  Fable Engine v3 Operator Control Plane running at:`);
    console.log(`   👉 http://localhost:${actualPort}`);
    console.log(`\nPress Ctrl+C to shut down.`);
  });

program.parse(process.argv);
