import { useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { cn } from '@/lib/utils';
import { DeviceNode } from '@/components/canvas/DeviceNode';
import { CableEdge } from '@/components/canvas/CableEdge';
import { useLanguage } from '@/hooks/useLanguage';

// ─── Types du diff ──────────────────────────────────────────
export type DiffStatus = 'added' | 'removed' | 'unchanged';

export interface DiffSummary {
  nodesAdded: number;
  nodesRemoved: number;
  nodesUnchanged: number;
  edgesAdded: number;
  edgesRemoved: number;
  edgesUnchanged: number;
}

interface TopologyDiffProps {
  beforeNodes: Node[];
  beforeEdges: Edge[];
  afterNodes: Node[];
  afterEdges: Edge[];
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}

// Couleurs du diff (palette hsl stable, lisible en clair/sombre)
const COLORS = {
  added: {
    border: 'hsl(142 71% 45%)',
    glow: '0 0 0 2px hsl(142 71% 45% / 0.3)',
    badgeBg: 'hsl(142 71% 45% / 0.15)',
    badgeText: 'hsl(142 71% 35%)',
    stroke: 'hsl(142 71% 45%)',
  },
  removed: {
    border: 'hsl(0 84% 60%)',
    glow: '0 0 0 2px hsl(0 84% 60% / 0.3)',
    badgeBg: 'hsl(0 84% 60% / 0.15)',
    badgeText: 'hsl(0 84% 50%)',
    stroke: 'hsl(0 84% 60%)',
  },
} as const;

const nodeTypes = { device: DeviceNode };
const edgeTypes = { cable: CableEdge };

/** Stable link key: sorted source/target plus optional ports. */
export function stableEdgeKey(edge: Edge): string {
  const a = `${edge?.source ?? ''}:${(edge?.data as any)?.localPort ?? ''}`;
  const b = `${edge?.target ?? ''}:${(edge?.data as any)?.remotePort ?? ''}`;
  return [a, b].sort().join('<->');
}

// ─── Calcul du diff ─────────────────────────────────────────
export function computeTopologyDiff(
  beforeNodes: Node[],
  beforeEdges: Edge[],
  afterNodes: Node[],
  afterEdges: Edge[],
) {
  const beforeNodeIds = new Set(beforeNodes.map((n) => n.id));
  const afterNodeIds = new Set(afterNodes.map((n) => n.id));

  const beforeEdgeKeys = new Map<string, Edge>();
  beforeEdges.forEach((e) => beforeEdgeKeys.set(stableEdgeKey(e), e));
  const afterEdgeKeys = new Map<string, Edge>();
  afterEdges.forEach((e) => afterEdgeKeys.set(stableEdgeKey(e), e));

  const nodeStatus = (id: string): DiffStatus => {
    const inBefore = beforeNodeIds.has(id);
    const inAfter = afterNodeIds.has(id);
    if (inBefore && !inAfter) return 'removed';
    if (!inBefore && inAfter) return 'added';
    return 'unchanged';
  };

  const edgeStatus = (edge: Edge): DiffStatus => {
    const key = stableEdgeKey(edge);
    const inBefore = beforeEdgeKeys.has(key);
    const inAfter = afterEdgeKeys.has(key);
    if (inBefore && !inAfter) return 'removed';
    if (!inBefore && inAfter) return 'added';
    return 'unchanged';
  };

  const summary: DiffSummary = {
    nodesAdded: 0,
    nodesRemoved: 0,
    nodesUnchanged: 0,
    edgesAdded: 0,
    edgesRemoved: 0,
    edgesUnchanged: 0,
  };

  const decorateNode = (node: Node, status: DiffStatus): Node => {
    if (status === 'added') {
      summary.nodesAdded += 1;
      return {
        ...node,
        selected: false,
        style: {
          ...(node.style ?? {}),
          borderColor: COLORS.added.border,
          borderStyle: 'solid',
          boxShadow: COLORS.added.glow,
        },
        className: cn(node.className, 'orbis-diff-node', 'orbis-diff-added'),
      };
    }
    if (status === 'removed') {
      summary.nodesRemoved += 1;
      return {
        ...node,
        selected: false,
        style: {
          ...(node.style ?? {}),
          opacity: 0.4,
          borderColor: COLORS.removed.border,
          borderStyle: 'dashed',
          boxShadow: COLORS.removed.glow,
        },
        className: cn(node.className, 'orbis-diff-node', 'orbis-diff-removed'),
      };
    }
    summary.nodesUnchanged += 1;
    return {
      ...node,
      selected: false,
      style: { ...(node.style ?? {}), opacity: 0.6 },
      className: cn(node.className, 'orbis-diff-node', 'orbis-diff-unchanged'),
    };
  };

  const decorateEdge = (edge: Edge, status: DiffStatus): Edge => {
    if (status === 'added') {
      summary.edgesAdded += 1;
      return {
        ...edge,
        selected: false,
        style: { stroke: COLORS.added.stroke, strokeWidth: 3 },
        animated: true,
        className: cn(edge.className, 'orbis-diff-edge-added'),
      };
    }
    if (status === 'removed') {
      summary.edgesRemoved += 1;
      return {
        ...edge,
        selected: false,
        style: {
          stroke: COLORS.removed.stroke,
          strokeWidth: 3,
          strokeDasharray: '6 4',
          opacity: 0.45,
        },
        className: cn(edge.className, 'orbis-diff-edge-removed'),
      };
    }
    summary.edgesUnchanged += 1;
    return {
      ...edge,
      selected: false,
      style: { ...(edge.style ?? {}), opacity: 0.4 },
    };
  };

  // Render every node on both canvases to preserve context.
  // spatially, but display only elements present in this version.
  const beforeNodesDecorated = beforeNodes.map((n) => decorateNode(n, nodeStatus(n.id)));
  const beforeEdgesDecorated = beforeEdges.map((e) => decorateEdge(e, edgeStatus(e)));
  const afterNodesDecorated = afterNodes.map((n) => decorateNode(n, nodeStatus(n.id)));
  const afterEdgesDecorated = afterEdges.map((e) => decorateEdge(e, edgeStatus(e)));

  return {
    summary,
    before: { nodes: beforeNodesDecorated, edges: beforeEdgesDecorated },
    after: { nodes: afterNodesDecorated, edges: afterEdgesDecorated },
  };
}

// ─── Sous-composant : canevas unique ────────────────────────
function DiffCanvas({
  title,
  subtitle,
  nodes,
  edges,
  side,
}: {
  title: string;
  subtitle?: string;
  nodes: Node[];
  edges: Edge[];
  side: 'before' | 'after';
}) {
  const { language } = useLanguage();
  const instanceRef = useRef<ReactFlowInstance | null>(null);

  // Recenter when the data changes.
  useEffect(() => {
    const t = setTimeout(() => instanceRef.current?.fitView({ padding: 0.2 }), 60);
    return () => clearTimeout(t);
  }, [nodes, edges]);

  const accentColor = side === 'after' ? COLORS.added.border : COLORS.removed.border;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: accentColor }}
            />
            <span className="truncate text-xs font-semibold">{title}</span>
          </div>
          {subtitle && (
            <span className="block truncate text-[10px] text-muted-foreground">{subtitle}</span>
          )}
        </div>
      </div>

      <div className="relative h-[420px] w-full sm:h-[500px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onInit={setInstance}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          attributionPosition="bottom-left"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="opacity-40" />
        </ReactFlow>
      </div>

      {/* Canvas-local legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
        {side === 'before' ? (
          <>
            <LegendItem
              color={COLORS.removed.border}
              label={language === 'fr' ? 'Supprimé' : 'Removed'}
              dashed
            />
            <LegendItem
              color="hsl(var(--border))"
              label={language === 'fr' ? 'Inchangé' : 'Unchanged'}
              dimmed
            />
          </>
        ) : (
          <>
            <LegendItem
              color={COLORS.added.border}
              label={language === 'fr' ? 'Ajouté' : 'Added'}
            />
            <LegendItem
              color="hsl(var(--border))"
              label={language === 'fr' ? 'Inchangé' : 'Unchanged'}
              dimmed
            />
          </>
        )}
      </div>
    </div>
  );

  function setInstance(inst: ReactFlowInstance) {
    instanceRef.current = inst;
  }
}

function LegendItem({
  color,
  label,
  dashed,
  dimmed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  dimmed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm border"
        style={{
          borderColor: color,
          borderStyle: dashed ? 'dashed' : 'solid',
          backgroundColor: dimmed ? 'transparent' : `${color}33`,
          opacity: dimmed ? 0.6 : 1,
        }}
      />
      {label}
    </span>
  );
}

// ─── Numeric summary header ─────────────────────────────────
function SummaryBar({ summary }: { summary: DiffSummary }) {
  const items: { label: string; value: number; tone: 'added' | 'removed' | 'muted' }[] = [
    { label: 'Nœuds +', value: summary.nodesAdded, tone: 'added' },
    { label: 'Nœuds −', value: summary.nodesRemoved, tone: 'removed' },
    { label: 'Liens +', value: summary.edgesAdded, tone: 'added' },
    { label: 'Liens −', value: summary.edgesRemoved, tone: 'removed' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.label}
          className={cn(
            'rounded-md border px-3 py-2 text-center',
            it.tone === 'added' && 'border-emerald-500/40 bg-emerald-500/5',
            it.tone === 'removed' && 'border-red-500/40 bg-red-500/5',
          )}
        >
          <div
            className="font-mono text-base font-bold"
            style={{
              color:
                it.tone === 'added'
                  ? COLORS.added.badgeText
                  : it.tone === 'removed'
                    ? COLORS.removed.badgeText
                    : undefined,
            }}
          >
            {it.value}
          </div>
          <div className="text-[10px] text-muted-foreground">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Composant principal ────────────────────────────────────
export function TopologyDiff({
  beforeNodes,
  beforeEdges,
  afterNodes,
  afterEdges,
  beforeLabel = 'Avant',
  afterLabel = 'Après',
  className,
}: TopologyDiffProps) {
  const { language } = useLanguage();
  const diff = useMemo(
    () => computeTopologyDiff(beforeNodes, beforeEdges, afterNodes, afterEdges),
    [beforeNodes, beforeEdges, afterNodes, afterEdges],
  );

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <SummaryBar summary={diff.summary} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DiffCanvas
          title={beforeLabel}
          subtitle={language === 'fr' ? 'État antérieur' : 'Previous state'}
          nodes={diff.before.nodes}
          edges={diff.before.edges}
          side="before"
        />
        <DiffCanvas
          title={afterLabel}
          subtitle={language === 'fr' ? 'État postérieur' : 'Current state'}
          nodes={diff.after.nodes}
          edges={diff.after.edges}
          side="after"
        />
      </div>
    </div>
  );
}

export default TopologyDiff;
