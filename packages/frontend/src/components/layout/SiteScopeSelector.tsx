import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronDown, Globe2, MapPin, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useSiteScope } from '@/stores/siteScopeStore';
import type { Site } from '@/types';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/hooks/useLanguage';

/** Build the site tree from a flat list. */
function buildTree(sites: Site[]): Site[] {
  const byId = new Map(sites.map((s) => [s.id, { ...s, children: [] as Site[] }]));
  const roots: Site[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function SiteScopeSelector() {
  const { language } = useLanguage();
  const { data } = useQuery({ queryKey: ['sites'], queryFn: () => api.sites.list() });
  const { currentSiteId, setSiteId } = useSiteScope();

  const sites = data?.sites ?? [];
  const tree = useMemo(() => buildTree(sites), [sites]);
  const current = sites.find((s) => s.id === currentSiteId);

  return (
    <div className="px-3 py-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {language === 'fr' ? 'Périmètre actif' : 'Active scope'}
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between font-normal">
            <span className="flex items-center gap-2 truncate">
              {current ? (
                <>
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">{current.name}</span>
                </>
              ) : (
                <>
                  <Globe2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>{language === 'fr' ? 'Tous les périmètres' : 'All scopes'}</span>
                </>
              )}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64 max-h-80 overflow-y-auto p-1">
          <SiteMenuItem
            label={language === 'fr' ? 'Tous les périmètres' : 'All scopes'}
            icon={<Globe2 className="h-3.5 w-3.5" />}
            active={!currentSiteId}
            onClick={() => setSiteId(null)}
          />
          <div className="my-1 h-px bg-border" />
          {tree.map((site) => (
            <SiteTreeNode
              key={site.id}
              site={site}
              depth={0}
              currentSiteId={currentSiteId}
              onSelect={setSiteId}
            />
          ))}
          {sites.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Aucun site</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SiteTreeNode({
  site,
  depth,
  currentSiteId,
  onSelect,
}: {
  site: Site;
  depth: number;
  currentSiteId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <>
      <SiteMenuItem
        label={site.name}
        icon={<MapPin className="h-3.5 w-3.5" />}
        active={currentSiteId === site.id}
        depth={depth}
        onClick={() => onSelect(site.id)}
      />
      {site.children?.map((child) => (
        <SiteTreeNode
          key={child.id}
          site={child}
          depth={depth + 1}
          currentSiteId={currentSiteId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function SiteMenuItem({
  label,
  icon,
  active,
  depth = 0,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  depth?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        'hover:bg-accent',
        active && 'bg-primary/10 text-primary',
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span className={cn('shrink-0', active ? 'text-primary' : 'text-muted-foreground')}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}
