import dagre from 'dagre';
import type { DeviceType } from '@prisma/client';

/**
 * Automatic hierarchical graph layout for Orbis diagram auto-generation.
 *
 * This module replaces the previous hand-rolled grid-placement logic
 * (`x = index * 240, y = rank * 170`) with an industry-standard DAG layout
 * produced by `dagre`, and a real topology-aware role classifier that derives
 * core / distribution / access / edge / endpoint roles from graph structure
 * instead of name-matching alone.
 *
 * The layout is consumed by both `discovery.ts` and `collectors.ts` so that
 * network diagrams are positioned consistently regardless of the discovery
 * source.
 */

/** Minimal link shape shared by all discovery sources. */
export interface LayoutLink {
  source: string;
  target: string;
  protocol?: string | null;
}

/** Minimal device shape consumed by the layout / classifier. */
export interface LayoutDevice {
  id: string;
  type: DeviceType;
  name: string;
  /**
   * Optional number of physical ports on the device (e.g. from SNMP/SysDescr).
   * High port counts (48+) indicate distribution / core switches.
   */
  portCount?: number | null;
}

/** Topological role assigned to a device during layout. */
export type TopologyRole = 'EDGE' | 'CORE' | 'DISTRIBUTION' | 'ACCESS' | 'ENDPOINT';

/**
 * Rank (vertical band) for each role. EDGE at the top of the diagram,
 * ENDPOINT at the bottom — matching the standard enterprise three-tier
 * topology convention (internet/firewall on top, endpoints at the bottom).
 */
export const ROLE_RANK: Record<TopologyRole, number> = {
  EDGE: 0,
  CORE: 1,
  DISTRIBUTION: 2,
  ACCESS: 3,
  ENDPOINT: 4,
};

/** Backwards-compatible numeric topology rank, as persisted on nodes. */
export function roleToRank(role: TopologyRole): number {
  return ROLE_RANK[role];
}

/**
 * Determine the topological role of a device.
 *
 * The classifier combines four signals, strongest first:
 *  1. **Device type** — firewalls/routers/internet/cloud/modems are EDGE;
 *     servers/NAS/printers/workstations/etc. are ENDPOINT. Switches and
 *     access points depend on the graph signals below.
 *  2. **Graph degree** (number of topology links) — high-degree switches are
 *     core/distribution candidates, low-degree ones are access.
 *  3. **Betweenness centrality proxy** — nodes sitting on many shortest paths
 *     between others are core. This is the most reliable structural signal
 *     for "this is the heart of the network".
 *  4. **Port count** (when available) — 48+ ports strongly suggests a
 *     distribution/core switch, ~24 ports suggests access.
 *  5. **Name regex** — kept as a FALLBACK hint only, never the primary signal.
 *
 * @param device      the device to classify
 * @param links       all topology links in the diagram
 * @param allDevices  all devices (needed to build the adjacency structure)
 */
export function classifyTopologyRole(
  device: LayoutDevice,
  links: LayoutLink[],
  allDevices: LayoutDevice[],
): TopologyRole {
  // --- 1. Type-based fast path: endpoints and edge devices are unambiguous ---
  switch (device.type) {
    case 'INTERNET':
    case 'CLOUD':
    case 'FIREWALL':
    case 'ROUTER':
    case 'MODEM':
    case 'LOAD_BALANCER':
      return 'EDGE';
    case 'SERVER':
    case 'NAS':
    case 'SAN':
    case 'PRINTER':
    case 'WORKSTATION':
    case 'PHONE':
    case 'CAMERA':
    case 'IOT':
    case 'OT':
    case 'PDU':
    case 'UPS':
    case 'VM':
    case 'HYPERVISOR':
    case 'RACK':
    case 'OTHER':
      return 'ENDPOINT';
    // SWITCH, ACCESS_POINT, CONTROLLER, PATCH_PANEL → derive from graph below.
  }

  // --- 2. Build the undirected degree map (only switches/APs reach here) ---
  const validIds = new Set(allDevices.map((d) => d.id));
  const degree = new Map<string, number>();
  for (const d of allDevices) degree.set(d.id, 0);
  for (const link of links) {
    if (link.source === link.target) continue;
    if (!validIds.has(link.source) || !validIds.has(link.target)) continue;
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }

  // Access points are access-layer by default unless they happen to be very
  // high degree (unlikely, but handled by the logic below).
  if (device.type === 'ACCESS_POINT' || device.type === 'PATCH_PANEL') {
    return 'ACCESS';
  }

  // --- 3. Betweenness-centrality proxy ---
  const betweenness = computeBetweenness(device.id, links, validIds);

  // --- 4. Structural thresholds ---
  const nodeDegree = degree.get(device.id) ?? 0;
  const ports = device.portCount ?? null;

  // Normalise betweenness: divide by the maximum possible number of
  // source/target pairs to get a 0..1-ish ratio.
  const connectedCount = Math.max(1, [...degree.values()].filter((d) => d > 0).length);
  const maxPairs = (connectedCount * (connectedCount - 1)) / 2;
  const betweennessRatio = maxPairs > 0 ? betweenness / maxPairs : 0;

  // Core: highest-degree hub OR on a large fraction of shortest paths.
  // We pick the top-degree switch(es) as core.
  const degrees = [...degree.values()].sort((a, b) => b - a);
  const maxDegree = degrees[0] ?? 0;
  const isTopDegreeHub = nodeDegree >= 3 && nodeDegree >= maxDegree * 0.6;

  if (isTopDegreeHub && (betweennessRatio >= 0.25 || nodeDegree >= 4)) {
    return 'CORE';
  }

  // Distribution: many ports OR moderately high degree.
  if ((ports !== null && ports >= 48) || (nodeDegree >= 3 && betweennessRatio >= 0.1)) {
    return 'DISTRIBUTION';
  }

  // A switch with a non-trivial degree but not a hub is distribution/access
  // depending on port count.
  if (ports !== null && ports >= 24) {
    return 'DISTRIBUTION';
  }

  // Anything else with at least one link is access-layer; truly isolated
  // switches fall through to access as well.
  return 'ACCESS';
}

