import { OpaPolicyEvaluator, type OperatorPrincipal } from './policy-engine.js';

export interface ProductionReadinessEvidence {
  temporalReplayVerified: boolean;
  redisReconciliationVerified: boolean;
  sandboxCleanupVerified: boolean;
  slsaProvenanceVerified: boolean;
  drGameDayPassed: boolean;
  openPreProdDecisionsResolved: boolean;
}

export interface SignOffSignature {
  principal: OperatorPrincipal;
  signedAt: string;
}

export interface ProductionSignOffVerdict {
  signOffId: string;
  approved: boolean;
  blockingReasons: string[];
  verifiedApprovers: string[];
  evaluatedAt: string;
}

const REQUIRED_EVIDENCE_CHECKS: Array<[keyof ProductionReadinessEvidence, string]> = [
  ['temporalReplayVerified', 'Temporal worker replay determinism check has not passed'],
  ['redisReconciliationVerified', 'Redis/BullMQ outage reconciliation check has not passed'],
  ['sandboxCleanupVerified', 'Path A/B sandbox cleanup & credential revocation check has not passed'],
  ['slsaProvenanceVerified', 'Ed25519 SLSA provenance signature verification has not passed'],
  ['drGameDayPassed', 'Disaster Recovery game-day drill has not passed'],
  ['openPreProdDecisionsResolved', 'All 8 pre-production open decisions must be resolved'],
];

/**
 * Phase 38: Production Readiness Sign-Off Gate.
 * Enforces complete acceptance evidence alongside dual SSO-authenticated
 * Security Lead and Release Director sign-offs before Go-Live.
 */
export class ProductionSignOffGate {
  public static evaluate(input: {
    releaseCandidateId: string;
    resourceTenantId: string;
    resourceAuthorId?: string | undefined;
    evidence: ProductionReadinessEvidence;
    signatures: SignOffSignature[];
  }): ProductionSignOffVerdict {
    const blockingReasons: string[] = [];

    for (const [key, message] of REQUIRED_EVIDENCE_CHECKS) {
      if (!input.evidence[key]) {
        blockingReasons.push(message);
      }
    }

    let hasSecuritySignOff = false;
    let hasDirectorSignOff = false;
    const verifiedApprovers: string[] = [];

    for (const sig of input.signatures) {
      const secDecision = OpaPolicyEvaluator.evaluate({
        principal: sig.principal,
        action: 'OVERRIDE_CRITICAL_THREAT',
        resourceTenantId: input.resourceTenantId,
      });

      const dirDecision = OpaPolicyEvaluator.evaluate({
        principal: sig.principal,
        action: 'PROMOTE_PRODUCTION',
        resourceTenantId: input.resourceTenantId,
        resourceAuthorId: input.resourceAuthorId,
      });

      if (secDecision.allowed) {
        hasSecuritySignOff = true;
        verifiedApprovers.push(`${sig.principal.email} (SECURITY_LEAD)`);
      }

      if (dirDecision.allowed) {
        hasDirectorSignOff = true;
        verifiedApprovers.push(`${sig.principal.email} (RELEASE_DIRECTOR)`);
      } else if (sig.principal.roles.includes('RELEASE_DIRECTOR')) {
        blockingReasons.push(...dirDecision.reasons);
      }
    }

    if (!hasSecuritySignOff) {
      blockingReasons.push('Missing authorized SSO SECURITY_LEAD sign-off.');
    }
    if (!hasDirectorSignOff) {
      blockingReasons.push('Missing authorized SSO RELEASE_DIRECTOR sign-off.');
    }

    return {
      signOffId: `signoff-${input.releaseCandidateId}-${Date.now()}`,
      approved: blockingReasons.length === 0,
      blockingReasons,
      verifiedApprovers,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
