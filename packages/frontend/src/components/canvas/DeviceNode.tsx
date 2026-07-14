import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { DEVICE_STATUSES, DEVICE_TYPES } from '@/lib/devices';
import type { DeviceNodeData, DeviceStatus, DeviceType } from '@/types';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/hooks/useLanguage';
import { deviceStatusLabel, deviceTypeLabel } from '@/lib/devices';

function DeviceNodeComponent({ data, selected }: NodeProps<DeviceNodeData>) {
  const { language } = useLanguage();
  const type = (data.deviceType ?? 'OTHER') as DeviceType;
  const status = (data.status ?? 'UNKNOWN') as DeviceStatus;
  const meta = DEVICE_TYPES[type] ?? DEVICE_TYPES.OTHER;
  const statusMeta = DEVICE_STATUSES[status];
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        'group relative w-[200px] rounded-xl border bg-card p-3 shadow-md transition-all',
        selected
          ? 'border-primary ring-2 ring-primary/30'
          : 'border-border hover:border-primary/40',
      )}
      style={{ boxShadow: selected ? `0 0 0 1px hsl(var(--primary))` : undefined }}
    >
      {/* Connection handle */}
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />

      {/* Indicateur de statut (coin haut droit) */}
      <div
        className={cn(
          'absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-card',
          statusMeta.dot,
        )}
        title={deviceStatusLabel(status, language)}
      />

      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 pr-3">
          <p className="truncate text-sm font-semibold leading-tight" title={data.label}>
            {data.label}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {deviceTypeLabel(type, language)}
            {data.brand && data.model
              ? ` · ${data.brand} ${data.model}`
              : data.model
                ? ` · ${data.model}`
                : ''}
          </p>
          {data.ip && (
            <p className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {data.ip}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export const DeviceNode = memo(DeviceNodeComponent);
