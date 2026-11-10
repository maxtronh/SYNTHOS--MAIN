import { z } from 'zod';

export const ActorTypeSchema = z.enum([
  'SYSTEM',
  'HUMAN_APPROVER',
  'TEMPORAL_WORKFLOW',
  'GATE_RUNNER',
  'AI_ADVISORY_LAYER',
  'BULLMQ_DISPATCHER',
]);

export const AuditEventTypeSchema = z.enum([
  'DAG_BLUEPRINT_CREATED',
  'DAG_APPROVAL_REQUESTED',
  'DAG_APPROVAL_GRANTED',
  'DAG_APPROVAL_STALE_PAUSED',
  'WORKFLOW_INITIALIZED',
  'NODE_SCHEDULED',
  'NODE_STARTED',
  'NODE_CANCELLED',
  'GATE_EXECUTION_COMPLETED',
  'SANDBOX_PROVISIONED',
  'SANDBOX_DESTROYED',
  'PATCH_LOOP_CYCLE_FAILED',
  'DECISION_MEMO_GENERATED',
  'BLAST_RADIUS_DISPATCHED',
  'BLAST_RADIUS_RECONCILED',
  'RELEASE_CANDIDATE_ASSEMBLED',
  'RELEASE_PROMOTION_GRANTED',
  'RELEASE_CANDIDATE_ARCHIVED',
]);

export const AuditTrailEventSchema = z.object({
  eventId: z.string().uuid().or(z.string().min(1)),
  correlationId: z.string().min(1),
  goalId: z.string().min(1),
  workflowId: z.string().min(1),
  nodeId: z.string().optional(),
  contractVersion: z.string().optional(),
  eventType: AuditEventTypeSchema,
  actor: z.object({
    type: ActorTypeSchema,
    id: z.string().min(1),
    name: z.string().optional(),
  }),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string().datetime().default(() => new Date().toISOString()),
});

export type ActorType = z.infer<typeof ActorTypeSchema>;
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;
export type AuditTrailEvent = z.infer<typeof AuditTrailEventSchema>;
