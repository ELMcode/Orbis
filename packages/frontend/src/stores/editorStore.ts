import { create } from 'zustand';
import type { Diagram } from '@/types';

interface EditorState {
  diagram: Diagram | null;
  selectedNodeId: string | null;
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: number | null;

  setDiagram: (d: Diagram | null) => void;
  selectNode: (id: string | null) => void;
  markDirty: () => void;
  markSaved: () => void;
  setSaving: (v: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  diagram: null,
  selectedNodeId: null,
  isDirty: false,
  isSaving: false,
  lastSavedAt: null,

  setDiagram: (d) => set({ diagram: d, isDirty: false, selectedNodeId: null, lastSavedAt: Date.now() }),
  selectNode: (id) => set({ selectedNodeId: id }),
  markDirty: () => set({ isDirty: true }),
  markSaved: () => set({ isDirty: false, lastSavedAt: Date.now() }),
  setSaving: (v) => set({ isSaving: v }),
}));
