import type { SandboxPath } from '@fable/contracts';

export interface CommandExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ISandboxEnvironment {
  readonly id: string;
  readonly pathType: SandboxPath;
  readonly createdAt: string;
  
  executeCommand(
    command: string,
    args?: string[],
    timeoutMs?: number
  ): Promise<CommandExecutionResult>;

  destroy(): Promise<void>;
  isDestroyed(): boolean;
}

export interface SandboxProvisionOptions {
  jobId: string;
  egressAllowlist?: string[] | undefined;
  stateHooks?: boolean | undefined;
  databaseSchemaName?: string | undefined;
  environmentVariables?: Record<string, string> | undefined;
}
