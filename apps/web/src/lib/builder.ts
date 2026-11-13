import {
  OPERATOR_LABELS,
  OPERATORS_BY_FIELD_TYPE,
  type FormDefinition,
  type FormField,
  type Rule,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@flowgate/workflow';

/**
 * Pure edit operations on a workflow definition. The builder keeps the definition (the
 * same JSON the API stores) as its only state and derives the canvas from it, so there is
 * never a second copy of the graph to keep in sync.
 */

export type Updater = (definition: WorkflowDefinition) => WorkflowDefinition;

const shortId = () => crypto.randomUUID().slice(0, 8);

export type AddableNode = 'approval' | 'condition' | 'end_approved' | 'end_rejected';

export function addNode(
  definition: WorkflowDefinition,
  kind: AddableNode,
): { definition: WorkflowDefinition; id: string } {
  const lowest = Math.max(0, ...definition.nodes.map((n) => n.position.y));
  const position = { x: (definition.nodes.length % 3) * 40, y: lowest + 140 };
  let node: WorkflowNode;
  switch (kind) {
    case 'approval':
      node = {
        id: `approval_${shortId()}`,
        type: 'approval',
        position,
        name: 'New approval',
        assignee: { kind: 'manager' },
        mode: 'any',
        dueInHours: 48,
      };
      break;
    case 'condition':
      node = { id: `condition_${shortId()}`, type: 'condition', position, name: 'New condition' };
      break;
    case 'end_approved':
    case 'end_rejected':
      node = {
        id: `end_${shortId()}`,
        type: 'end',
        position,
        outcome: kind === 'end_approved' ? 'approved' : 'rejected',
      };
      break;
  }
  return { definition: { ...definition, nodes: [...definition.nodes, node] }, id: node.id };
}

export const mapNode =
  (id: string, fn: (node: WorkflowNode) => WorkflowNode): Updater =>
  (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? fn(n) : n)) });

export const mapEdge =
  (id: string, fn: (edge: WorkflowEdge) => WorkflowEdge): Updater =>
  (d) => ({ ...d, edges: d.edges.map((e) => (e.id === id ? fn(e) : e)) });

/** The start node can't be removed: every workflow needs exactly one. */
export const removeNode =
  (id: string): Updater =>
  (d) => {
    const node = d.nodes.find((n) => n.id === id);
    if (!node || node.type === 'start') return d;
    return {
      ...d,
      nodes: d.nodes.filter((n) => n.id !== id),
      edges: d.edges.filter((e) => e.source !== id && e.target !== id),
    };
  };

export const removeEdge =
  (id: string): Updater =>
  (d) => ({ ...d, edges: d.edges.filter((e) => e.id !== id) });

/** A rule that fits the first field a condition can use, as a starting point to edit. */
export function starterRule(form: FormDefinition): Rule | null {
  const field = form.fields.find((f) => OPERATORS_BY_FIELD_TYPE[f.type].length > 0);
  if (!field) return null;
  const operator = OPERATORS_BY_FIELD_TYPE[field.type][0]!;
  const value =
    field.type === 'number' ? 0 : field.type === 'select' ? (field.options?.[0] ?? '') : '';
  return { field: field.id, operator, value };
}

/**
 * Adds an edge. Start and approval nodes have exactly one way out, so connecting them
 * again moves that edge. A condition's first edge becomes its default ("otherwise") path,
 * later ones get a starter rule.
 */
export const connect =
  (source: string, target: string): Updater =>
  (d) => {
    const from = d.nodes.find((n) => n.id === source);
    const to = d.nodes.find((n) => n.id === target);
    if (!from || !to || source === target || from.type === 'end' || to.type === 'start') return d;
    if (d.edges.some((e) => e.source === source && e.target === target)) return d;

    const id = `e_${shortId()}`;
    if (from.type !== 'condition') {
      const rest = d.edges.filter((e) => e.source !== source);
      return { ...d, edges: [...rest, { id, source, target, rule: null, isDefault: false }] };
    }
    const hasDefault = d.edges.some((e) => e.source === source && e.isDefault);
    const edge: WorkflowEdge = hasDefault
      ? { id, source, target, rule: starterRule(d.form), isDefault: false }
      : { id, source, target, rule: null, isDefault: true };
    return { ...d, edges: [...d.edges, edge] };
  };

/** Only one default path per condition: making this one the default gives the old one a rule. */
export const makeDefaultEdge =
  (id: string): Updater =>
  (d) => {
    const edge = d.edges.find((e) => e.id === id);
    if (!edge) return d;
    return {
      ...d,
      edges: d.edges.map((e) => {
        if (e.id === id) return { ...e, isDefault: true, rule: null };
        if (e.source === edge.source && e.isDefault)
          return { ...e, isDefault: false, rule: starterRule(d.form) };
        return e;
      }),
    };
  };

// ---------- Form fields ----------

export function fieldIdFromLabel(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+|_+$/g, '')
      .slice(0, 32) || 'field';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

export const addField: Updater = (d) => {
  const id = fieldIdFromLabel('New field', new Set(d.form.fields.map((f) => f.id)));
  const field: FormField = { id, label: 'New field', type: 'text', required: false };
  return { ...d, form: { fields: [...d.form.fields, field] } };
};

export const updateField =
  (id: string, patch: Partial<FormField>): Updater =>
  (d) => {
    const fields = d.form.fields.map((f) => {
      if (f.id !== id) return f;
      const next = { ...f, ...patch };
      if (next.type === 'select') next.options ??= [];
      else delete next.options;
      return next;
    });
    // Renaming a field's key keeps the conditions that use it working.
    const renamed = patch.id !== undefined && patch.id !== id;
    const edges = renamed
      ? d.edges.map((e) =>
          e.rule?.field === id ? { ...e, rule: { ...e.rule, field: patch.id! } } : e,
        )
      : d.edges;
    return { ...d, form: { fields }, edges };
  };

export const removeField =
  (id: string): Updater =>
  (d) => ({ ...d, form: { fields: d.form.fields.filter((f) => f.id !== id) } });

export const moveField =
  (id: string, by: -1 | 1): Updater =>
  (d) => {
    const fields = [...d.form.fields];
    const i = fields.findIndex((f) => f.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= fields.length) return d;
    [fields[i], fields[j]] = [fields[j]!, fields[i]!];
    return { ...d, form: { fields } };
  };

// ---------- Labels ----------

export function ruleText(rule: Rule | null, form: FormDefinition): string {
  if (!rule) return 'needs a rule';
  const label = form.fields.find((f) => f.id === rule.field)?.label ?? rule.field;
  return `${label} ${OPERATOR_LABELS[rule.operator]} ${String(rule.value)}`;
}
