import type { PersonaPrecisionRecord, PersonaStatus } from './types.js';

export class PrecisionLedger {
  private records: Map<string, PersonaPrecisionRecord> = new Map();

  /**
   * Adjudicate a test proposal cohort for an AI persona.
   * Numerator: verifiedCatchingBugs
   * Denominator: totalProposedTests
   */
  public adjudicateCohort(input: {
    personaId: string;
    cohortId: string;
    totalProposedTests: number;
    verifiedCatchingBugs: number;
    adjudicationEvidence: string;
  }): PersonaPrecisionRecord {
    if (input.totalProposedTests <= 0) {
      throw new Error('Denominator totalProposedTests must be greater than zero.');
    }

    const precisionRatio = input.verifiedCatchingBugs / input.totalProposedTests;

    // Policy: precision < 50% triggers down-sampling or retirement
    let status: PersonaStatus = 'ACTIVE';
    if (precisionRatio < 0.3) {
      status = 'RETIRED';
    } else if (precisionRatio < 0.5) {
      status = 'DOWN_SAMPLED';
    }

    const record: PersonaPrecisionRecord = {
      personaId: input.personaId,
      cohortId: input.cohortId,
      totalProposedTests: input.totalProposedTests,
      verifiedCatchingBugs: input.verifiedCatchingBugs,
      precisionRatio,
      status,
      adjudicationEvidence: input.adjudicationEvidence,
      evaluatedAt: new Date().toISOString(),
    };

    this.records.set(`${input.personaId}:${input.cohortId}`, record);
    return record;
  }

  public getRecord(personaId: string, cohortId: string): PersonaPrecisionRecord | undefined {
    return this.records.get(`${personaId}:${cohortId}`);
  }

  public getPersonaStatus(personaId: string): PersonaStatus {
    const personaRecords = Array.from(this.records.values())
      .filter(r => r.personaId === personaId)
      .sort((a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime());

    return personaRecords[0]?.status ?? 'ACTIVE';
  }
}