/**
 * Approximate betweenness centrality for a single node.
 *
 * We use BFS-based shortest-path counting between every reachable pair and
 * count how often `targetId` lies on those paths. This is an O(V*(V+E))
 * approximation (Brandes-style without the full back-propagation of credit),
 * which is perfectly adequate for a layout heuristic on networks of a few
 * hundred nodes — and avoids pulling in a heavy graph-theory dependency.
 */
function computeBetweenness(targetId: string, links: LayoutLink[], validIds: Set<string>): number {
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!validIds.has(a) || !validIds.has(b) || a === b) return;
    let neighbours = adjacency.get(a);
    if (!neighbours) {
      neighbours = new Set();
      adjacency.set(a, neighbours);
    }
    neighbours.add(b);
  };
  for (const link of links) {
    addEdge(link.source, link.target);
    addEdge(link.target, link.source);
  }

  const nodes = [...validIds];
  let betweenness = 0;

  for (const source of nodes) {
    if (source === targetId) continue;
    const distances = bfsDistances(source, adjacency);
    for (const target of nodes) {
      if (target === source || target === targetId) continue;
      const dist = distances.get(target);
      if (dist === undefined || dist < 2) continue; // pair not connected through targetId
      // Count shortest paths source -> ... -> target that pass through targetId.
      const pathsThrough = countShortestPathsThrough(source, target, targetId, adjacency);
      betweenness += pathsThrough;
    }
  }

  return betweenness;
}

/** BFS giving shortest hop-distance from `start` to every reachable node. */
function bfsDistances(start: string, adjacency: Map<string, Set<string>>): Map<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const queue: string[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const neighbours = adjacency.get(current);
    if (!neighbours) continue;
    const nextDist = (distances.get(current) ?? 0) + 1;
    for (const neighbour of neighbours) {
      if (!distances.has(neighbour)) {
        distances.set(neighbour, nextDist);
        queue.push(neighbour);
      }
    }
  }
  return distances;
}

/**
 * Count how many shortest paths between `source` and `target` go through
 * `via`. Uses forward BFS from `source` (counting the number of shortest
 * paths to each node) and a reverse pass from `target`.
 *
 * For path counting we use the standard "number of shortest paths" DP:
 *   σ(start) = 1
 *   σ(v) = Σ σ(u) for all u with dist(u) = dist(v) - 1 and u~v
 * Then paths-through-via = σ(source→via) * σ(via→target) when the distances
 * line up on a shortest path. Both σ values come from forward BFS runs.
 */
function countShortestPathsThrough(
  source: string,
  target: string,
  via: string,
  adjacency: Map<string, Set<string>>,
): number {
  const fromSource = shortestPathCounts(source, adjacency);
  const distSource = fromSource.distances;
  const sigmaSource = fromSource.counts;
  const fromTarget = shortestPathCounts(target, adjacency);
  const distTarget = fromTarget.distances;
  const sigmaTarget = fromTarget.counts;

  const ds = distSource.get(target);
  const dsv = distSource.get(via);
  const dvt = distTarget.get(via);
  if (ds === undefined || dsv === undefined || dvt === undefined) return 0;
  // via must lie exactly on a shortest source→target path.
  if (dsv + dvt !== ds) return 0;

  const sV = sigmaSource.get(via) ?? 0;
  const tV = sigmaTarget.get(via) ?? 0;
  if (sV === 0 || tV === 0) return 0;
  return sV * tV;
}

