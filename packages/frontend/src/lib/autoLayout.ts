import dagre from 'dagre';
import type { Edge, Node } from 'reactflow';
import type { DeviceNodeData } from '@/types';

// Device node dimensions (see DeviceNode.tsx: w-[200px] plus padding).
const NODE_WIDTH = 200;
const NODE_HEIGHT = 90;

/**
 * Determine the hierarchical rank of a node for the dagre layout.
 * Internet/firewall/router at the top, switches/APs in the middle, and
 * servers/endpoints at the bottom.
 */
function nodeRank(data: DeviceNodeData): number {
  const type = data.deviceType ?? 'OTHER';
  // Edge (top): Internet, cloud, firewall, router, load balancer.
  if (['INTERNET', 'CLOUD', 'FIREWALL', 'ROUTER', 'LOAD_BALANCER', 'MODEM'].includes(type))
    return 0;
  // Endpoints (bottom): servers, NAS, SAN, VMs, printers, and more.
  if (['SERVER', 'NAS', 'SAN', 'VM', 'PDU', 'UPS', 'OTHER'].includes(type)) return 2;
  // Distribution / Access (milieu) : Switchs, AP Wi-Fi
  return 1;
}

/**
 * Calculate a hierarchical top-to-bottom layout for nodes using dagre.
 * Return nodes with new positions.
 */
export function layoutDiagram(nodes: Node[], edges: Edge[], direction: 'TB' | 'LR' = 'TB'): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 100,
    marginx: 40,
    marginy: 40,
    ranker: 'tight-tree',
  });

  // Add nodes with their forced rank.
  for (const node of nodes) {
    const rank = nodeRank(node.data as DeviceNodeData);
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT, rank });
  }

  // Add edges.
  for (const edge of edges) {
    // Orient the edge by rank (top to bottom) for a clean DAG.
    const sourceData = nodes.find((n) => n.id === edge.source)?.data as DeviceNodeData | undefined;
    const targetData = nodes.find((n) => n.id === edge.target)?.data as DeviceNodeData | undefined;
    if (sourceData && targetData) {
      if (nodeRank(sourceData) <= nodeRank(targetData)) {
        g.setEdge(edge.source, edge.target);
      } else {
        g.setEdge(edge.target, edge.source);
      }
    } else {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  // Apply the calculated positions to nodes.
  return nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;
    return {
      ...node,
      // Dagre returns the node center; React Flow uses the top-left corner.
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}
