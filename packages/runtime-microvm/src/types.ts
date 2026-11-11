import type { SandboxProvisionOptions } from '@fable/gate-runner';

export type HypervisorBackend = 'FIRECRACKER' | 'GVISOR';

export interface FirecrackerMachineConfig {
  vcpu_count: number;
  mem_size_mib: number;
  smt: boolean;
  track_dirty_pages: boolean;
}

export interface FirecrackerBootSource {
  kernel_image_path: string;
  boot_args: string;
}

export interface FirecrackerDrive {
  drive_id: string;
  path_on_host: string;
  is_root_device: boolean;
  is_read_only: boolean;
}

export interface FirecrackerManifest {
  backend: HypervisorBackend;
  vmId: string;
  bootTimeTargetMs: number;
  'machine-config': FirecrackerMachineConfig;
  'boot-source': FirecrackerBootSource;
  drives: FirecrackerDrive[];
  seccompLevel: number;
  networkInterfaces: Array<{
    iface_id: string;
    guest_mac: string;
    host_dev_name: string;
    allowlist: string[];
  }>;
}

export interface MicroVMOptions extends SandboxProvisionOptions {
  backend?: HypervisorBackend | undefined;
  vcpuCount?: number | undefined;
  memSizeMib?: number | undefined;
  seccompLevel?: number | undefined;
}
