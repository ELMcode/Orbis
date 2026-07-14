import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ArrowLeft,
  Download,
  Upload,
  Undo2,
  Redo2,
  Loader2,
  Check,
  FileImage,
  FileJson,
  Link2,
  Trash2,
  X,
  RefreshCcw,
  History,
  GitCompareArrows,
  LayoutGrid,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import { useEditorStore } from '@/stores/editorStore';
import { DeviceNode } from '@/components/canvas/DeviceNode';
import { CableEdge } from '@/components/canvas/CableEdge';
import { Palette } from '@/components/canvas/Palette';
import { DeviceDrawer } from '@/components/canvas/DeviceDrawer';
import { TopologyDiff } from '@/components/canvas/TopologyDiff';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Field } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/Dropdown';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog';
import { exportDiagramJson, exportDiagramPng, exportDiagramSvg } from '@/lib/export';
import { DEVICE_TYPES, PORT_TYPE_LIST } from '@/lib/devices';
import { layoutDiagram } from '@/lib/autoLayout';
import type { CableEdgeData, DeviceNodeData, DeviceType, PortType } from '@/types';
import type { DiagramVersion } from '@/types';
import { localized, useLanguage } from '@/hooks/useLanguage';

const nodeTypes = { device: DeviceNode };
const edgeTypes = { cable: CableEdge };

interface HistoryState {
  past: { nodes: Node[]; edges: Edge[] }[];
  future: { nodes: Node[]; edges: Edge[] }[];
}

const emptyToUndefined = (value: string) => value.trim() || undefined;

