import { z } from 'zod';

export const PatchCycleRecordSchema = z.object({
  cycle: z.number().int().min(1).max(3),
  timestamp: z.string().datetime(),
  patchDiff: z.string(),
  failureGate: z.string(),
  failureOutput: z.string(),
  modelPersona: z.string(),
});

export const DecisionMemoStatusSchema = z.enum([
  'PENDING_REVIEW',
  'IN_REVIEW',
  'RESOLVED_HUMAN_PATCH',
  'ABORTED_SPEC_FAULT',
]);

export const DecisionMemoSchema = z.object({
  memoId: z.string().uuid().or(z.string().min(1)),
  goalId: z.string().min(1),
  workflowId: z.string().min(1),
  nodeId: z.string().min(1),
  contractId: z.string().min(1),
  contractVersion: z.string().min(1),
  status: DecisionMemoStatusSchema.default('PENDING_REVIEW'),
  totalCyclesAttempted: z.number().int().min(1),
  patchHistory: z.array(PatchCycleRecordSchema),
  consolidatedErrorLogs: z.string(),
  unresolvedQuestions: z.array(z.string()).default([]),
  assignedTo: z.string().min(1).default('senior-platform-engineer'),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  resolvedAt: z.string().datetime().optional(),
  resolutionNotes: z.string().optional(),
});

export type PatchCycleRecord = z.infer<typeof PatchCycleRecordSchema>;
export type DecisionMemoStatus = z.infer<typeof DecisionMemoStatusSchema>;
export type DecisionMemo = z.infer<typeof DecisionMemoSchema>;
