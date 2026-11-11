import { z } from 'zod';

export const SemanticVersionSchema = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
  'Must be a valid Semantic Version (SemVer 2.0.0)'
);

export const SchemaFieldDefinition = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  description: z.string().optional(),
  required: z.boolean().default(true),
  properties: z.record(z.string(), z.unknown()).optional(),
  items: z.record(z.string(), z.unknown()).optional(),
});

export const GateLevelSchema = z.enum(['L0', 'L1a', 'L1b', 'L3']);

export const ModuleDependencySchema = z.object({
  contractId: z.string().min(1),
  name: z.string().min(1),
  versionRange: z.string().min(1),
});

export const ModuleContractSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  name: z.string().min(1).regex(/^[a-z0-9-_]+$/, 'Contract name must be lowercase alphanumeric with hyphens or underscores'),
  version: SemanticVersionSchema,
  description: z.string().min(5),
  inputs: z.record(z.string(), SchemaFieldDefinition),
  outputs: z.record(z.string(), SchemaFieldDefinition),
  /**
   * stateHooks flag directs the Gate Runner to Path B (Managed Stateful Sandbox)
   * if the module executes database migrations, Kafka topic management, or Terraform scripts.
   */
  stateHooks: z.boolean().default(false),
  dependencies: z.array(ModuleDependencySchema).default([]),
  requiredGates: z.array(GateLevelSchema).default(['L0', 'L1a']),
  executionBudgetMs: z.number().int().positive().default(60000),
  author: z.string().min(1).default('architect-tier-1'),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type ModuleContract = z.infer<typeof ModuleContractSchema>;
export type ModuleDependency = z.infer<typeof ModuleDependencySchema>;
export type GateLevel = z.infer<typeof GateLevelSchema>;
export type SchemaField = z.infer<typeof SchemaFieldDefinition>;
