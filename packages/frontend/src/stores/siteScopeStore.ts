import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SiteScopeState {
  /** Selected site ID, or null for "All sites" within the visible scope. */
  currentSiteId: string | null;
  setSiteId: (id: string | null) => void;
  clear: () => void;
}

/**
 * Store the site selected in the sidebar.
 * Persist it in localStorage so the scope survives a page reload.
 */
export const useSiteScope = create<SiteScopeState>()(
  persist(
    (set) => ({
      currentSiteId: null,
      setSiteId: (id) => set({ currentSiteId: id }),
      clear: () => set({ currentSiteId: null }),
    }),
    { name: 'orbis-site-scope' },
  ),
);
