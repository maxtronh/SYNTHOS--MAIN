import type {
  EbpfViolationRecord,
  InspectionOutcome,
  NetworkConnectEvent,
  SyscallEvent,
} from './types.js';

const FORBIDDEN_SYSCALLS = new Set<string>([
  'ptrace',
  'mount',
  'umount2',
  'kexec_load',
  'init_module',
  'finit_module',
  'setuid',
  'setgid',
  'chroot',
]);

const METADATA_ENDPOINTS = new Set<string>([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.azure.internal',
]);

/**
 * Real-time eBPF kernel syscall and network egress auditor for isolated sandboxes.
 * Triggers immediate container termination on privilege escalation or SSRF attempts.
 */
export class EbpfRuntimeAuditor {
  private readonly egressAllowlist: Set<string>;
  private readonly violations: EbpfViolationRecord[] = [];

  constructor(egressAllowlist: string[] = ['minio.internal', 'llm-gateway.internal']) {
    this.egressAllowlist = new Set(egressAllowlist);
  }

  /**
   * Evaluates a captured syscall event against kernel security policies.
   */
  public inspectSyscall(event: SyscallEvent): InspectionOutcome {
    if (!FORBIDDEN_SYSCALLS.has(event.syscall)) {
      return { decision: 'ALLOW' };
    }

    const violation = this.recordViolation(
      event.sandboxId,
      'FORBIDDEN_SYSCALL',
      `Blocked forbidden kernel syscall '${event.syscall}' by PID ${event.pid}`
    );

    return { decision: 'DENY_AND_KILL', violation };
  }

  /**
   * Evaluates an outbound socket connect() probe against SSRF blocks and egress allowlist.
   */
  public inspectNetworkConnect(event: NetworkConnectEvent): InspectionOutcome {
    const normalizedHost = event.destinationHost.trim().toLowerCase();

    if (METADATA_ENDPOINTS.has(normalizedHost)) {
      const violation = this.recordViolation(
        event.sandboxId,
        'CLOUD_METADATA_SSRF',
        `Blocked SSRF attempt to cloud metadata IP/host '${normalizedHost}:${event.port}'`
      );
      return { decision: 'DENY_AND_KILL', violation };
    }

    const isAllowed = Array.from(this.egressAllowlist).some(
      allowed => normalizedHost === allowed || normalizedHost.endsWith(`.${allowed}`)
    );

    if (!isAllowed) {
      const violation = this.recordViolation(
        event.sandboxId,
        'UNAUTHORIZED_EGRESS',
        `Blocked unauthorized egress connection to '${normalizedHost}:${event.port}'`
      );
      return { decision: 'DENY_AND_KILL', violation };
    }

    return { decision: 'ALLOW' };
  }

  public getViolations(sandboxId?: string): EbpfViolationRecord[] {
    if (!sandboxId) return [...this.violations];
    return this.violations.filter(v => v.sandboxId === sandboxId);
  }

  private recordViolation(
    sandboxId: string,
    category: EbpfViolationRecord['category'],
    detail: string
  ): EbpfViolationRecord {
    const violation: EbpfViolationRecord = {
      violationId: `ebpf-v-${sandboxId}-${this.violations.length + 1}`,
      sandboxId,
      category,
      detail,
      killTriggered: true,
      detectedAt: new Date().toISOString(),
    };
    this.violations.push(violation);
    return violation;
  }
}
