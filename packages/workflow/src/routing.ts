import { evaluateRule } from './conditions';
import type { ApprovalNode, EndNode, WorkflowDefinition } from './definition';
import type { FormData } from './form';
import { indexGraph } from './graph';

/** Where a request comes to rest: waiting at an approval, or finished at an end. */
export type Stop = { kind: 'approval'; node: ApprovalNode } | { kind: 'end'; node: EndNode };

export class RoutingError extends Error {}

/**
 * Follows the arrows out of `fromNodeId` until the request reaches a step where it must
 * wait (an approval) or finish (an end). Condition steps are decided on the spot from the
 * form data. Assumes the definition passed `validateDefinition`.
 */
export function nextStop(definition: WorkflowDefinition, fromNodeId: string, data: FormData): Stop {
  const graph = indexGraph(definition);
  const leave = (id: string): string => {
    const node = graph.nodes.get(id);
    const out = graph.outgoing.get(id) ?? [];
    if (!node) throw new RoutingError(`Unknown step "${id}"`);
    if (node.type === 'condition') {
      const match = out.find(
        (edge) => !edge.isDefault && edge.rule && evaluateRule(edge.rule, data[edge.rule.field]),
      );
      const chosen = match ?? out.find((edge) => edge.isDefault);
      if (!chosen) throw new RoutingError(`Condition "${node.name}" has no path to take`);
      return chosen.target;
    }
    const [edge] = out;
    if (!edge) throw new RoutingError(`Step "${id}" has no arrow out`);
    return edge.target;
  };

  let current = leave(fromNodeId);
  // A validated graph is acyclic, so this ends within `nodes.length` hops.
  for (let hops = 0; hops <= definition.nodes.length; hops++) {
    const node = graph.nodes.get(current);
    if (!node) throw new RoutingError(`Unknown step "${current}"`);
    if (node.type === 'approval') return { kind: 'approval', node };
    if (node.type === 'end') return { kind: 'end', node };
    current = leave(current);
  }
  throw new RoutingError('The workflow contains a loop');
}

export function startNodeId(definition: WorkflowDefinition): string {
  const start = definition.nodes.find((node) => node.type === 'start');
  if (!start) throw new RoutingError('The workflow has no Start step');
  return start.id;
}

export function findApprovalNode(definition: WorkflowDefinition, nodeId: string): ApprovalNode {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.type !== 'approval')
    throw new RoutingError(`"${nodeId}" is not an approval step`);
  return node;
}
