import { checkRuleAgainstField } from './conditions';
import { definitionSchema, type WorkflowDefinition } from './definition';
import { indexGraph, type Graph } from './graph';

export type IssueCode =
  | 'INVALID_SHAPE'
  | 'DUPLICATE_FIELD_ID'
  | 'SELECT_WITHOUT_OPTIONS'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_EDGE_ID'
  | 'EDGE_UNKNOWN_NODE'
  | 'MISSING_START'
  | 'MULTIPLE_STARTS'
  | 'MISSING_END'
  | 'START_HAS_INCOMING'
  | 'WRONG_OUTGOING_COUNT'
  | 'END_HAS_OUTGOING'
  | 'RULE_NOT_ALLOWED'
  | 'MISSING_RULE'
  | 'CONDITION_DEFAULT'
  | 'CONDITION_WITHOUT_RULES'
  | 'RULE_UNKNOWN_FIELD'
  | 'RULE_INVALID'
  | 'UNREACHABLE_NODE'
  | 'CYCLE'
  | 'APPROVED_WITHOUT_APPROVAL';

export interface ValidationIssue {
  code: IssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
  fieldId?: string;
}

function nodeLabel(graph: Graph, id: string): string {
  const node = graph.nodes.get(id);
  if (!node) return id;
  if (node.type === 'start') return 'Start';
  if (node.type === 'end') return `End (${node.outcome})`;
  return `"${node.name}"`;
}

/**
 * Checks everything that must hold before a workflow can be published. Returns every
 * problem found (not just the first), so the builder can highlight them all at once.
 * Checks that need the database (e.g. "do these users belong to the organization?")
 * are done by the API on top of this.
 */
