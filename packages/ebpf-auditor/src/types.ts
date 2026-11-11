export type SyscallDecision = 'ALLOW' | 'DENY_AND_KILL';

export interface SyscallEvent {
  sandboxId: string;
  pid: number;
  syscall: string;
  args: string[];
  timestamp: string;
}

export interface NetworkConnectEvent {
  sandboxId: string;
  destinationHost: string;
  port: number;
  protocol: 'TCP' | 'UDP';
  timestamp: string;
}

export interface EbpfViolationRecord {
  violationId: string;
  sandboxId: string;
  category: 'FORBIDDEN_SYSCALL' | 'CLOUD_METADATA_SSRF' | 'UNAUTHORIZED_EGRESS';
  detail: string;
  killTriggered: boolean;
  detectedAt: string;
}

export interface InspectionOutcome {
  decision: SyscallDecision;
  violation?: EbpfViolationRecord | undefined;
}
