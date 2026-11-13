import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from './definition';

export interface Graph {
  nodes: Map<string, WorkflowNode>;
  outgoing: Map<string, WorkflowEdge[]>;
  incoming: Map<string, WorkflowEdge[]>;
}

/** Index nodes and edges once so lookups during validation and routing are O(1). */
export function indexGraph(definition: WorkflowDefinition): Graph {
  const nodes = new Map<string, WorkflowNode>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const node of definition.nodes) {
    nodes.set(node.id, node);
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of definition.edges) {
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  }
  return { nodes, outgoing, incoming };
}
