import { memo } from 'react';
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';
import { PORT_TYPES } from '@/lib/devices';
import type { PortType } from '@/types';
import { useLanguage } from '@/hooks/useLanguage';

interface CableEdgeData {
  cableType?: PortType;
  label?: string;
  speed?: string;
  vlan?: string;
  protocol?: string;
  layer?: string;
  confidence?: number;
  localPort?: string;
  remotePort?: string;
  [k: string]: unknown;
}

function CableEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
  animated,
}: EdgeProps<CableEdgeData>) {
  const { language } = useLanguage();
  const cableType = (data?.cableType ?? 'ETHERNET') as PortType;
  const color = PORT_TYPES[cableType]?.color ?? '#64748b';

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const displayLabel = data?.label || data?.protocol || (typeof label === 'string' ? label : '');
  const portLabel = [data?.localPort, data?.remotePort].filter(Boolean).join(' ↔ ');

  return (
    <>
      {/* Wide, semi-transparent base path for the click target. */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeOpacity={0.85}
        strokeDasharray={
          cableType === 'FIBER' || cableType === 'SFP' || cableType === 'SFP_PLUS'
            ? '6 4'
            : undefined
        }
        className={animated ? 'react-flow__edge-path' : undefined}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan flex items-center gap-1 rounded-md border bg-card/95 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur"
          title={[
            data?.layer,
            portLabel,
            data?.confidence
              ? `${language === 'fr' ? 'Confiance' : 'Confidence'} ${data.confidence}%`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {displayLabel && <span>{displayLabel}</span>}
          {data?.speed && <span className="font-mono text-[9px] opacity-70">{data.speed}</span>}
          {data?.vlan && <span className="font-mono text-[9px] opacity-70">VLAN {data.vlan}</span>}
          {data?.confidence && data.confidence < 80 && (
            <span className="font-mono text-[9px] opacity-70">{data.confidence}%</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const CableEdge = memo(CableEdgeComponent);
