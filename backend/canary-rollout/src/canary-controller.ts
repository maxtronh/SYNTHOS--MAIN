import type { SlsaAttestationAuthority, SignedAttestationEnvelope } from '@fable/attestation-slsa';

export type CanaryStatus = 'INITIALIZED' | 'PROGRESSING' | 'PROMOTED_100' | 'ROLLED_BACK';

export interface CanaryThresholds {
  maxErrorRate: number;    // e.g. 0.01 (1%)
  maxP99LatencyMs: number; // e.g. 500ms
}

export interface CanaryMetricSample {
  errorRate: number;
  p99LatencyMs: number;
  sampleSize: number;
}

export interface CanaryRolloutState {
  rolloutId: string;
  releaseCandidateId: string;
  status: CanaryStatus;
  currentWeightPercent: number;
  steps: number[];
  stepIndex: number;
  rollbackReason?: string | undefined;
  updatedAt: string;
}

/**
 * Phase 18: Progressive Canary Deployment & Automated Rollback Controller.
 * Enforces SLSA attestation verification before initializing traffic shifts and
 * automatically aborts/rolls back on SLO degradation.
 */
export class CanaryRolloutController {
  private state: CanaryRolloutState;
  private readonly thresholds: CanaryThresholds;

  constructor(options: {
    rolloutId: string;
    releaseCandidateId: string;
    attestationAuthority: SlsaAttestationAuthority;
    attestations: SignedAttestationEnvelope[];
    humanApprovedPromotion: boolean;
    steps?: number[];
    thresholds?: Partial<CanaryThresholds>;
  }) {
    if (!options.humanApprovedPromotion) {
      throw new Error('Canary Blocked: Explicit human release approval is mandatory before production traffic shift.');
    }

    // Cryptographically verify SLSA provenance before any production rollout
    options.attestationAuthority.assertReleaseAuthorized(options.attestations);

    const steps = options.steps ?? [5, 25, 50, 100];
    if (steps.length === 0) {
      throw new Error('Canary rollout steps cannot be empty.');
    }

    this.thresholds = {
      maxErrorRate: options.thresholds?.maxErrorRate ?? 0.01,
      maxP99LatencyMs: options.thresholds?.maxP99LatencyMs ?? 500,
    };

    this.state = {
      rolloutId: options.rolloutId,
      releaseCandidateId: options.releaseCandidateId,
      status: 'INITIALIZED',
      currentWeightPercent: 0,
      steps,
      stepIndex: -1,
      updatedAt: new Date().toISOString(),
    };
  }

  public getState(): Readonly<CanaryRolloutState> {
    return this.state;
  }

  /**
   * Advances canary traffic weight if previous step telemetry satisfies SLO thresholds;
   * otherwise triggers immediate rollback to 0% weight.
   */
  public evaluateAndAdvance(sample?: CanaryMetricSample): CanaryRolloutState {
    if (this.state.status === 'ROLLED_BACK' || this.state.status === 'PROMOTED_100') {
      return this.state;
    }

    if (sample) {
      const breachReason = this.detectSloBreach(sample);
      if (breachReason) {
        this.state.status = 'ROLLED_BACK';
        this.state.currentWeightPercent = 0;
        this.state.rollbackReason = breachReason;
        this.state.updatedAt = new Date().toISOString();
        return this.state;
      }
    }

    this.state.stepIndex++;
    const nextWeight = this.state.steps[this.state.stepIndex];
    if (nextWeight === undefined) {
      this.state.status = 'PROMOTED_100';
      this.state.currentWeightPercent = 100;
    } else {
      this.state.currentWeightPercent = nextWeight;
      this.state.status = nextWeight >= 100 ? 'PROMOTED_100' : 'PROGRESSING';
    }

    this.state.updatedAt = new Date().toISOString();
    return this.state;
  }

  private detectSloBreach(sample: CanaryMetricSample): string | null {
    if (sample.errorRate > this.thresholds.maxErrorRate) {
      return `Error rate ${(sample.errorRate * 100).toFixed(2)}% exceeded max threshold ${(this.thresholds.maxErrorRate * 100).toFixed(2)}%`;
    }
    if (sample.p99LatencyMs > this.thresholds.maxP99LatencyMs) {
      return `P99 latency ${sample.p99LatencyMs}ms exceeded max threshold ${this.thresholds.maxP99LatencyMs}ms`;
    }
    return null;
  }
}
