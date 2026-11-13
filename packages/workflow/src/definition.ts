import { z } from 'zod';

/** Limits keep a single definition small enough to load, validate and render instantly. */
export const LIMITS = { nodes: 100, edges: 200, fields: 50, assigneeUsers: 20 } as const;

const idSchema = z.string().min(1).max(64);

// ---------- Form ----------

export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const fieldSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, digits and _ (start with a letter)'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  helpText: z.string().max(200).optional(),
  /** Only for `select` fields. */
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});
export type FormField = z.infer<typeof fieldSchema>;

export const formSchema = z.object({
  fields: z.array(fieldSchema).max(LIMITS.fields),
});
export type FormDefinition = z.infer<typeof formSchema>;

// ---------- Graph ----------

export const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
export type Operator = (typeof OPERATORS)[number];

export const ruleSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(OPERATORS),
  value: z.union([z.string().max(80), z.number().finite()]),
});
export type Rule = z.infer<typeof ruleSchema>;

export const ASSIGNABLE_ROLES = ['admin', 'approver'] as const;

export const assigneeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manager') }),
  z.object({
    kind: z.literal('users'),
    userIds: z.array(z.string().uuid()).min(1).max(LIMITS.assigneeUsers),
  }),
  z.object({ kind: z.literal('role'), role: z.enum(ASSIGNABLE_ROLES) }),
]);
export type Assignee = z.infer<typeof assigneeSchema>;

const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

export const startNodeSchema = z.object({
  id: idSchema,
  type: z.literal('start'),
  position: positionSchema,
});

export const approvalNodeSchema = z.object({
  id: idSchema,
  type: z.literal('approval'),
  position: positionSchema,
  name: z.string().trim().min(1).max(80),
  assignee: assigneeSchema,
  /** `any`: the first approval completes the step. `all`: every assignee must approve. */
  mode: z.enum(['any', 'all']),
  /** Hours an assignee has before the task escalates. `null` means no deadline. */
  dueInHours: z.number().int().min(1).max(720).nullable(),
});

export const conditionNodeSchema = z.object({
  id: idSchema,
  type: z.literal('condition'),
  position: positionSchema,
  name: z.string().trim().min(1).max(80),
});

export const endNodeSchema = z.object({
  id: idSchema,
  type: z.literal('end'),
  position: positionSchema,
  outcome: z.enum(['approved', 'rejected']),
});

export const nodeSchema = z.discriminatedUnion('type', [
  startNodeSchema,
  approvalNodeSchema,
  conditionNodeSchema,
  endNodeSchema,
]);
export type WorkflowNode = z.infer<typeof nodeSchema>;
export type StartNode = z.infer<typeof startNodeSchema>;
export type ApprovalNode = z.infer<typeof approvalNodeSchema>;
export type ConditionNode = z.infer<typeof conditionNodeSchema>;
export type EndNode = z.infer<typeof endNodeSchema>;
export type NodeType = WorkflowNode['type'];

export const edgeSchema = z.object({
  id: idSchema,
  source: idSchema,
  target: idSchema,
  /** Only edges leaving a condition node carry a rule (or are the default path). */
  rule: ruleSchema.nullable(),
  isDefault: z.boolean(),
});
export type WorkflowEdge = z.infer<typeof edgeSchema>;

export const definitionSchema = z.object({
  form: formSchema,
  nodes: z.array(nodeSchema).max(LIMITS.nodes),
  edges: z.array(edgeSchema).max(LIMITS.edges),
});
export type WorkflowDefinition = z.infer<typeof definitionSchema>;

/** A small, valid definition every new workflow starts from: start → manager approval → end. */
export function starterDefinition(): WorkflowDefinition {
  return {
    form: {
      fields: [{ id: 'details', label: 'Details', type: 'textarea', required: true }],
    },
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 } },
      {
        id: 'manager_approval',
        type: 'approval',
        position: { x: 0, y: 140 },
        name: 'Manager approval',
        assignee: { kind: 'manager' },
        mode: 'any',
        dueInHours: 48,
      },
      { id: 'approved', type: 'end', position: { x: 0, y: 280 }, outcome: 'approved' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'manager_approval', rule: null, isDefault: false },
      { id: 'e2', source: 'manager_approval', target: 'approved', rule: null, isDefault: false },
    ],
  };
}
