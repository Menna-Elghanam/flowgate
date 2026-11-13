import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from './definition';

const at = { x: 0, y: 0 };

export const edge = (
  id: string,
  source: string,
  target: string,
  extra: Partial<WorkflowEdge> = {},
): WorkflowEdge => ({ id, source, target, rule: null, isDefault: false, ...extra });

export const approval = (
  id: string,
  extra: Partial<Extract<WorkflowNode, { type: 'approval' }>> = {},
): WorkflowNode => ({
  id,
  type: 'approval',
  position: at,
  name: id,
  assignee: { kind: 'manager' },
  mode: 'any',
  dueInHours: null,
  ...extra,
});

/** Laptop request: manager approves; if cost > 1000, finance approves too. */
export function laptopWorkflow(): WorkflowDefinition {
  return {
    form: {
      fields: [
        { id: 'cost', label: 'Cost', type: 'number', required: true },
        { id: 'reason', label: 'Reason', type: 'text', required: false },
      ],
    },
    nodes: [
      { id: 'start', type: 'start', position: at },
      approval('manager'),
      { id: 'check_cost', type: 'condition', position: at, name: 'Cost check' },
      approval('finance', { assignee: { kind: 'role', role: 'approver' } }),
      { id: 'done', type: 'end', position: at, outcome: 'approved' },
    ],
    edges: [
      edge('e1', 'start', 'manager'),
      edge('e2', 'manager', 'check_cost'),
      edge('e3', 'check_cost', 'finance', { rule: { field: 'cost', operator: 'gt', value: 1000 } }),
      edge('e4', 'check_cost', 'done', { isDefault: true }),
      edge('e5', 'finance', 'done'),
    ],
  };
}
