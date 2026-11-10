import { describe, it, expect } from 'vitest';
import {
  ASTChunker,
  VectorRetriever,
  LLMCircuitBreaker,
  PatchLoopController,
} from '../src/index.js';

describe('Retrieval & AI Advisory Layer Suite', () => {
  const sampleSource = `
export interface UserPayload {
  id: string;
  email: string;
}

export function validateUser(user: UserPayload): boolean {
  return user.email.includes('@');
}
  `.trim();

  it('chunks TypeScript code with AST provenance and line numbers', () => {
    const chunks = ASTChunker.chunkSource('src/user.ts', sampleSource);
    expect(chunks.length).toBe(2);

    expect(chunks[0]?.symbolType).toBe('interface');
    expect(chunks[0]?.symbolName).toBe('UserPayload');
    expect(chunks[0]?.filePath).toBe('src/user.ts');
    expect(chunks[0]?.startLine).toBe(1);

    expect(chunks[1]?.symbolType).toBe('function');
    expect(chunks[1]?.symbolName).toBe('validateUser');
  });

  it('retrieves top-K chunks and assembles bounded prompt within limits', () => {
    const retriever = new VectorRetriever();
    retriever.indexCode('src/user.ts', sampleSource);

    const prompt = retriever.assembleBoundedPrompt(
      'You are an adversarial AI reviewer.',
      'validateUser',
      { topK: 2, maxTokensApprox: 500 }
    );

    expect(prompt.totalChunks).toBeGreaterThan(0);
    expect(prompt.userContext).toContain('Source: src/user.ts');
    expect(prompt.retrievedChunks[0]?.filePath).toBe('src/user.ts');
  });

  it('circuit breaker trips to OPEN and marks AI findings as DEFERRED', async () => {
    const breaker = new LLMCircuitBreaker({ failureThreshold: 2 });
    expect(breaker.getState()).toBe('CLOSED');

    const failingCall = async () => {
      throw new Error('503 Service Unavailable');
    };

    // First failure
    const res1 = await breaker.executeWithFallback(failingCall, {
      workflowId: 'wf-ai-1',
      nodeId: 'node-1',
      persona: 'adversarial-sec',
    });
    expect(res1.status).toBe('DEFERRED');

    // Second failure -> Trips circuit breaker to OPEN
    const res2 = await breaker.executeWithFallback(failingCall, {
      workflowId: 'wf-ai-1',
      nodeId: 'node-1',
      persona: 'adversarial-sec',
    });
    expect(res2.status).toBe('DEFERRED');
    expect(breaker.getState()).toBe('OPEN');

    // When OPEN, operations are intercepted without even calling downstream
    const res3 = await breaker.executeWithFallback(async () => 'never called', {
      workflowId: 'wf-ai-1',
      nodeId: 'node-1',
      persona: 'adversarial-sec',
    });
    expect(res3.status).toBe('DEFERRED');
    expect(res3.reason).toContain('Circuit Breaker is OPEN');
  });

  it('enforces 3-cycle patch cap and generates structured DecisionMemo', () => {
    const controller = new PatchLoopController({
      workflowId: 'wf-patch-001',
      goalId: 'goal-payments',
      nodeId: 'node-stripe',
      contractId: 'contract-stripe',
      contractVersion: '1.0.0',
    });

    expect(controller.canAttemptAnotherCycle()).toBe(true);

    // Cycle 1
    controller.recordCycle(
      { patchDiff: '+ added fix 1', modelPersona: 'code-builder' },
      { passed: false, failureGate: 'L1a', failureOutput: 'Property test failed' }
    );
    expect(controller.getCycleCount()).toBe(1);

    // Cycle 2
    controller.recordCycle(
      { patchDiff: '+ added fix 2', modelPersona: 'code-builder' },
      { passed: false, failureGate: 'L1a', failureOutput: 'Assertion failed' }
    );
    expect(controller.getCycleCount()).toBe(2);

    // Cycle 3
    controller.recordCycle(
      { patchDiff: '+ added fix 3', modelPersona: 'code-builder' },
      { passed: false, failureGate: 'L1a', failureOutput: 'Timeout on edge case' }
    );
    expect(controller.getCycleCount()).toBe(3);
    expect(controller.canAttemptAnotherCycle()).toBe(false);

    // 4th cycle must throw
    expect(() =>
      controller.recordCycle(
        { patchDiff: '+ fix 4', modelPersona: 'code-builder' },
        { passed: false }
      )
    ).toThrow('Maximum cycles (3) reached');

    // Generate formal DecisionMemo
    const memo = controller.generateDecisionMemo(['Is the stripe webhook signature required for test environment?']);
    expect(memo.totalCyclesAttempted).toBe(3);
    expect(memo.status).toBe('PENDING_REVIEW');
    expect(memo.patchHistory.length).toBe(3);
    expect(memo.assignedTo).toBe('senior-platform-engineer');
    expect(memo.unresolvedQuestions[0]).toContain('stripe webhook');
  });
});
