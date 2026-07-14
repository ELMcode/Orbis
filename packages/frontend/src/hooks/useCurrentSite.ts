import { useSiteScope } from '@/stores/siteScopeStore';

/**
 * Return the currently selected siteId (global filter), or undefined when
 * "All sites" is selected.
 *
 * Pass it to API calls so list pages follow the scope selected in the sidebar.
 */
export function useCurrentSite(): { siteId: string | undefined; currentSiteId: string | null } {
  const currentSiteId = useSiteScope((s) => s.currentSiteId);
  return { siteId: currentSiteId ?? undefined, currentSiteId };
}
