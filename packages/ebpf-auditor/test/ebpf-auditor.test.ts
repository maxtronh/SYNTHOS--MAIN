import { describe, it, expect } from 'vitest';
import { EbpfRuntimeAuditor } from '../src/index.js';

describe('Phase 12: eBPF Syscall & Network Egress Auditor Suite', () => {
  it('allows normal file/process syscalls and blocks kernel escape syscalls', () => {
    const auditor = new EbpfRuntimeAuditor();
    const now = new Date().toISOString();

    const readRes = auditor.inspectSyscall({
      sandboxId: 'sb-1',
      pid: 42,
      syscall: 'read',
      args: ['fd=3'],
      timestamp: now,
    });
    expect(readRes.decision).toBe('ALLOW');

    const ptraceRes = auditor.inspectSyscall({
      sandboxId: 'sb-1',
      pid: 42,
      syscall: 'ptrace',
      args: ['PTRACE_ATTACH', '1'],
      timestamp: now,
    });
    expect(ptraceRes.decision).toBe('DENY_AND_KILL');
    expect(ptraceRes.violation?.category).toBe('FORBIDDEN_SYSCALL');
    expect(ptraceRes.violation?.killTriggered).toBe(true);
  });

  it('blocks cloud metadata SSRF and non-allowlisted outbound network sockets', () => {
    const auditor = new EbpfRuntimeAuditor(['minio.internal', 'llm-gateway.internal']);
    const now = new Date().toISOString();

    // Permitted internal service
    const allowMinio = auditor.inspectNetworkConnect({
      sandboxId: 'sb-2',
      destinationHost: 'minio.internal',
      port: 9000,
      protocol: 'TCP',
      timestamp: now,
    });
    expect(allowMinio.decision).toBe('ALLOW');

    // Cloud IMDS SSRF attempt -> Blocked!
    const ssrfRes = auditor.inspectNetworkConnect({
      sandboxId: 'sb-2',
      destinationHost: '169.254.169.254',
      port: 80,
      protocol: 'TCP',
      timestamp: now,
    });
    expect(ssrfRes.decision).toBe('DENY_AND_KILL');
    expect(ssrfRes.violation?.category).toBe('CLOUD_METADATA_SSRF');

    // Unauthorized external destination -> Blocked!
    const exfilRes = auditor.inspectNetworkConnect({
      sandboxId: 'sb-2',
      destinationHost: 'evil.attacker.com',
      port: 443,
      protocol: 'TCP',
      timestamp: now,
    });
    expect(exfilRes.decision).toBe('DENY_AND_KILL');
    expect(exfilRes.violation?.category).toBe('UNAUTHORIZED_EGRESS');

    expect(auditor.getViolations('sb-2').length).toBe(2);
  });
});
