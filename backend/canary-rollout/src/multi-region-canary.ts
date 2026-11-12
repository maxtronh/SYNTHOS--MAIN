import type { SlsaAttestationAuthority, SignedAttestationEnvelope } from '@fable/attestation-slsa';
import {
  CanaryRolloutController,
  type CanaryMetricSample,
  type CanaryRolloutState,
  type CanaryThresholds,
} from './canary-controller.js';

export type MultiRegionStatus = 'IN_PROGRESS' | 'COMPLETED_ALL_REGIONS' | 'GLOBAL_ROLLBACK';

export interface MultiRegionRolloutSnapshot {
  rolloutId: string;
  releaseCandidateId: string;
  status: MultiRegionStatus;
  activeRegionIndex: number;
  regions: string[];
  regionalStates: Record<string, CanaryRolloutState>;
  abortReason?: string | undefined;
}

/**
 * Phase 34: Multi-Region Progressive Canary Orchestrator with SLSA-Guarded Global Rollback.
 * Advances regions sequentially; re-verifies SLSA provenance per wave and cascades
 * rollback across all prior promoted regions if any region breaches SLOs.
 */
export class MultiRegionCanaryOrchestrator {
  private readonly rolloutId: string;
  private readonly releaseCandidateId: string;
  private readonly regions: string[];
  private readonly controllers = new Map<string, CanaryRolloutController>();
  private readonly authority: SlsaAttestationAuthority;
  private readonly attestations: SignedAttestationEnvelope[];

  private activeRegionIndex: number = 0;
  private status: MultiRegionStatus = 'IN_PROGRESS';
  private abortReason?: string | undefined;

  constructor(options: {
    rolloutId: string;
    releaseCandidateId: string;
    regions: string[];
    attestationAuthority: SlsaAttestationAuthority;
    attestations: SignedAttestationEnvelope[];
    humanApprovedPromotion: boolean;
    stepsPerRegion?: number[];
    thresholds?: Partial<CanaryThresholds>;
  }) {
    if (options.regions.length === 0) {
      throw new Error('At least one target region is required for multi-region rollout.');
    }

    this.rolloutId = options.rolloutId;
    this.releaseCandidateId = options.releaseCandidateId;
    this.regions = [...options.regions];
    this.authority = options.attestationAuthority;
    this.attestations = options.attestations;

    for (const region of this.regions) {
      const ctrlOptions: ConstructorParameters<typeof CanaryRolloutController>[0] = {
        rolloutId: `${options.rolloutId}-${region}`,
        releaseCandidateId: options.releaseCandidateId,
        attestationAuthority: options.attestationAuthority,
        attestations: options.attestations,
        humanApprovedPromotion: options.humanApprovedPromotion,
      };
      if (options.stepsPerRegion) ctrlOptions.steps = options.stepsPerRegion;
      if (options.thresholds) ctrlOptions.thresholds = options.thresholds;

      this.controllers.set(region, new CanaryRolloutController(ctrlOptions));
    }
  }

  public getSnapshot(): MultiRegionRolloutSnapshot {
    const regionalStates: Record<string, CanaryRolloutState> = {};
    for (const [region, ctrl] of this.controllers.entries()) {
      regionalStates[region] = ctrl.getState();
    }

    return {
      rolloutId: this.rolloutId,
      releaseCandidateId: this.releaseCandidateId,
      status: this.status,
      activeRegionIndex: this.activeRegionIndex,
      regions: [...this.regions],
      regionalStates,
      abortReason: this.abortReason,
    };
  }

  /**
   * Advances the currently active region one canary step.
   * Re-verifies SLSA provenance at each regional boundary; cascades rollback globally on SLO breach.
   */
  public advanceActiveRegion(sample?: CanaryMetricSample): MultiRegionRolloutSnapshot {
    if (this.status !== 'IN_PROGRESS') {
      return this.getSnapshot();
    }

    const activeRegion = this.regions[this.activeRegionIndex];
    const controller = activeRegion ? this.controllers.get(activeRegion) : undefined;
    if (!activeRegion || !controller) {
      this.status = 'COMPLETED_ALL_REGIONS';
      return this.getSnapshot();
    }

    // Re-verify SLSA provenance before shifting traffic in this region
    try {
      this.authority.assertReleaseAuthorized(this.attestations);
    } catch (err) {
      this.triggerGlobalRollback(`SLSA verification failed in region '${activeRegion}': ${(err as Error).message}`);
      return this.getSnapshot();
    }

    const regionState = controller.evaluateAndAdvance(sample);
    if (regionState.status === 'ROLLED_BACK') {
      this.triggerGlobalRollback(
        `SLO breach in region '${activeRegion}': ${regionState.rollbackReason ?? 'unknown'}`
      );
      return this.getSnapshot();
    }

    if (regionState.status === 'PROMOTED_100') {
      this.activeRegionIndex++;
      if (this.activeRegionIndex >= this.regions.length) {
        this.status = 'COMPLETED_ALL_REGIONS';
      }
    }

    return this.getSnapshot();
  }

  private triggerGlobalRollback(reason: string): void {
    this.status = 'GLOBAL_ROLLBACK';
    this.abortReason = reason;
    for (const ctrl of this.controllers.values()) {
      ctrl.forceRollback(reason);
    }
  }
}
