import { z } from 'zod';
import { SemanticVersionSchema } from './module-contract.js';

export const DAGNodeRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5).default(3),
  initialIntervalMs: z.number().int().positive().default(1000),
  backoffCoefficient: z.number().min(1).default(2.0),
  maximumIntervalMs: z.number().int().positive().default(10000),
});

export const DAGNodeSchema = z.object({
  nodeId: z.string().min(1).regex(/^[a-z0-9-_]+$/, 'Node ID must be lowercase alphanumeric with hyphens or underscores'),
  contractId: z.string().min(1),
  contractVersion: SemanticVersionSchema,
  dependencies: z.array(z.string().min(1)).default([]),
  allowBranchFailure: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(180000), // 3 min default
  retryPolicy: DAGNodeRetryPolicySchema.default({}),
});

export const BlueprintStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'STALE',
  'REJECTED',
]);

export const DAGBlueprintSchema = z.object({
  blueprintId: z.string().uuid().or(z.string().min(1)),
  goalId: z.string().min(1),
  version: SemanticVersionSchema,
  title: z.string().min(3),
  description: z.string().min(5),
  status: BlueprintStatusSchema.default('DRAFT'),
  nodes: z.array(DAGNodeSchema).min(1),
  author: z.string().min(1).default('architect-tier-1'),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  rejectionReason: z.string().optional(),
});

export type DAGNode = z.infer<typeof DAGNodeSchema>;
export type DAGNodeRetryPolicy = z.infer<typeof DAGNodeRetryPolicySchema>;
export type BlueprintStatus = z.infer<typeof BlueprintStatusSchema>;
export type DAGBlueprint = z.infer<typeof DAGBlueprintSchema>;
