import type { ProductionEscapeRecord, PersonaRecallBatch } from './types.js';

export class RecallLedger {
  private escapeRecords: ProductionEscapeRecord[] = [];
  private batchRecords: Map<string, PersonaRecallBatch> = new Map();

  /**
   * Record a production escape and evaluate catchability.
   */
  public recordEscape(escape: {
    escapeId: string;
    description: string;
    personaInvolved: string;
    batchId: string;
    hadOpportunityToDetect: boolean;
    wasReasonablyCatchable: boolean;
    adjudicatedBy: string;
  }): ProductionEscapeRecord {
    const record: ProductionEscapeRecord = {
      ...escape,
      timestamp: new Date().toISOString(),
    };
    this.escapeRecords.push(record);
    return record;
  }

  /**
   * Evaluates recall for a persona over a specific batch.
   * Numerator: catchable bugs detected / prevented
   * Denominator: total catchable bugs
   */
  public evaluateBatchRecall(input: {
    personaId: string;
    batchId: string;
    detectedCount: number;
  }): PersonaRecallBatch {
    // Count escapes where this persona had opportunity and was reasonably catchable
    const missedCatchableEscapes = this.escapeRecords.filter(
      e => e.personaInvolved === input.personaId &&
           e.batchId === input.batchId &&
           e.hadOpportunityToDetect &&
           e.wasReasonablyCatchable
    ).length;

    const totalCatchable = input.detectedCount + missedCatchableEscapes;
    const recallRatio = totalCatchable === 0 ? 1.0 : input.detectedCount / totalCatchable;

    const batchRecord: PersonaRecallBatch = {
      personaId: input.personaId,
      batchId: input.batchId,
      totalCatchableEscapes: totalCatchable,
      detectedCount: input.detectedCount,
      recallRatio,
      timestamp: new Date().toISOString(),
    };

    this.batchRecords.set(`${input.personaId}:${input.batchId}`, batchRecord);
    return batchRecord;
  }

  /**
   * Check policy: If recall is below 40% for two consecutive batches, shrink AI layer.
   */
  public shouldShrinkAILayer(personaId: string): boolean {
    const batches = Array.from(this.batchRecords.values())
      .filter(b => b.personaId === personaId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (batches.length < 2) return false;

    // Check last two consecutive batches
    const lastTwo = batches.slice(-2);
    return (lastTwo[0]?.recallRatio ?? 1) < 0.4 && (lastTwo[1]?.recallRatio ?? 1) < 0.4;
  }
}
