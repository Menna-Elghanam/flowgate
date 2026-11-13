import { ROLES } from '@flowgate/workflow';
import { z } from 'zod';
import { emailSchema, nameSchema } from '../auth/auth.schemas';

const rolesSchema = z
  .array(z.enum(ROLES))
  .min(1, 'Pick at least one role')
  .transform((roles) => [...new Set(roles)]);

export const createInviteSchema = z.object({
  email: emailSchema,
  roles: rolesSchema,
  managerId: z.string().uuid().nullable().default(null),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const updateMemberSchema = z
  .object({
    roles: rolesSchema.optional(),
    managerId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.roles !== undefined || v.managerId !== undefined, 'Nothing to update');
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const acceptInviteSchema = z.object({
  /** Needed only when the email has no account yet. */
  name: nameSchema.optional(),
  password: z.string().min(1).max(200),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
