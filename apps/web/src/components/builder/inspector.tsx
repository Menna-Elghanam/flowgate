'use client';

import {
  ASSIGNABLE_ROLES,
  OPERATOR_LABELS,
  OPERATORS_BY_FIELD_TYPE,
  type ApprovalNode,
  type Assignee,
  type Operator,
  type Rule,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@flowgate/workflow';
import {
  makeDefaultEdge,
  mapEdge,
  mapNode,
  removeEdge,
  removeNode,
  starterRule,
  type Updater,
} from '@/lib/builder';
import type { Member } from '@/lib/types';
import { Button, Field, Input, Select } from '../ui';
import type { Selection } from './canvas';

function ApprovalFields({
  node,
  members,
  update,
}: {
  node: ApprovalNode;
  members: Member[];
  update: (fn: Updater) => void;
}) {
  const set = (patch: Partial<ApprovalNode>) =>
    update(mapNode(node.id, (n) => ({ ...n, ...patch }) as WorkflowNode));
  const setAssignee = (assignee: Assignee) => set({ assignee });
  const { assignee } = node;

  return (
    <>
      <Field label="Step name" htmlFor="node-name">
        <Input
          id="node-name"
          maxLength={80}
          value={node.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      <Field label="Who decides" htmlFor="node-assignee">
        <Select
          id="node-assignee"
          value={assignee.kind}
          onChange={(e) => {
            const kind = e.target.value as Assignee['kind'];
            if (kind === 'manager') setAssignee({ kind });
            else if (kind === 'role') setAssignee({ kind, role: 'approver' });
            else setAssignee({ kind, userIds: [] });
          }}
        >
          <option value="manager">The requester&apos;s manager</option>
          <option value="role">Everyone with a role</option>
          <option value="users">Specific people</option>
        </Select>
      </Field>
      {assignee.kind === 'role' && (
        <Field label="Role" htmlFor="node-role">
          <Select
            id="node-role"
            value={assignee.role}
            onChange={(e) =>
              setAssignee({
                kind: 'role',
                role: e.target.value as (typeof ASSIGNABLE_ROLES)[number],
              })
            }
          >
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {role === 'admin' ? 'Admins' : 'Approvers'}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {assignee.kind === 'users' && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-slate-700">People</legend>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
            {members.map((m) => (
              <label key={m.userId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={assignee.userIds.includes(m.userId)}
                  onChange={(e) =>
                    setAssignee({
                      kind: 'users',
                      userIds: e.target.checked
                        ? [...assignee.userIds, m.userId]
                        : assignee.userIds.filter((id) => id !== m.userId),
                    })
                  }
                />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {assignee.kind !== 'manager' && (
        <Field label="When several people can decide" htmlFor="node-mode">
          <Select
            id="node-mode"
            value={node.mode}
            onChange={(e) => set({ mode: e.target.value as ApprovalNode['mode'] })}
          >
            <option value="any">The first approval is enough</option>
            <option value="all">Everyone must approve</option>
          </Select>
        </Field>
      )}
      <Field
        label="Deadline (hours)"
        htmlFor="node-due"
        hint="Empty means no deadline. When it passes, the task escalates to the assignee's manager."
      >
        <Input
          id="node-due"
          type="number"
          min={1}
          max={720}
          value={node.dueInHours ?? ''}
          onChange={(e) =>
            set({ dueInHours: e.target.value === '' ? null : Math.round(Number(e.target.value)) })
          }
        />
      </Field>
    </>
  );
}

function RuleFields({
  edge,
  definition,
  update,
}: {
  edge: WorkflowEdge;
  definition: WorkflowDefinition;
  update: (fn: Updater) => void;
}) {
  const usable = definition.form.fields.filter((f) => OPERATORS_BY_FIELD_TYPE[f.type].length > 0);
  const setRule = (rule: Rule | null) => update(mapEdge(edge.id, (e) => ({ ...e, rule })));

  if (edge.isDefault) {
    return (
      <p className="text-sm text-slate-600">
        Requests that match no other path from this condition go this way.
      </p>
    );
  }
  if (usable.length === 0) {
    return (
      <p className="text-sm text-red-700">
        Add a number, date, choice or text field to the form to write a rule.
      </p>
    );
  }
  const rule = edge.rule ?? starterRule(definition.form);
  if (!rule) return null;
  const field = usable.find((f) => f.id === rule.field) ?? usable[0]!;
  const operators = OPERATORS_BY_FIELD_TYPE[field.type];

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-slate-700">Go this way when</legend>
      <Select
        aria-label="Field"
        value={field.id}
        onChange={(e) => {
          const next = usable.find((f) => f.id === e.target.value)!;
          const op = OPERATORS_BY_FIELD_TYPE[next.type][0]!;
          setRule({
            field: next.id,
            operator: op,
            value:
              next.type === 'number' ? 0 : next.type === 'select' ? (next.options?.[0] ?? '') : '',
          });
        }}
      >
        {usable.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Operator"
        value={rule.operator}
        onChange={(e) => setRule({ ...rule, operator: e.target.value as Operator })}
      >
        {operators.map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </Select>
      {field.type === 'select' ? (
        <Select
          aria-label="Value"
          value={String(rule.value)}
          onChange={(e) => setRule({ ...rule, value: e.target.value })}
        >
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          aria-label="Value"
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={String(rule.value)}
          onChange={(e) =>
            setRule({
              ...rule,
              value: field.type === 'number' ? Number(e.target.value) : e.target.value,
            })
          }
        />
      )}
    </fieldset>
  );
}

export function Inspector({
  definition,
  selection,
  members,
  update,
  clearSelection,
}: {
  definition: WorkflowDefinition;
  selection: Selection;
  members: Member[];
  update: (fn: Updater) => void;
  clearSelection: () => void;
}) {
  if (!selection) {
    return (
      <p className="text-sm text-slate-600">
        Select a step or an arrow to edit it. Drag from a node&apos;s bottom dot to another node to
        connect them.
      </p>
    );
  }

  if (selection.kind === 'edge') {
    const edge = definition.edges.find((e) => e.id === selection.id);
    if (!edge) return null;
    const source = definition.nodes.find((n) => n.id === edge.source);
    return (
      <div className="space-y-4">
        <h3 className="font-medium">Connection</h3>
        {source?.type === 'condition' && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={edge.isDefault}
                disabled={edge.isDefault}
                onChange={() => update(makeDefaultEdge(edge.id))}
              />
              Default path (&quot;otherwise&quot;)
            </label>
            <RuleFields edge={edge} definition={definition} update={update} />
          </>
        )}
        <Button
          variant="danger"
          onClick={() => {
            update(removeEdge(edge.id));
            clearSelection();
          }}
        >
          Delete connection
        </Button>
      </div>
    );
  }

  const node = definition.nodes.find((n) => n.id === selection.id);
  if (!node) return null;
  return (
    <div className="space-y-4">
      {node.type === 'start' && (
        <p className="text-sm text-slate-600">
          Every request starts here, right after it is submitted.
        </p>
      )}
      {node.type === 'approval' && <ApprovalFields node={node} members={members} update={update} />}
      {node.type === 'condition' && (
        <>
          <Field
            label="Condition name"
            htmlFor="node-name"
            hint="Select the arrows leaving this node to set their rules."
          >
            <Input
              id="node-name"
              maxLength={80}
              value={node.name}
              onChange={(e) =>
                update(mapNode(node.id, (n) => ({ ...n, name: e.target.value }) as WorkflowNode))
              }
            />
          </Field>
        </>
      )}
      {node.type === 'end' && (
        <Field label="Outcome" htmlFor="node-outcome">
          <Select
            id="node-outcome"
            value={node.outcome}
            onChange={(e) =>
              update(mapNode(node.id, (n) => ({ ...n, outcome: e.target.value }) as WorkflowNode))
            }
          >
            <option value="approved">Request approved</option>
            <option value="rejected">Request rejected</option>
          </Select>
        </Field>
      )}
      {node.type !== 'start' && (
        <Button
          variant="danger"
          onClick={() => {
            update(removeNode(node.id));
            clearSelection();
          }}
        >
          Delete step
        </Button>
      )}
    </div>
  );
}
