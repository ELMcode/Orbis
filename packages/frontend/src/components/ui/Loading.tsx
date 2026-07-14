import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Loading({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dim = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5';
  return <Loader2 className={cn(dim, 'animate-spin text-muted-foreground', className)} />;
}

export function FullLoading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loading size="lg" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
