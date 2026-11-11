import type { ModelFamily, ModelConfig, ModelCompletionResult } from './types.js';
import { LLMCircuitBreaker, type BoundedPrompt } from '@fable/retrieval-pgvector';

export class ModelGateway {
  private readonly configs: Record<ModelFamily, ModelConfig>;
  private readonly breaker: LLMCircuitBreaker;

  constructor(
    customConfigs?: Partial<Record<ModelFamily, Partial<ModelConfig>>>,
    breaker?: LLMCircuitBreaker
  ) {
    this.configs = {
      gemini: {
        family: 'gemini',
        modelName: 'gemini-1.5-pro',
        temperature: 0.2,
        maxTokens: 4096,
        ...customConfigs?.gemini,
      },
      claude: {
        family: 'claude',
        modelName: 'claude-3-5-sonnet-20241022',
        temperature: 0.1,
        maxTokens: 4096,
        ...customConfigs?.claude,
      },
      openai: {
        family: 'openai',
        modelName: 'gpt-4o',
        temperature: 0.2,
        maxTokens: 4096,
        ...customConfigs?.openai,
      },
    };

    this.breaker = breaker ?? new LLMCircuitBreaker({ failureThreshold: 3 });
  }

  /**
   * RFC Section 2 Invariant:
   * Meta-Reviewer model family must be strictly independent from the Architect model family
   * to eliminate correlated blind spots during contract consistency review.
   */
  public static validateIndependence(
    architectFamily: ModelFamily,
    metaReviewerFamily: ModelFamily
  ): boolean {
    if (architectFamily === metaReviewerFamily) {
      throw new Error(
        `Independence Violation: Meta-Reviewer cannot use the same model family (${metaReviewerFamily}) as Architect. An independent family is required by Tier 1 RFC specification.`
      );
    }
    return true;
  }

  public getModelConfig(family: ModelFamily): ModelConfig {
    return this.configs[family];
  }

  public getCircuitBreaker(): LLMCircuitBreaker {
    return this.breaker;
  }

  /**
   * Dispatches model completion with circuit-breaker protection and bounded token tracking.
   */
  public async executeCompletion(
    family: ModelFamily,
    prompt: BoundedPrompt,
    context: { workflowId: string; nodeId: string; persona: string },
    options?: { simulateError?: boolean }
  ): Promise<{
    status: 'SUCCESS' | 'DEFERRED';
    result?: ModelCompletionResult | undefined;
    reason?: string | undefined;
  }> {
    const config = this.configs[family];

    const operation = async (): Promise<ModelCompletionResult> => {
      if (options?.simulateError) {
        throw new Error(`Upstream LLM gateway error (503 Service Unavailable) for family '${family}'`);
      }

      // Generate deterministic advisory response based on bounded prompt
      const tokenCount = prompt.totalTokensApprox + 150;
      const content = `[${family.toUpperCase()} - ${config.modelName}] Generated advisory review for context with ${prompt.totalChunks} source chunks.`;

      return {
        content,
        tokensUsed: tokenCount,
        family,
        modelName: config.modelName,
      };
    };

    const outcome = await this.breaker.executeWithFallback(operation, context);

    if (outcome.status === 'DEFERRED') {
      return {
        status: 'DEFERRED',
        reason: outcome.reason ?? 'LLM Gateway degraded or circuit breaker tripped.',
      };
    }

    return {
      status: 'SUCCESS',
      result: outcome.data,
    };
  }
}