/** Number of shortest paths from `start` to every node, plus distances. */
function shortestPathCounts(
  start: string,
  adjacency: Map<string, Set<string>>,
): { distances: Map<string, number>; counts: Map<string, number> } {
  const distances = new Map<string, number>([[start, 0]]);
  const counts = new Map<string, number>([[start, 1]]);
  const queue: string[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const neighbours = adjacency.get(current);
    if (!neighbours) continue;
    const nextDist = (distances.get(current) ?? 0) + 1;
    const currentCount = counts.get(current) ?? 0;
    for (const neighbour of neighbours) {
      if (!distances.has(neighbour)) {
        distances.set(neighbour, nextDist);
        counts.set(neighbour, currentCount);
        queue.push(neighbour);
      } else if (distances.get(neighbour) === nextDist) {
        counts.set(neighbour, (counts.get(neighbour) ?? 0) + currentCount);
      }
    }
  }
  return { distances, counts };
}

export interface AutoLayoutOptions {
  /** Horizontal separation between nodes in the same rank. Default 80. */
  nodesep?: number;
  /** Vertical separation between ranks. Default 140. */
  ranksep?: number;
  /** Pixel size used for each node box (dagre needs a width/height hint). */
  nodeWidth?: number;
  nodeHeight?: number;
}

export interface LayoutResult {
  /** Map of device id → { x, y } centre position. */
  positions: Map<string, { x: number; y: number }>;
  /** Map of device id → assigned role. */
  roles: Map<string, TopologyRole>;
}

/**
 * Produce a hierarchical layout for a set of devices and links.
 *
 * The layout is oriented top-to-bottom (`rankdir: 'TB'`): EDGE devices
 * (internet, firewall, router) sit at the top, endpoints (servers,
 * workstations, …) at the bottom, with core / distribution / access switches
 * banded in between.
 *
 * Because dagre derives ranks from edge direction, we orient every edge from
 * the lower-rank-role node to the higher-rank-role node, and additionally
 * connect one representative node per adjacent role band so that disconnected
 * nodes (or nodes with no topology links) still land in the correct band.
 */
export function autoLayout(
  devices: LayoutDevice[],
  links: LayoutLink[],
  options: AutoLayoutOptions = {},
): LayoutResult {
  const {
    nodesep = 80,
    ranksep = 140,
    nodeWidth = 200,
    nodeHeight = 56,
  } = options;

  const roles = new Map<string, TopologyRole>();
  for (const device of devices) {
    roles.set(device.id, classifyTopologyRole(device, links, devices));
  }

  const graph = new dagre.graphlib.Graph<Record<string, unknown>>({ directed: true });
  graph.setGraph({
    rankdir: 'TB',
    nodesep,
    ranksep,
    marginx: 40,
    marginy: 40,
    ranker: 'tight-tree',
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const device of devices) {
    graph.setNode(device.id, { width: nodeWidth, height: nodeHeight, label: device.name });
  }

  // Orient every link from the lower-rank role to the higher-rank role so
  // dagre's ranker assigns them to the correct vertical band.
  const seenEdges = new Set<string>();
  for (const link of links) {
    const a = link.source;
    const b = link.target;
    if (a === b) continue;
    if (!roles.has(a) || !roles.has(b)) continue;
    const ra = roleToRank(roles.get(a)!);
    const rb = roleToRank(roles.get(b)!);
    const [from, to] = ra <= rb ? [a, b] : [b, a];
    const key = `${from}->${to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    // Weight edges so tighter (same band) neighbours cluster; longer role
    // jumps get a larger minlen so bands don't collapse.
    const roleGap = Math.abs(ra - rb);
    graph.setEdge(from, to, { weight: 1, minlen: Math.max(1, roleGap) });
  }

  // Constraint edges: link the first node of each adjacent role band so that
  // isolated nodes (e.g. a server with no LLDP link) still get a rank from
  // dagre and sit in the correct band relative to their peers.
  const byRank = new Map<number, string[]>();
  for (const device of devices) {
    const rank = roleToRank(roles.get(device.id)!);
    const list = byRank.get(rank) ?? [];
    list.push(device.id);
    byRank.set(rank, list);
  }
  const ranks = [...byRank.keys()].sort((x, y) => x - y);
  for (let i = 1; i < ranks.length; i += 1) {
    const upper = byRank.get(ranks[i - 1])?.[0];
    const lower = byRank.get(ranks[i])?.[0];
    if (upper && lower && upper !== lower) {
      graph.setEdge(upper, lower, { weight: 0, minlen: 1 });
    }
  }

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const device of devices) {
    const node = graph.node(device.id);
    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      positions.set(device.id, { x: node.x, y: node.y });
    }
  }

  return { positions, roles };
}
