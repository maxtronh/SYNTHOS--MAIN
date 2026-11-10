import { describe, it, expect } from 'vitest';
import type { ModuleContract } from '@fable/contracts';
import { DeterministicAdapterBuilder } from '../src/index.js';

describe('Deterministic Builder (Tier 2) Suite', () => {
  const contract: ModuleContract = {
    id: 'contract-payment-gateway',
    name: 'payment-gateway',
    version: '2.1.0',
    description: 'Processes credit card transactions',
    inputs: {
      amount: { type: 'number', required: true, description: 'Amount in USD cents' },
      currency: { type: 'string', required: true },
      saveCard: { type: 'boolean', required: false },
    },
    outputs: {
      transactionId: { type: 'string', required: true },
      success: { type: 'boolean', required: true },
    },
    stateHooks: false,
    dependencies: [],
    requiredGates: ['L0', 'L1a'],
    executionBudgetMs: 30000,
    author: 'architect',
    createdAt: new Date().toISOString(),
  };

  it('generates strictly typed adapter code with ingress and egress Zod validators', () => {
    const result = DeterministicAdapterBuilder.generateAdapter(contract);

    expect(result.contractId).toBe('contract-payment-gateway');
    expect(result.contractVersion).toBe('2.1.0');
    expect(result.inputValidatorName).toBe('PaymentGatewayInputSchema');
    expect(result.outputValidatorName).toBe('PaymentGatewayOutputSchema');

    // Verify source code contents
    expect(result.sourceCode).toContain('export const PaymentGatewayInputSchema = z.object({');
    expect(result.sourceCode).toContain('amount: z.number(),');
    expect(result.sourceCode).toContain('currency: z.string(),');
    expect(result.sourceCode).toContain('saveCard: z.boolean().optional(),');
    expect(result.sourceCode).toContain('export const PaymentGatewayOutputSchema = z.object({');
    expect(result.sourceCode).toContain('transactionId: z.string(),');
    expect(result.sourceCode).toContain('success: z.boolean(),');
    expect(result.sourceCode).toContain('PaymentGatewayInputSchema.parse(rawInput)');
    expect(result.sourceCode).toContain('PaymentGatewayOutputSchema.parse(rawOutput)');
  });
});
