import { DECISIONS, REQUEST_STATUSES } from '@flowgate/workflow';
import { z } from 'zod';

/** Form answers are validated by the engine against the workflow's own form. */
const answersSchema = z.record(z.unknown());

export const submitRequestSchema = z.object({
  workflowId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  data: answersSchema,
});
export type SubmitRequestInput = z.infer<typeof submitRequestSchema>;

export const resubmitSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  data: answersSchema,
});
export type ResubmitInput = z.infer<typeof resubmitSchema>;

export const listRequestsSchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(REQUEST_STATUSES).optional(),
});
export type ListRequestsQuery = z.infer<typeof listRequestsSchema>;

export const decisionSchema = z
  .object({
    decision: z.enum(DECISIONS),
    comment: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => (value ? value : null)),
  })
  .refine((v) => v.decision === 'approve' || v.comment !== null, {
    message: 'Please explain why in a comment',
    path: ['comment'],
  });
export type DecisionInput = z.infer<typeof decisionSchema>;

export const listTasksSchema = z.object({
  status: z.enum(['open', 'done']).default('open'),
});
export type ListTasksQuery = z.infer<typeof listTasksSchema>;
