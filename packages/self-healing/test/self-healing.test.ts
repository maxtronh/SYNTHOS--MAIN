import { describe, it, expect } from 'vitest';
import type { ModuleContract } from '@fable/contracts';
import type { ProductionEscapeRecord } from '@fable/ledger-telemetry';
import { GoldenRegressionGenerator, AdaptiveModelRouter } from '../src/index.js';

describe('Phases 24 & 23: Golden Regression & Adaptive Model Router Suite', () => {
  it('Phase 24: generates permanent L1a Vitest regression tests from production escapes', () => {
    const escape: ProductionEscapeRecord = {
      escapeId: 'esc-zero-div-01',
      description: 'Zero division when invoice line count is 0',
      personaInvolved: 'edge-chaos',
      batchId: 'b-10',
      hadOpportunityToDetect: true,
      wasReasonablyCatchable: true,
      adjudicatedBy: 'staff-engineer',
      timestamp: new Date().toISOString(),
    };

    const golden = GoldenRegressionGenerator.generateFromEscape(escape);
    expect(golden.targetGate).toBe('L1a');
    expect(golden.fileName).toBe('golden_esc-zero-div-01.test.ts');
    expect(golden.vitestSourceCode).toContain("describe('Golden Regression Lock: esc-zero-div-01'");
    expect(golden.vitestSourceCode).toContain('Zero division when invoice line count is 0');
  });

  it('Phase 23: routes low-risk modules to Flash and high-risk stateful/security modules to frontier reasoning models', () => {
    const lowRiskContract: ModuleContract = {
      id: 'c-fmt',
      name: 'date-formatter',
      version: '1.0.0',
      description: 'Formats ISO dates',
      inputs: {},
      outputs: {},
      stateHooks: false,
      dependencies: [],
      requiredGates: ['L0', 'L1a'],
      executionBudgetMs: 10000,
      author: 'dev',
      createdAt: new Date().toISOString(),
    };

    const highRiskContract: ModuleContract = {
      id: 'c-pay',
      name: 'payment-ledger-migrator',
      version: '2.0.0',
      description: 'Handles database migrations for financial ledger',
      inputs: {},
      outputs: {},
      stateHooks: true,
      dependencies: [],
      requiredGates: ['L0', 'L1a', 'L3'],
      executionBudgetMs: 120000,
      author: 'arch',
      createdAt: new Date().toISOString(),
    };

    const lowRoute = AdaptiveModelRouter.routeContract(lowRiskContract);
    expect(lowRoute.riskTier).toBe('LOW');
    expect(lowRoute.primaryModelName).toBe('gemini-1.5-flash');
    expect(lowRoute.metaReviewerFamily).not.toBe(lowRoute.primaryFamily);

    const highRoute = AdaptiveModelRouter.routeContract(highRiskContract);
    expect(highRoute.riskTier).toBe('HIGH');
    expect(highRoute.primaryModelName).toBe('claude-3-5-sonnet-20241022');
    expect(highRoute.metaReviewerFamily).toBe('gemini');
  });
});
