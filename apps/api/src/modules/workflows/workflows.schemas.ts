import { definitionSchema } from '@flowgate/workflow';
import { z } from 'zod';

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
});
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;

export const updateWorkflowSchema = createWorkflowSchema.partial();
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;

/** Drafts must have the right shape, but may be unfinished (graph rules apply on publish). */
export const saveDraftSchema = z.object({ definition: definitionSchema });
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
