import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(8, 'Use at least 8 characters').max(200);
export const nameSchema = z.string().trim().min(1).max(80);

export const signupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(1).max(80),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;
