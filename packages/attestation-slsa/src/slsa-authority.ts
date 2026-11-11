import crypto from 'crypto';
import type { GateVerdict } from '@fable/contracts';
import type { SignedAttestationEnvelope, SlsaProvenanceStatement } from './types.js';

/**
 * Cryptographic Attestation & SLSA v1.0 Provenance Signing Authority.
 * Signs authoritative GateVerdicts and Release Candidates using Ed25519 keys.
 */
export class SlsaAttestationAuthority {
  private readonly keyId: string;
  private readonly privateKey: crypto.KeyObject;
  private readonly publicKey: crypto.KeyObject;

  constructor(keyId?: string) {
    const pair = crypto.generateKeyPairSync('ed25519');
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    this.keyId = keyId ?? `fable-cosign-ed25519-${crypto.randomUUID().slice(0, 8)}`;
  }

  public getKeyId(): string {
    return this.keyId;
  }

  /**
   * Produces a cryptographically signed SLSA v1.0 attestation envelope for a verified module/release.
   */
  public signProvenance(input: {
    subjectName: string;
    artifactContent: string;
    workflowId: string;
    blueprintId: string;
    contractId: string;
    contractVersion: string;
    builderId: string;
    verdicts: GateVerdict[];
  }): SignedAttestationEnvelope {
    const artifactDigest = crypto.createHash('sha256').update(input.artifactContent).digest('hex');

    const statement: SlsaProvenanceStatement = {
      _type: 'https://in-toto.io/Statement/v1',
      predicateType: 'https://slsa.dev/provenance/v1',
      subject: [
        {
          name: input.subjectName,
          digest: { sha256: artifactDigest },
        },
      ],
      predicate: {
        buildDefinition: {
          buildType: 'https://fable.synthos.dev/build/v3',
          externalParameters: {
            workflowId: input.workflowId,
            blueprintId: input.blueprintId,
            contractId: input.contractId,
            contractVersion: input.contractVersion,
          },
        },
        runDetails: {
          builder: { id: input.builderId },
          verdicts: input.verdicts,
          evaluatedAt: new Date().toISOString(),
        },
      },
    };

    const canonicalPayload = Buffer.from(canonicalStringify(statement), 'utf8');
    const payloadSha256 = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
    const signature = crypto.sign(null, canonicalPayload, this.privateKey);

    return {
      statement,
      payloadSha256,
      signatureBase64: signature.toString('base64'),
      keyId: this.keyId,
      algorithm: 'ed25519',
    };
  }

  /**
   * Verifies both payload digest integrity and Ed25519 cryptographic signature.
   */
  public verifyAttestation(envelope: SignedAttestationEnvelope): boolean {
    const canonicalPayload = Buffer.from(canonicalStringify(envelope.statement), 'utf8');
    const computedSha256 = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    if (computedSha256 !== envelope.payloadSha256) {
      return false;
    }

    const sigBuffer = Buffer.from(envelope.signatureBase64, 'base64');
    return crypto.verify(null, canonicalPayload, this.publicKey, sigBuffer);
  }

  /**
   * Release Promotion Policy Gate:
   * Blocks promotion if any envelope fails signature check or contains failed authoritative gates.
   */
  public assertReleaseAuthorized(envelopes: SignedAttestationEnvelope[]): void {
    if (envelopes.length === 0) {
      throw new Error('Release Blocked: At least one signed SLSA provenance attestation is required.');
    }

    for (const env of envelopes) {
      if (!this.verifyAttestation(env)) {
        throw new Error(`Release Blocked: Invalid or tampered SLSA cryptographic signature for key '${env.keyId}'.`);
      }

      const authoritativeFailures = env.statement.predicate.runDetails.verdicts.filter(
        v => v.isAuthoritative && v.status !== 'PASS'
      );

      if (authoritativeFailures.length > 0) {
        const failedGates = authoritativeFailures.map(v => `${v.gate}:${v.status}`).join(', ');
        throw new Error(`Release Blocked: Attestation contains non-passing authoritative gates [${failedGates}].`);
      }
    }
  }
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(',')}}`;
}