export function validateDefinition(input: unknown): ValidationIssue[] {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      code: 'INVALID_SHAPE' as const,
      message: `${issue.path.join('.') || 'definition'}: ${issue.message}`,
    }));
  }
  const definition: WorkflowDefinition = parsed.data;
  const issues: ValidationIssue[] = [];

  // ---- Form ----
  const fieldIds = new Set<string>();
  for (const field of definition.form.fields) {
    if (fieldIds.has(field.id)) {
      issues.push({
        code: 'DUPLICATE_FIELD_ID',
        message: `Two fields use the key "${field.id}"`,
        fieldId: field.id,
      });
    }
    fieldIds.add(field.id);
    if (field.type === 'select' && (field.options ?? []).length === 0) {
      issues.push({
        code: 'SELECT_WITHOUT_OPTIONS',
        message: `Dropdown "${field.label}" needs at least one option`,
        fieldId: field.id,
      });
    }
  }
  const fields = new Map(definition.form.fields.map((field) => [field.id, field]));

  // ---- Unique ids and edge endpoints ----
  const seenNodes = new Set<string>();
  for (const node of definition.nodes) {
    if (seenNodes.has(node.id)) {
      issues.push({
        code: 'DUPLICATE_NODE_ID',
        message: `Duplicate step id "${node.id}"`,
        nodeId: node.id,
      });
    }
    seenNodes.add(node.id);
  }
  const seenEdges = new Set<string>();
  for (const edge of definition.edges) {
    if (seenEdges.has(edge.id)) {
      issues.push({
        code: 'DUPLICATE_EDGE_ID',
        message: `Duplicate arrow id "${edge.id}"`,
        edgeId: edge.id,
      });
    }
    seenEdges.add(edge.id);
    if (!seenNodes.has(edge.source) || !seenNodes.has(edge.target)) {
      issues.push({
        code: 'EDGE_UNKNOWN_NODE',
        message: 'An arrow points to a step that does not exist',
        edgeId: edge.id,
      });
    }
  }
  // The structural checks below assume ids are sound.
  if (issues.some((i) => i.code.startsWith('DUPLICATE_') || i.code === 'EDGE_UNKNOWN_NODE')) {
    return issues;
  }

  const graph = indexGraph(definition);
  const starts = definition.nodes.filter((node) => node.type === 'start');
  if (starts.length === 0)
    issues.push({ code: 'MISSING_START', message: 'The workflow needs a Start step' });
  if (starts.length > 1) {
    issues.push({ code: 'MULTIPLE_STARTS', message: 'The workflow can only have one Start step' });
  }
  if (!definition.nodes.some((node) => node.type === 'end')) {
    issues.push({ code: 'MISSING_END', message: 'The workflow needs at least one End step' });
  }

  // ---- Per-node edge rules ----
  for (const node of definition.nodes) {
    const out = graph.outgoing.get(node.id) ?? [];
    const label = nodeLabel(graph, node.id);
    switch (node.type) {
      case 'start':
        if ((graph.incoming.get(node.id) ?? []).length > 0) {
          issues.push({
            code: 'START_HAS_INCOMING',
            message: 'No arrow can point into Start',
            nodeId: node.id,
          });
        }
        if (out.length !== 1) {
          issues.push({
            code: 'WRONG_OUTGOING_COUNT',
            message: 'Start must have exactly one arrow out',
            nodeId: node.id,
          });
        }
        break;
      case 'approval':
        if (out.length !== 1) {
          issues.push({
            code: 'WRONG_OUTGOING_COUNT',
            message: `${label} must have exactly one arrow out (where to go when approved)`,
            nodeId: node.id,
          });
        }
        break;
      case 'end':
        if (out.length > 0) {
          issues.push({
            code: 'END_HAS_OUTGOING',
            message: `${label} cannot have arrows out`,
            nodeId: node.id,
          });
        }
        break;
      case 'condition': {
        const defaults = out.filter((edge) => edge.isDefault);
        const ruled = out.filter((edge) => !edge.isDefault);
        if (defaults.length !== 1) {
          issues.push({
            code: 'CONDITION_DEFAULT',
            message: `${label} needs exactly one "otherwise" (default) arrow`,
            nodeId: node.id,
          });
        }
        if (ruled.length === 0) {
          issues.push({
            code: 'CONDITION_WITHOUT_RULES',
            message: `${label} needs at least one arrow with a rule`,
            nodeId: node.id,
          });
        }
        for (const edge of ruled) {
          if (!edge.rule) {
            issues.push({
              code: 'MISSING_RULE',
              message: `An arrow from ${label} has no rule`,
              edgeId: edge.id,
            });
            continue;
          }
          const field = fields.get(edge.rule.field);
          if (!field) {
            issues.push({
              code: 'RULE_UNKNOWN_FIELD',
              message: `A rule in ${label} uses a field that is not in the form`,
              edgeId: edge.id,
            });
            continue;
          }
          const problem = checkRuleAgainstField(edge.rule, field);
          if (problem) issues.push({ code: 'RULE_INVALID', message: problem, edgeId: edge.id });
        }
        break;
      }
    }
    if (node.type !== 'condition') {
      for (const edge of out) {
        if (edge.rule || edge.isDefault) {
          issues.push({
            code: 'RULE_NOT_ALLOWED',
            message: `Only arrows leaving a condition can have rules (${label})`,
            edgeId: edge.id,
          });
        }
      }
    }
  }

  const start = starts[0];
  if (!start) return issues;

  // ---- Cycles (loops are out of scope for v1) ----
  const state = new Map<string, 'visiting' | 'done'>();
  let cycleAt: string | null = null;
  const visit = (id: string): void => {
    if (cycleAt) return;
    state.set(id, 'visiting');
    for (const edge of graph.outgoing.get(id) ?? []) {
      const mark = state.get(edge.target);
      if (mark === 'visiting') {
        cycleAt = edge.target;
        return;
      }
      if (!mark) visit(edge.target);
    }
    state.set(id, 'done');
  };
  for (const node of definition.nodes) if (!state.has(node.id)) visit(node.id);
  if (cycleAt) {
    issues.push({
      code: 'CYCLE',
      message: `The arrows form a loop through ${nodeLabel(graph, cycleAt)}; loops are not supported`,
      nodeId: cycleAt,
    });
    return issues;
  }

  // ---- Reachability ----
  const reachable = new Set<string>([start.id]);
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const edge of graph.outgoing.get(id) ?? []) {
      if (!reachable.has(edge.target)) {
        reachable.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  for (const node of definition.nodes) {
    if (!reachable.has(node.id)) {
      issues.push({
        code: 'UNREACHABLE_NODE',
        message: `${nodeLabel(graph, node.id)} can't be reached from Start`,
        nodeId: node.id,
      });
    }
  }

  // ---- Compliance: no path may reach "approved" without anyone approving ----
  const approvedWithoutApproval = new Set<string>();
  const walk = (id: string, seenApproval: boolean): void => {
    const node = graph.nodes.get(id);
    if (!node) return;
    const approved = seenApproval || node.type === 'approval';
    if (node.type === 'end' && node.outcome === 'approved' && !approved) {
      approvedWithoutApproval.add(node.id);
    }
    if (approved) return; // every path below already has an approval
    for (const edge of graph.outgoing.get(id) ?? []) walk(edge.target, approved);
  };
  walk(start.id, false);
  for (const nodeId of approvedWithoutApproval) {
    issues.push({
      code: 'APPROVED_WITHOUT_APPROVAL',
      message: 'A path reaches "approved" without any approval step',
      nodeId,
    });
  }

  return issues;
}
