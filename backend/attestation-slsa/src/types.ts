import type { GateVerdict } from '@fable/contracts';

export interface SlsaProvenanceStatement {
  _type: 'https://in-toto.io/Statement/v1';
  predicateType: 'https://slsa.dev/provenance/v1';
  subject: Array<{
    name: string;
    digest: { sha256: string };
  }>;
  predicate: {
    buildDefinition: {
      buildType: 'https://fable.synthos.dev/build/v3';
      externalParameters: {
        workflowId: string;
        blueprintId: string;
        contractId: string;
        contractVersion: string;
      };
    };
    runDetails: {
      builder: { id: string };
      verdicts: GateVerdict[];
      evaluatedAt: string;
    };
  };
}

export interface SignedAttestationEnvelope {
  statement: SlsaProvenanceStatement;
  payloadSha256: string;
  signatureBase64: string;
  keyId: string;
  algorithm: 'ed25519';
}