export default function DiagramEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { canEdit } = useAuth();
  const { t, language } = useLanguage();
  const { setDiagram, selectNode, markDirty, markSaved, setSaving } = useEditorStore();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [defaultViewport] = useState<Viewport>({ x: 50, y: 50, zoom: 0.85 });
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<HistoryState>({ past: [], future: [] });
  const [lastSnapshot, setLastSnapshot] = useState<{ nodes: Node[]; edges: Edge[] }>({
    nodes: [],
    edges: [],
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [serverHistory, setServerHistory] = useState<DiagramVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Visual before/after comparison.
  const [diffTarget, setDiffTarget] = useState<{
    after: DiagramVersion;
    before: DiagramVersion | null;
  } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef<number | null>(null);

  // ─── Diagram loading ─────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    api.diagrams
      .get(id)
      .then(({ diagram }) => {
        const loadedNodes = (diagram.nodes as Node[]).map((n) => ({ ...n, selected: false }));
        const loadedEdges = (diagram.edges as Edge[]).map((e) => ({ ...e, selected: false }));
        setNodes(loadedNodes);
        setEdges(loadedEdges);
        setLastSnapshot({ nodes: loadedNodes, edges: loadedEdges });
        versionRef.current = diagram.version;
        setDiagram(diagram);
        if (diagram.viewport) {
          const vp = diagram.viewport as Viewport;
          setTimeout(() => rfInstance?.setViewport(vp), 50);
        }
        setLoaded(true);
      })
      .catch(() => {
        toast.error(localized(language, 'Diagramme introuvable', 'Diagram not found'));
        navigate('/diagrams');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (selectedEdgeId && !edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [edges, selectedEdgeId]);

  // ─── Automatic save (2s debounce) ───────────────────────
  const scheduleSave = useCallback(
    (newNodes: Node[], newEdges: Edge[]) => {
      if (!canEdit || !id) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          const vp = rfInstance?.getViewport();
          const { diagram } = await api.diagrams.update(id, {
            nodes: newNodes.map(({ selected, ...n }) => ({ ...n, selected: undefined }) as Node),
            edges: newEdges.map(({ selected, ...e }) => ({ ...e, selected: undefined }) as Edge),
            viewport: vp,
            expectedVersion: versionRef.current ?? undefined,
          });
          versionRef.current = diagram.version;
          setDiagram(diagram);
          markSaved();
        } catch (e: any) {
          toast.error(localized(language, 'Sauvegarde échouée', 'Save failed'), e.message);
        } finally {
          setSaving(false);
        }
      }, 2000);
    },
    [canEdit, id, rfInstance, setSaving, setDiagram, markSaved, toast],
  );

  const pushHistory = useCallback(
    (newNodes: Node[], newEdges: Edge[]) => {
      setHistory((h) => ({
        past: [...h.past.slice(-30), lastSnapshot],
        future: [],
      }));
      setLastSnapshot({ nodes: newNodes, edges: newEdges });
    },
    [lastSnapshot],
  );

  const attachDeviceToNode = useCallback(
    async (node: Node<DeviceNodeData>, options?: { openDrawer?: boolean }) => {
      if (!canEdit || !id) return null;
      const diagram = useEditorStore.getState().diagram;
      const data = node.data;
      const { device } = await api.devices.create({
        name: data.label,
        type: data.deviceType,
        status: data.status ?? 'UNKNOWN',
        diagramId: id,
        diagramNodeId: node.id,
        siteId: diagram?.siteId ?? null,
      });

      setNodes((nds) => {
        const next = nds.map((n) =>
          n.id === node.id
            ? { ...n, data: { ...n.data, deviceId: device.id, inventoryPending: false } }
            : n,
        );
        markDirty();
        scheduleSave(next, edges);
        return next;
      });

      if (options?.openDrawer) {
        setDrawerId(device.id);
        setDrawerOpen(true);
      }
      return device;
    },
    [canEdit, id, edges, markDirty, scheduleSave],
  );

  // ─── Handlers React Flow ─────────────────────────────────
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!canEdit) {
        // Read-only mode: allow selection only.
        const filtered = changes.filter((c) => c.type === 'select');
        setNodes((nds) => applyNodeChanges(filtered, nds));
        return;
      }
      setNodes((nds) => {
        const movedIds = new Set(
          changes
            .filter(
              (c): c is NodeChange & { id: string; type: 'position'; dragging?: boolean } =>
                c.type === 'position' && 'id' in c && c.dragging === false,
            )
            .map((c) => c.id),
        );
        const changed = applyNodeChanges(changes, nds);
        const next = movedIds.size
          ? changed.map((node) =>
              movedIds.has(node.id)
                ? { ...node, data: { ...node.data, positionLocked: true } }
                : node,
            )
          : changed;
        const structural = changes.some(
          (c) => c.type === 'add' || c.type === 'remove' || c.type === 'position',
        );
        if (structural) {
          pushHistory(next, edges);
          markDirty();
          scheduleSave(next, edges);
        }
        return next;
      });
      const sel = changes.find((c) => c.type === 'select' && c.selected) as
        { id: string } | undefined;
      const unsel = changes.find((c) => c.type === 'select' && !c.selected);
      if (sel) selectNode(sel.id);
      if (unsel && changes.every((c) => !(c.type === 'select' && c.selected))) selectNode(null);
    },
    [canEdit, edges, pushHistory, markDirty, scheduleSave, selectNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!canEdit) {
        const filtered = changes.filter((c) => c.type === 'select');
        setEdges((eds) => applyEdgeChanges(filtered, eds));
        return;
      }
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        const structural = changes.some((c) => c.type === 'add' || c.type === 'remove');
        if (structural) {
          pushHistory(nodes, next);
          markDirty();
          scheduleSave(nodes, next);
        }
        return next;
      });
      const selected = changes.find((c) => c.type === 'select' && c.selected) as
        { id: string } | undefined;
      if (selected) {
        setSelectedEdgeId(selected.id);
      } else if (changes.some((c) => c.type === 'select' && !c.selected)) {
        setSelectedEdgeId((current) =>
          changes.some((c) => c.type === 'select' && c.id === current && !c.selected)
            ? null
            : current,
        );
      }
    },
    [canEdit, nodes, pushHistory, markDirty, scheduleSave],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!canEdit) return;
      setEdges((eds) => {
        const newEdge: Edge = {
          ...conn,
          source: conn.source ?? '',
          target: conn.target ?? '',
          id: `e-${Date.now()}`,
          type: 'cable',
          markerEnd: { type: MarkerType.ArrowClosed },
          data: { cableType: 'ETHERNET', speed: '1G' },
        };
        const next = addEdge(newEdge, eds);
        pushHistory(nodes, next);
        markDirty();
        scheduleSave(nodes, next);
        return next;
      });
    },
    [canEdit, nodes, pushHistory, markDirty, scheduleSave],
  );

  // ─── Drag and drop from the palette ─────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!canEdit || !rfInstance) return;
      const raw = e.dataTransfer.getData('application/orbis-device');
      if (!raw) return;
      const { type } = JSON.parse(raw) as { type: DeviceType };
      const position = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const meta = DEVICE_TYPES[type];
      const newNode: Node<DeviceNodeData> = {
        id: `n-${Date.now()}`,
        type: 'device',
        position,
        data: {
          label: meta.label,
          deviceType: type,
          status: 'UNKNOWN',
          deviceId: null,
          inventoryPending: true,
        },
      };
      setNodes((nds) => {
        const next = [...nds, newNode];
        pushHistory(next, edges);
        markDirty();
        scheduleSave(next, edges);
        return next;
      });
      attachDeviceToNode(newNode).catch((err: any) => {
        setNodes((nds) => {
          const next = nds.map((n) =>
            n.id === newNode.id ? { ...n, data: { ...n.data, inventoryPending: false } } : n,
          );
          markDirty();
          scheduleSave(next, edges);
          return next;
        });
        toast.error(
          localized(language, 'Équipement non créé', 'Device not created'),
          err.message ??
            localized(
              language,
              'Le symbole reste dans le schéma, mais il n’est pas encore lié à l’inventaire.',
              'The symbol remains in the diagram but is not linked to inventory yet.',
            ),
        );
      });
    },
    [canEdit, rfInstance, edges, pushHistory, markDirty, scheduleSave, attachDeviceToNode, toast],
  );

  // ─── Clicking a node opens the drawer ───────────────────
  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      setSelectedEdgeId(null);
      const data = node.data as DeviceNodeData;
      if (data.deviceId) {
        setDrawerId(data.deviceId);
        setDrawerOpen(true);
      } else if (data.inventoryPending) {
        toast.info(
          localized(
            language,
            'Création de la fiche équipement en cours…',
            'Creating the inventory device…',
          ),
        );
      } else {
        if (!canEdit) return;
        setNodes((nds) =>
          nds.map((n) =>
            n.id === node.id ? { ...n, data: { ...n.data, inventoryPending: true } } : n,
          ),
        );
        attachDeviceToNode(node as Node<DeviceNodeData>, { openDrawer: true })
          .then(() =>
            toast.success(
              localized(language, 'Équipement créé', 'Device created'),
              localized(language, 'Configurez ses détails', 'Configure its details'),
            ),
          )
          .catch((err: any) => {
            setNodes((nds) => {
              const next = nds.map((n) =>
                n.id === node.id ? { ...n, data: { ...n.data, inventoryPending: false } } : n,
              );
              markDirty();
              scheduleSave(next, edges);
              return next;
            });
            toast.error(
              localized(language, 'Équipement non créé', 'Device not created'),
              err.message,
            );
          });
      }
    },
    [canEdit, toast, attachDeviceToNode, markDirty, scheduleSave, edges],
  );

  const onEdgeClick = useCallback((_e: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
  }, []);

  const updateSelectedEdge = useCallback(
    (patch: Partial<CableEdgeData>) => {
      if (!canEdit || !selectedEdgeId) return;
      setEdges((eds) => {
        const next = eds.map((edge) => {
          if (edge.id !== selectedEdgeId) return edge;
          return {
            ...edge,
            data: {
              ...(edge.data as CableEdgeData | undefined),
              ...patch,
            },
          };
        });
        pushHistory(nodes, next);
        markDirty();
        scheduleSave(nodes, next);
        return next;
      });
    },
    [canEdit, selectedEdgeId, nodes, pushHistory, markDirty, scheduleSave],
  );

  const removeSelectedEdge = useCallback(() => {
    if (!canEdit || !selectedEdgeId) return;
    setEdges((eds) => {
      const next = eds.filter((edge) => edge.id !== selectedEdgeId);
      pushHistory(nodes, next);
      markDirty();
      scheduleSave(nodes, next);
      return next;
    });
    setSelectedEdgeId(null);
  }, [canEdit, selectedEdgeId, nodes, pushHistory, markDirty, scheduleSave]);

  const unlinkedInventoryNodes = useMemo(
    () =>
      nodes.filter((node) => {
        const data = node.data as DeviceNodeData | undefined;
        return node.type === 'device' && data && !data.deviceId && !data.inventoryPending;
      }) as Node<DeviceNodeData>[],
    [nodes],
  );

  const syncInventory = useCallback(async () => {
    if (!canEdit || unlinkedInventoryNodes.length === 0) return;
    const ids = new Set(unlinkedInventoryNodes.map((node) => node.id));
    setNodes((nds) => {
      const next = nds.map((node) =>
        ids.has(node.id) ? { ...node, data: { ...node.data, inventoryPending: true } } : node,
      );
      markDirty();
      scheduleSave(next, edges);
      return next;
    });

    let created = 0;
    let failed = 0;
    for (const node of unlinkedInventoryNodes) {
      try {
        await attachDeviceToNode(node);
        created += 1;
      } catch {
        failed += 1;
        setNodes((nds) => {
          const next = nds.map((n) =>
            n.id === node.id ? { ...n, data: { ...n.data, inventoryPending: false } } : n,
          );
          markDirty();
          scheduleSave(next, edges);
          return next;
        });
      }
    }

    if (created > 0) {
      toast.success(
        localized(language, 'Inventaire synchronisé', 'Inventory synchronized'),
        language === 'fr'
          ? `${created} fiche${created > 1 ? 's' : ''} équipement créée${created > 1 ? 's' : ''}`
          : `${created} inventory device${created > 1 ? 's' : ''} created`,
      );
    }
    if (failed > 0) {
      toast.error(
        localized(language, 'Synchronisation partielle', 'Partial synchronization'),
        language === 'fr'
          ? `${failed} élément${failed > 1 ? 's' : ''} non lié${failed > 1 ? 's' : ''}`
          : `${failed} item${failed > 1 ? 's' : ''} not linked`,
      );
    }
  }, [canEdit, unlinkedInventoryNodes, markDirty, scheduleSave, edges, attachDeviceToNode, toast]);

  // ─── Undo / Redo ─────────────────────────────────────────
  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const prev = h.past[h.past.length - 1];
      setNodes(() => {
        setLastSnapshot({ nodes: prev.nodes, edges: prev.edges });
        scheduleSave(prev.nodes, edges);
        return prev.nodes;
      });
      setEdges(() => prev.edges);
      markDirty();
      return { past: h.past.slice(0, -1), future: [lastSnapshot, ...h.future].slice(0, 30) };
    });
  }, [edges, lastSnapshot, markDirty, scheduleSave]);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      setNodes(() => {
        setLastSnapshot({ nodes: next.nodes, edges: next.edges });
        scheduleSave(next.nodes, next.edges);
        return next.nodes;
      });
      setEdges(() => next.edges);
      markDirty();
      return { past: [...h.past, lastSnapshot].slice(-30), future: h.future.slice(1) };
    });
  }, [lastSnapshot, markDirty, scheduleSave]);

  // ─── Keyboard shortcuts ─────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // React Flow handles deletion when deleteKeyCode is enabled.
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ─── Export ──────────────────────────────────────────────
  const onExport = async (kind: 'png' | 'svg' | 'json') => {
    const name = useEditorStore.getState().diagram?.name ?? 'diagramme';
    try {
      if (kind === 'json') {
        const d = useEditorStore.getState().diagram;
        if (d) exportDiagramJson({ ...d, nodes, edges });
      } else if (wrapperRef.current) {
        toast.info(localized(language, 'Export en cours…', 'Exporting…'));
        const el = wrapperRef.current.querySelector('.react-flow') as HTMLElement;
        if (kind === 'png') await exportDiagramPng(el, name);
        else await exportDiagramSvg(el, name);
        toast.success(localized(language, 'Export réussi', 'Export completed'));
      }
    } catch (e: any) {
      toast.error(localized(language, 'Export échoué', 'Export failed'), e.message);
    }
  };

  const onImport = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges))
          throw new Error('Format invalide');
        setNodes(data.nodes);
        setEdges(data.edges);
        markDirty();
        scheduleSave(data.nodes, data.edges);
        toast.success(localized(language, 'Schéma importé', 'Diagram imported'));
      } catch (e: any) {
        toast.error(localized(language, 'Import échoué', 'Import failed'), e.message);
      }
    };
    inp.click();
  };

  // ─── Automatically arrange the diagram (dagre) ──────────
  const onAutoLayout = () => {
    if (nodes.length === 0) {
      toast.info(localized(language, 'Aucun nœud à organiser', 'No nodes to arrange'));
      return;
    }
    // Snapshot for history (undo).
    pushHistory(nodes, edges);
    const laidOut = layoutDiagram(nodes, edges);
    setNodes(laidOut);
    setLastSnapshot({ nodes: laidOut, edges });
    markDirty();
    scheduleSave(laidOut, edges);
    // Re-center the view on the new layout.
    setTimeout(() => rfInstance?.fitView({ padding: 0.2, duration: 400 }), 50);
    toast.success(localized(language, 'Schéma organisé', 'Diagram arranged'));
  };

  const loadHistory = useCallback(async () => {
    if (!id) return;
    setHistoryLoading(true);
    try {
      const res = await api.diagrams.history(id);
      setServerHistory(res.history as DiagramVersion[]);
    } catch (e: any) {
      toast.error('Historique indisponible', e.message);
    } finally {
      setHistoryLoading(false);
    }
  }, [id, toast]);

  const toggleHistory = useCallback(() => {
    setHistoryOpen((open) => {
      const next = !open;
      if (next) void loadHistory();
      return next;
    });
  }, [loadHistory]);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      if (!id || !canEdit) return;
      try {
        const { diagram } = await api.diagrams.restore(id, versionId);
        const restoredNodes = (diagram.nodes as Node[]).map((node) => ({
          ...node,
          selected: false,
        }));
        const restoredEdges = (diagram.edges as Edge[]).map((edge) => ({
          ...edge,
          selected: false,
        }));
        setNodes(restoredNodes);
        setEdges(restoredEdges);
        setLastSnapshot({ nodes: restoredNodes, edges: restoredEdges });
        versionRef.current = diagram.version;
        setDiagram(diagram);
        setHistoryOpen(false);
        markSaved();
        toast.success('Version restaurée');
      } catch (e: any) {
        toast.error('Restauration échouée', e.message);
      }
    },
    [canEdit, id, markSaved, setDiagram, toast],
  );

  const approveSelectedEdge = useCallback(() => {
    updateSelectedEdge({ validationStatus: 'APPROVED', discovered: true });
  }, [updateSelectedEdge]);

  const rejectSelectedEdge = useCallback(() => {
    if (!selectedEdgeId || !canEdit) return;
    setEdges((eds) => {
      const next = eds.filter((edge) => edge.id !== selectedEdgeId);
      pushHistory(nodes, next);
      markDirty();
      scheduleSave(nodes, next);
      return next;
    });
    setSelectedEdgeId(null);
  }, [canEdit, markDirty, nodes, pushHistory, scheduleSave, selectedEdgeId]);

  const diagramName = useEditorStore((s) => s.diagram?.name);
  const isDirty = useEditorStore((s) => s.isDirty);
  const isSaving = useEditorStore((s) => s.isSaving);
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) as Edge<CableEdgeData> | undefined,
    [edges, selectedEdgeId],
  );
  const selectedEdgeData = selectedEdge?.data ?? {};
  const selectedEdgeEndpoints = useMemo(() => {
    if (!selectedEdge) return null;
    const source = nodes.find((node) => node.id === selectedEdge.source);
    const target = nodes.find((node) => node.id === selectedEdge.target);
    return {
      source: ((source?.data as DeviceNodeData | undefined)?.label ?? 'Source') as string,
      target: ((target?.data as DeviceNodeData | undefined)?.label ?? 'Destination') as string,
    };
  }, [nodes, selectedEdge]);

  const minimapColor = useCallback((n: Node) => {
    const t = (n.data as DeviceNodeData)?.deviceType;
    return t ? (DEVICE_TYPES[t]?.color ?? '#64748b') : '#64748b';
  }, []);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* ─── Toolbar ──────────────────────────────────── */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b bg-card/50 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/diagrams')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-sm font-semibold leading-tight">{diagramName}</h1>
            <div className="flex items-center gap-1.5">
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground">Sauvegarde…</span>
                </>
              ) : isDirty ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <span className="text-[11px] text-muted-foreground">
                    {localized(language, 'Modifié', 'Modified')}
                  </span>
                </>
              ) : (
                <>
                  <Check className="h-3 w-3 text-status-online" />
                  <span className="text-[11px] text-muted-foreground">
                    {localized(language, 'Enregistré', 'Saved')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {canEdit && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={undo}
                disabled={history.past.length === 0}
                title={language === 'fr' ? 'Annuler (⌘Z)' : 'Undo (⌘Z)'}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={redo}
                disabled={history.future.length === 0}
                title={language === 'fr' ? 'Rétablir (⌘⇧Z)' : 'Redo (⌘⇧Z)'}
              >
                <Redo2 className="h-4 w-4" />
              </Button>
              <div className="mx-1 h-5 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onImport}
                title={language === 'fr' ? 'Importer JSON' : 'Import JSON'}
              >
                <Upload className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onAutoLayout}
                title={
                  language === 'fr' ? 'Organiser automatiquement le schéma' : 'Auto-arrange diagram'
                }
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              {unlinkedInventoryNodes.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={syncInventory}
                  title={
                    language === 'fr'
                      ? 'Créer les fiches équipements manquantes'
                      : 'Create missing device records'
                  }
                >
                  <RefreshCcw className="h-4 w-4" />
                  {language === 'fr' ? 'Synchroniser' : 'Sync'} ({unlinkedInventoryNodes.length})
                </Button>
              )}
            </>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleHistory}
            title={language === 'fr' ? 'Historique et comparaison' : 'History and comparison'}
          >
            <History className="h-4 w-4" /> {language === 'fr' ? 'Historique' : 'History'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" title={t.ui.export}>
                <Download className="h-4 w-4" /> {t.ui.export}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => onExport('png')}>
                <FileImage className="h-4 w-4" /> {language === 'fr' ? 'Image PNG' : 'PNG image'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport('svg')}>
                <FileImage className="h-4 w-4" /> {language === 'fr' ? 'Vecteur SVG' : 'SVG vector'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onExport('json')}>
                <FileJson className="h-4 w-4" />{' '}
                {language === 'fr' ? 'JSON (ré-importable)' : 'JSON (re-importable)'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ─── Canvas ───────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <Palette />

        <div ref={wrapperRef} className="relative flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setRfInstance}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={() => setSelectedEdgeId(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultViewport={defaultViewport}
            minZoom={0.2}
            maxZoom={2.5}
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : []}
            nodesConnectable={canEdit}
            elementsSelectable
            fitView
            attributionPosition="bottom-left"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="opacity-50" />
            <Controls position="bottom-right" />
            <MiniMap
              nodeColor={minimapColor}
              className="!bg-card"
              maskColor="hsl(var(--muted) / 0.6)"
              position="bottom-left"
            />
          </ReactFlow>

          {!canEdit && (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2">
              <Badge variant="muted" className="backdrop-blur">
                {language === 'fr' ? 'Mode lecture seule' : 'Read-only mode'}
              </Badge>
            </div>
          )}

          {historyOpen && (
            <aside className="absolute left-4 top-4 z-10 max-h-[calc(100%-2rem)] w-96 overflow-hidden rounded-md border bg-card/95 shadow-lg backdrop-blur">
              <div className="flex items-start justify-between gap-3 border-b p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <GitCompareArrows className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">
                      {language === 'fr' ? 'Historique visuel' : 'Visual history'}
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {language === 'fr'
                      ? 'Versions serveur et changements de topologie.'
                      : 'Server versions and topology changes.'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setHistoryOpen(false)}
                  title="Fermer"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="max-h-[520px] space-y-2 overflow-y-auto p-3">
                {historyLoading && (
                  <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
                  </div>
                )}
                {!historyLoading && serverHistory.length === 0 && (
                  <div className="rounded-md border p-3 text-sm text-muted-foreground">
                    {language === 'fr' ? 'Aucune version enregistrée.' : 'No saved versions.'}
                  </div>
                )}
                {serverHistory.map((version, index) => {
                  const previous = serverHistory[index + 1] ?? null;
                  const diff = diffDiagramVersions(version, previous);
                  const hasPrevious = Boolean(previous);
                  return (
                    <div key={version.id} className="rounded-md border bg-background p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{formatDate(version.createdAt)}</p>
                          {version.message && (
                            <p className="mt-1 text-xs text-muted-foreground">{version.message}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDiffTarget({ after: version, before: previous })}
                            title={
                              hasPrevious
                                ? 'Comparer visuellement avec la version précédente'
                                : "Comparer avec l'état courant"
                            }
                          >
                            <GitCompareArrows className="h-3.5 w-3.5" /> Visuel
                          </Button>
                          {canEdit && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => restoreVersion(version.id)}
                            >
                              Restaurer
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                        <DiffMetric label="Nœuds +" value={diff.nodesAdded} />
                        <DiffMetric label="Nœuds -" value={diff.nodesRemoved} />
                        <DiffMetric label="Liens +" value={diff.edgesAdded} />
                        <DiffMetric label="Liens -" value={diff.edgesRemoved} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          )}

          {selectedEdge && (
            <aside className="absolute right-4 top-4 z-10 w-80 rounded-md border bg-card/95 p-4 shadow-lg backdrop-blur">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">
                      {language === 'fr' ? 'Lien réseau' : 'Network link'}
                    </h2>
                  </div>
                  {selectedEdgeEndpoints && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {selectedEdgeEndpoints.source} → {selectedEdgeEndpoints.target}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setSelectedEdgeId(null)}
                  title="Fermer"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-3">
                <Field label="Type de câble">
                  <Select
                    value={(selectedEdgeData.cableType ?? 'ETHERNET') as PortType}
                    onChange={(e) => updateSelectedEdge({ cableType: e.target.value as PortType })}
                    disabled={!canEdit}
                  >
                    {PORT_TYPE_LIST.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Vitesse" hint="Ex : 1G, 10G, 100G">
                    <Input
                      value={selectedEdgeData.speed ?? ''}
                      onChange={(e) =>
                        updateSelectedEdge({ speed: emptyToUndefined(e.target.value) })
                      }
                      placeholder="1G"
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field label="VLAN" hint="Optionnel">
                    <Input
                      value={selectedEdgeData.vlan ?? ''}
                      onChange={(e) =>
                        updateSelectedEdge({ vlan: emptyToUndefined(e.target.value) })
                      }
                      placeholder="10"
                      disabled={!canEdit}
                    />
                  </Field>
                </div>

                <Field label="Libellé" hint="Optionnel, affiché sur le lien">
                  <Input
                    value={selectedEdgeData.label ?? ''}
                    onChange={(e) =>
                      updateSelectedEdge({ label: emptyToUndefined(e.target.value) })
                    }
                    placeholder="Trunk, WAN, uplink…"
                    disabled={!canEdit}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Port source">
                    <Input
                      value={selectedEdgeData.localPort ?? ''}
                      onChange={(e) =>
                        updateSelectedEdge({ localPort: emptyToUndefined(e.target.value) })
                      }
                      placeholder="Gi1/0/1"
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field label="Port distant">
                    <Input
                      value={selectedEdgeData.remotePort ?? ''}
                      onChange={(e) =>
                        updateSelectedEdge({ remotePort: emptyToUndefined(e.target.value) })
                      }
                      placeholder="eth0"
                      disabled={!canEdit}
                    />
                  </Field>
                </div>

                {(selectedEdgeData.protocol ||
                  selectedEdgeData.layer ||
                  selectedEdgeData.confidence) && (
                  <div className="flex flex-wrap gap-2 rounded-md border bg-muted/50 p-2">
                    {selectedEdgeData.protocol && (
                      <Badge variant="outline">{selectedEdgeData.protocol}</Badge>
                    )}
                    {selectedEdgeData.layer && (
                      <Badge variant="outline">{selectedEdgeData.layer}</Badge>
                    )}
                    {selectedEdgeData.confidence != null && (
                      <Badge variant="outline">{selectedEdgeData.confidence}% confiance</Badge>
                    )}
                    {selectedEdgeData.validationStatus && (
                      <Badge
                        variant={
                          selectedEdgeData.validationStatus === 'APPROVED' ? 'success' : 'outline'
                        }
                      >
                        {selectedEdgeData.validationStatus}
                      </Badge>
                    )}
                  </div>
                )}

                {selectedEdgeData.discovered &&
                  canEdit &&
                  selectedEdgeData.validationStatus !== 'APPROVED' && (
                    <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-2">
                      <Button variant="outline" size="sm" onClick={approveSelectedEdge}>
                        Valider
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={rejectSelectedEdge}
                      >
                        Rejeter
                      </Button>
                    </div>
                  )}

                <Field label="Notes" hint="Optionnel">
                  <Textarea
                    rows={3}
                    value={selectedEdgeData.notes ?? ''}
                    onChange={(e) =>
                      updateSelectedEdge({ notes: emptyToUndefined(e.target.value) })
                    }
                    placeholder={localized(
                      language,
                      'Chemin de câble, opérateur, contraintes…',
                      'Cable path, carrier, constraints…',
                    )}
                    disabled={!canEdit}
                  />
                </Field>
              </div>

              {canEdit && (
                <div className="mt-4 border-t pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-destructive hover:text-destructive"
                    onClick={removeSelectedEdge}
                  >
                    <Trash2 className="h-4 w-4" />{' '}
                    {language === 'fr' ? 'Supprimer le lien' : 'Delete link'}
                  </Button>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>

      {/* ─── Detail drawer ────────────────────────────── */}
      <DeviceDrawer deviceId={drawerId} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* ─── Visual before/after comparison ───────────── */}
      <Dialog open={diffTarget !== null} onOpenChange={(open) => !open && setDiffTarget(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompareArrows className="h-5 w-5 text-primary" />
              Comparaison avant / après
            </DialogTitle>
            <DialogDescription>
              {diffTarget?.before
                ? `Comparaison de la version du ${formatDate(diffTarget.after.createdAt)} avec celle du ${formatDate(diffTarget.before.createdAt)}.`
                : `Comparaison de la version du ${diffTarget ? formatDate(diffTarget.after.createdAt) : ''} avec l'état courant du schéma.`}
            </DialogDescription>
          </DialogHeader>

          {diffTarget && (
            <TopologyDiff
              beforeNodes={(diffTarget.before?.nodes ?? nodes) as Node[]}
              beforeEdges={(diffTarget.before?.edges ?? edges) as Edge[]}
              afterNodes={(diffTarget.after.nodes ?? []) as Node[]}
              afterEdges={(diffTarget.after.edges ?? []) as Edge[]}
              beforeLabel={
                diffTarget.before
                  ? `Avant · ${formatDate(diffTarget.before.createdAt)}`
                  : 'Avant · État courant'
              }
              afterLabel={`Après · ${formatDate(diffTarget.after.createdAt)}`}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DiffMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted px-2 py-1">
      <div className="font-mono text-sm font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function diffDiagramVersions(current: DiagramVersion, previous?: DiagramVersion) {
  const currentNodeIds = new Set((current.nodes ?? []).map((node: any) => node.id).filter(Boolean));
  const previousNodeIds = new Set(
    (previous?.nodes ?? []).map((node: any) => node.id).filter(Boolean),
  );
  const currentEdgeIds = new Set(
    (current.edges ?? []).map((edge: any) => stableEdgeKey(edge)).filter(Boolean),
  );
  const previousEdgeIds = new Set(
    (previous?.edges ?? []).map((edge: any) => stableEdgeKey(edge)).filter(Boolean),
  );

  return {
    nodesAdded: countDifference(currentNodeIds, previousNodeIds),
    nodesRemoved: countDifference(previousNodeIds, currentNodeIds),
    edgesAdded: countDifference(currentEdgeIds, previousEdgeIds),
    edgesRemoved: countDifference(previousEdgeIds, currentEdgeIds),
  };
}

function stableEdgeKey(edge: any): string {
  const a = `${edge?.source ?? ''}:${edge?.data?.localPort ?? ''}`;
  const b = `${edge?.target ?? ''}:${edge?.data?.remotePort ?? ''}`;
  return [a, b].sort().join('<->');
}

function countDifference(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const item of left) {
    if (!right.has(item)) count += 1;
  }
  return count;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
