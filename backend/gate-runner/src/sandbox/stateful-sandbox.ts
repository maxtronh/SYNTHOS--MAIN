import type { SandboxPath } from '@fable/contracts';
import type {
  ISandboxEnvironment,
  CommandExecutionResult,
  SandboxProvisionOptions,
} from './types.js';

export class StatefulSandbox implements ISandboxEnvironment {
  public readonly id: string;
  public readonly pathType: SandboxPath = 'PATH_B_STATEFUL';
  public readonly createdAt: string;
  public readonly isolatedSchemaName: string;
  private destroyed: boolean = false;
  private resourcesProvisioned: boolean = true;

  constructor(options: SandboxProvisionOptions) {
    this.id = `sandbox-stateful-${options.jobId}`;
    this.createdAt = new Date().toISOString();
    // Unique isolated schema/database per job to prevent concurrent state contention
    this.isolatedSchemaName = options.databaseSchemaName ?? `tmp_schema_${options.jobId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  public async executeCommand(
    command: string,
    args: string[] = [],
    _timeoutMs: number = 180000
  ): Promise<CommandExecutionResult> {
    if (this.destroyed) {
      throw new Error(`Cannot execute command: Stateful sandbox '${this.id}' has already been torn down.`);
    }

    const startTime = Date.now();

    // Check for simulated migration / Terraform execution
    if (command.includes('prisma migrate') || command.includes('terraform plan')) {
      const isSyntaxError = args.includes('--fail-syntax');
      const isInfraLockError = args.includes('--fail-infra-lock');

      if (isInfraLockError) {
        return {
          exitCode: 125,
          stdout: '',
          stderr: `FATAL: Database connection pool exhausted or lock acquisition timeout. (INFRA_ERROR)`,
          durationMs: Date.now() - startTime,
        };
      }

      if (isSyntaxError) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Prisma migration error P3006: Migration failed when applying SQL: syntax error at or near "INVALID"`,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        exitCode: 0,
        stdout: `Applied migration successfully to isolated sandbox schema '${this.isolatedSchemaName}'. Dry run passed.`,
        stderr: '',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      exitCode: 0,
      stdout: `[${this.id}] Executed stateful command: ${command} in isolated schema ${this.isolatedSchemaName}`,
      stderr: '',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Guaranteed resource teardown
   */
  public async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.resourcesProvisioned = false;
    this.destroyed = true;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public hasActiveResources(): boolean {
    return this.resourcesProvisioned;
  }
}
