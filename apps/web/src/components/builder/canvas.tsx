'use client';

import '@xyflow/react/dist/style.css';
import type { WorkflowDefinition, WorkflowNode } from '@flowgate/workflow';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { connect, mapNode, removeEdge, removeNode, ruleText, type Updater } from '@/lib/builder';
import { cx } from '../ui';

export type Selection = { kind: 'node' | 'edge'; id: string } | null;

type FlowNodeData = { node: WorkflowNode; subtitle: string; hasIssue: boolean };
type FlowNode = Node<FlowNodeData, 'step'>;

const STYLE: Record<WorkflowNode['type'], string> = {
  start: 'border-slate-400 bg-slate-100',
  approval: 'border-brand-500 bg-white',
  condition: 'border-amber-500 bg-amber-50',
  end: 'border-slate-400 bg-white',
};

function StepNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data;
  const title =
    node.type === 'start'
      ? 'Start'
      : node.type === 'end'
        ? node.outcome === 'approved'
          ? 'Approved'
          : 'Rejected'
        : node.name;
  const kind =
    node.type === 'approval'
      ? 'Approval'
      : node.type === 'condition'
        ? 'Condition'
        : node.type === 'end'
          ? 'End'
          : 'Begin';
  return (
    <div
      className={cx(
        'w-56 rounded-lg border-2 px-3 py-2 text-left shadow-xs',
        STYLE[node.type],
        node.type === 'end' && node.outcome === 'approved' && 'border-emerald-500',
        node.type === 'end' && node.outcome === 'rejected' && 'border-red-500',
        data.hasIssue && 'ring-2 ring-red-500 ring-offset-1',
        selected && 'outline-2 outline-offset-2 outline-brand-600',
      )}
    >
      {node.type !== 'start' && <Handle type="target" position={Position.Top} />}
      <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{kind}</p>
      <p className="truncate text-sm font-medium text-slate-900">{title}</p>
      {data.subtitle && <p className="truncate text-xs text-slate-600">{data.subtitle}</p>}
      {node.type !== 'end' && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

// Defined once, outside render: React Flow re-mounts every node if this object changes.
const nodeTypes = { step: StepNode };

export function Canvas({
  definition,
  update,
  selection,
  setSelection,
  issueNodeIds,
  issueEdgeIds,
  describeNode,
}: {
  definition: WorkflowDefinition;
  update: (fn: Updater) => void;
  selection: Selection;
  setSelection: Dispatch<SetStateAction<Selection>>;
  issueNodeIds: Set<string>;
  issueEdgeIds: Set<string>;
  describeNode: (node: WorkflowNode) => string;
}) {
  // React Flow measures each node; edges need those sizes to attach to the handles.
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});

  const nodes: FlowNode[] = useMemo(
    () =>
      definition.nodes.map((node) => ({
        id: node.id,
        type: 'step',
        position: node.position,
        deletable: node.type !== 'start',
        selected: selection?.kind === 'node' && selection.id === node.id,
        measured: sizes[node.id],
        data: { node, subtitle: describeNode(node), hasIssue: issueNodeIds.has(node.id) },
      })),
    [definition.nodes, selection, sizes, describeNode, issueNodeIds],
  );

  const edges: Edge[] = useMemo(() => {
    const conditionIds = new Set(
      definition.nodes.filter((n) => n.type === 'condition').map((n) => n.id),
    );
    return definition.edges.map((edge) => {
      const fromCondition = conditionIds.has(edge.source);
      const bad = issueEdgeIds.has(edge.id);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        selected: selection?.kind === 'edge' && selection.id === edge.id,
        label: fromCondition
          ? edge.isDefault
            ? 'otherwise'
            : ruleText(edge.rule, definition.form)
          : undefined,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: bad ? { stroke: '#dc2626', strokeWidth: 2 } : undefined,
        labelStyle: bad ? { fill: '#b91c1c' } : undefined,
      };
    });
  }, [definition, selection, issueEdgeIds]);

  // Selection changes arrive as separate "select" and "deselect" events, in any order, for
  // nodes and edges separately; reading the latest state inside setSelection keeps them consistent.
  const applySelect = useCallback(
    (kind: 'node' | 'edge', id: string, selected: boolean) =>
      setSelection((current) =>
        selected ? { kind, id } : current?.kind === kind && current.id === id ? null : current,
      ),
    [setSelection],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          const position = change.position;
          update(mapNode(change.id, (n) => ({ ...n, position })));
        } else if (change.type === 'dimensions' && change.dimensions) {
          const dimensions = change.dimensions;
          setSizes((s) => ({ ...s, [change.id]: dimensions }));
        } else if (change.type === 'select') {
          applySelect('node', change.id, change.selected);
        } else if (change.type === 'remove') {
          update(removeNode(change.id));
        }
      }
    },
    [update, applySelect],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'select') applySelect('edge', change.id, change.selected);
        else if (change.type === 'remove') update(removeEdge(change.id));
      }
    },
    [update, applySelect],
  );

  return (
    <div
      className="h-[560px] rounded-lg border border-slate-200 bg-white"
      aria-label="Workflow diagram"
    >
      <ReactFlow<FlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={(c) => update(connect(c.source, c.target))}
        isValidConnection={(c) => c.source !== c.target}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.3}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
