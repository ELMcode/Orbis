import { useState, type DragEvent } from 'react';
import { Search, GripVertical } from 'lucide-react';
import { DEVICE_TYPES } from '@/lib/devices';
import type { DeviceType } from '@/types';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/hooks/useLanguage';

export interface PaletteItem {
  type: DeviceType;
  label: string;
}

export function Palette() {
  const { t, language } = useLanguage();
  const [query, setQuery] = useState('');

  const items = Object.entries(DEVICE_TYPES)
    .filter(([value, meta]) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return value.toLowerCase().includes(q) || meta.label.toLowerCase().includes(q);
    })
    .map(([value, meta]) => ({ type: value as DeviceType, label: meta.label }));

  const onDragStart = (e: DragEvent<HTMLDivElement>, type: DeviceType) => {
    e.dataTransfer.setData('application/orbis-device', JSON.stringify({ type }));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card/50">
      <div className="border-b p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {language === 'fr' ? 'Bibliothèque' : 'Library'}
        </p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t.ui.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {items.map((item) => {
          const meta = DEVICE_TYPES[item.type];
          const Icon = meta.icon;
          return (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              className={cn(
                'group flex cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 transition-all',
                'hover:border-border hover:bg-accent active:cursor-grabbing',
              )}
              title={
                language === 'fr'
                  ? `Glisser pour ajouter : ${meta.label}`
                  : `Drag to add: ${meta.label}`
              }
            >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
              <div
                className="flex h-8 w-8 items-center justify-center rounded-md"
                style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-xs font-medium">{meta.label}</span>
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t.ui.noResults}</p>
        )}
      </div>

      <div className="border-t p-3">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {language === 'fr'
            ? "Glissez un élément sur le canvas pour l'ajouter, puis cliquez pour le configurer."
            : 'Drag an item onto the canvas to add it, then click to configure it.'}
        </p>
      </div>
    </div>
  );
}
