import type { GateVerdict } from '@fable/contracts';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeoutMs: number;
}

export interface AIProposalResult {
  status: 'PROPOSED' | 'DEFERRED';
  findings: string[];
  verdict?: GateVerdict | undefined;
}

export class LLMCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private lastFailureTimeMs: number = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 3,
      recoveryTimeoutMs: config?.recoveryTimeoutMs ?? 15000,
    };
  }

  public getState(): CircuitState {
    this.checkAutoRecovery();
    return this.state;
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  public recordFailure(): void {
    this.failureCount++;
    this.lastFailureTimeMs = Date.now();
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  /**
   * Executes an advisory AI call through the circuit breaker.
   * If the circuit is open or times out, immediately returns a DEFERRED result.
   */
  public async executeWithFallback<T>(
    aiOperation: () => Promise<T>,
    fallbackDetails: { workflowId: string; nodeId: string; persona: string }
  ): Promise<{ status: 'SUCCESS' | 'DEFERRED'; data?: T | undefined; reason?: string | undefined }> {
    this.checkAutoRecovery();

    if (this.state === 'OPEN') {
      return {
        status: 'DEFERRED',
        reason: `LLM Gateway Circuit Breaker is OPEN due to repeated degradation. Finding deferred for ${fallbackDetails.persona}.`,
      };
    }

    try {
      const data = await aiOperation();
      this.recordSuccess();
      return { status: 'SUCCESS', data };
    } catch (err) {
      this.recordFailure();
      return {
        status: 'DEFERRED',
        reason: `LLM Gateway request failed: ${(err as Error).message}. Advisory finding DEFERRED.`,
      };
    }
  }

  private checkAutoRecovery(): void {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTimeMs;
      if (elapsed >= this.config.recoveryTimeoutMs) {
        this.state = 'HALF_OPEN';
      }
    }
  }
}
