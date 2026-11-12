import crypto from 'crypto';
import type { PrecisionLedger, RecallLedger, PersonaStatus } from '@fable/ledger-telemetry';
import type { ModelFamily, PersonaType } from './types.js';

export interface ModelRegistryEntry {
  modelId: string;
  family: ModelFamily;
  modelName: string;
  modelVersion: string;
  deprecated: boolean;
}

export interface PersonaVersionSpec {
  persona: PersonaType;
  version: string;
  promptTemplate: string;
  promptSha256: string;
  boundModelId: string;
  confidenceScore: number;
}

export interface PersonaEligibilityDecision {
  persona: PersonaType;
  version: string;
  eligible: boolean;
  ledgerStatus: PersonaStatus;
  samplingRate: number;
  layerShrinkRecommended: boolean;
  promptSha256: string;
  boundModel: ModelRegistryEntry;
  confidenceScore: number;
  reason?: string | undefined;
}

/**
 * Phase 39: Versioned LLM Model Registry & Ledger-Bound Persona Governance.
 * Computes deterministic prompt SHA-256 hashes and enforces PrecisionLedger/RecallLedger
 * retirement and down-sampling policies before dispatching AI advisory reviews.
 */
export class ModelRegistry {
  private readonly models = new Map<string, ModelRegistryEntry>();
  private readonly personaVersions = new Map<PersonaType, PersonaVersionSpec[]>();

  public registerModel(entry: Omit<ModelRegistryEntry, 'deprecated'> & { deprecated?: boolean }): ModelRegistryEntry {
    const normalized: ModelRegistryEntry = {
      ...entry,
      deprecated: entry.deprecated ?? false,
    };
    this.models.set(normalized.modelId, normalized);
    return normalized;
  }

  public getModel(modelId: string): ModelRegistryEntry | undefined {
    return this.models.get(modelId);
  }

  public registerPersonaVersion(input: {
    persona: PersonaType;
    version: string;
    promptTemplate: string;
    boundModelId: string;
    confidenceScore: number;
  }): PersonaVersionSpec {
    const model = this.models.get(input.boundModelId);
    if (!model) {
      throw new Error(`Cannot bind persona '${input.persona}' to unknown model '${input.boundModelId}'.`);
    }
    if (model.deprecated) {
      throw new Error(`Cannot bind persona '${input.persona}' to deprecated model '${input.boundModelId}'.`);
    }
    if (input.confidenceScore < 0 || input.confidenceScore > 1) {
      throw new Error(`Persona confidenceScore must be within [0, 1], got ${input.confidenceScore}.`);
    }

    const promptSha256 = crypto
      .createHash('sha256')
      .update(input.promptTemplate, 'utf8')
      .digest('hex');

    const spec: PersonaVersionSpec = {
      persona: input.persona,
      version: input.version,
      promptTemplate: input.promptTemplate,
      promptSha256,
      boundModelId: input.boundModelId,
      confidenceScore: input.confidenceScore,
    };

    const existing = this.personaVersions.get(input.persona) ?? [];
    existing.push(spec);
    this.personaVersions.set(input.persona, existing);
    return spec;
  }

  public getLatestPersonaVersion(persona: PersonaType): PersonaVersionSpec | undefined {
    const list = this.personaVersions.get(persona);
    if (!list || list.length === 0) return undefined;
    return list[list.length - 1];
  }

  /**
   * Evaluates whether the latest registered version of a persona may run,
   * consulting PrecisionLedger (retire/down-sample) and RecallLedger (AI layer reduction).
   */
  public resolveEligiblePersona(
    persona: PersonaType,
    precisionLedger: PrecisionLedger,
    recallLedger?: RecallLedger,
    ledgerPersonaKey?: string
  ): PersonaEligibilityDecision {
    const spec = this.getLatestPersonaVersion(persona);
    if (!spec) {
      throw new Error(`No registered version found for persona '${persona}'.`);
    }

    const boundModel = this.models.get(spec.boundModelId);
    if (!boundModel) {
      throw new Error(`Bound model '${spec.boundModelId}' missing from registry.`);
    }

    const lookupId = ledgerPersonaKey ?? persona;
    const ledgerStatus = precisionLedger.getPersonaStatus(lookupId);
    const layerShrinkRecommended = recallLedger ? recallLedger.shouldShrinkAILayer(lookupId) : false;

    if (boundModel.deprecated) {
      return {
        persona,
        version: spec.version,
        eligible: false,
        ledgerStatus,
        samplingRate: 0,
        layerShrinkRecommended,
        promptSha256: spec.promptSha256,
        boundModel,
        confidenceScore: spec.confidenceScore,
        reason: `Bound model '${boundModel.modelId}' is deprecated.`,
      };
    }

    if (ledgerStatus === 'RETIRED') {
      return {
        persona,
        version: spec.version,
        eligible: false,
        ledgerStatus,
        samplingRate: 0,
        layerShrinkRecommended,
        promptSha256: spec.promptSha256,
        boundModel,
        confidenceScore: spec.confidenceScore,
        reason: `Persona '${lookupId}' is RETIRED in PrecisionLedger (< 30% precision).`,
      };
    }

    const samplingRate = ledgerStatus === 'DOWN_SAMPLED' ? 0.25 : (layerShrinkRecommended ? 0.5 : 1.0);

    return {
      persona,
      version: spec.version,
      eligible: true,
      ledgerStatus,
      samplingRate,
      layerShrinkRecommended,
      promptSha256: spec.promptSha256,
      boundModel,
      confidenceScore: spec.confidenceScore,
    };
  }
}
