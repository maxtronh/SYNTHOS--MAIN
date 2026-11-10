import { z } from 'zod';
import { GateLevelSchema, SemanticVersionSchema } from './module-contract.js';

export const GateStatusSchema = z.enum([
  'PASS',
  'FAIL',
  'DEFERRED',
  'TIMEOUT',
  'INFRA_ERROR',
]);

export const SandboxPathSchema = z.enum([
  'PATH_A_EPHEMERAL',
  'PATH_B_STATEFUL',
]);

export const GateVerdictSchema = z.object({
  verdictId: z.string().uuid().or(z.string().min(1)),
  workflowId: z.string().min(1),
  nodeId: z.string().min(1),
  contractId: z.string().min(1),
  contractVersion: SemanticVersionSchema,
  gate: GateLevelSchema,
  status: GateStatusSchema,
  sandboxPath: SandboxPathSchema,
  executionDurationMs: z.number().nonnegative(),
  isAuthoritative: z.boolean().default(true),
  errorDetails: z.array(z.string()).default([]),
  metrics: z.object({
    coveragePercent: z.number().min(0).max(100).optional(),
    testCount: z.number().int().nonnegative().optional(),
    lintErrors: z.number().int().nonnegative().optional(),
    mutationScore: z.number().min(0).max(100).optional(),
    durationMs: z.number().nonnegative().optional(),
  }).default({}),
  logsUrl: z.string().optional(),
  evaluatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type GateStatus = z.infer<typeof GateStatusSchema>;
export type SandboxPath = z.infer<typeof SandboxPathSchema>;
export type GateVerdict = z.infer<typeof GateVerdictSchema>;
