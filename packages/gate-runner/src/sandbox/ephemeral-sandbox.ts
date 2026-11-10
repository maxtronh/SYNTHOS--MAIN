import type { SandboxPath } from '@fable/contracts';
import type {
  ISandboxEnvironment,
  CommandExecutionResult,
  SandboxProvisionOptions,
} from './types.js';

export class EphemeralSandbox implements ISandboxEnvironment {
  public readonly id: string;
  public readonly pathType: SandboxPath = 'PATH_A_EPHEMERAL';
  public readonly createdAt: string;
  private destroyed: boolean = false;
  private readonly egressAllowlist: Set<string>;

  constructor(options: SandboxProvisionOptions) {
    this.id = `sandbox-ephemeral-${options.jobId}`;
    this.createdAt = new Date().toISOString();
    // Egress allowlist per architecture RFC: only MinIO and LLM gateway
    this.egressAllowlist = new Set(options.egressAllowlist ?? ['minio.internal', 'llm-gateway.internal']);
  }

  public async executeCommand(
    command: string,
    args: string[] = [],
    timeoutMs: number = 60000
  ): Promise<CommandExecutionResult> {
    if (this.destroyed) {
      throw new Error(`Cannot execute in destroyed sandbox '${this.id}'.`);
    }

    const startTime = Date.now();

    // Check network security boundaries if command tries egress
    if (command.includes('curl') || command.includes('fetch')) {
      const targetHost = args[0] ?? '';
      const allowed = Array.from(this.egressAllowlist).some(host => targetHost.includes(host));
      if (!allowed && targetHost !== '') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Egress blocked: Destination '${targetHost}' not in allowlist: [${Array.from(this.egressAllowlist).join(', ')}]`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Simulate fast command execution in isolated environment
    return {
      exitCode: 0,
      stdout: `[${this.id}] Executed: ${command} ${args.join(' ')}`,
      stderr: '',
      durationMs: Math.min(15, timeoutMs),
    };
  }

  public async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }
}
