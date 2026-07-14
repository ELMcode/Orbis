import { type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  children,
  className,
  onClose,
}: {
  children: ReactNode;
  className?: string;
  onClose?: () => void;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          // Center the content through the grid rather than translate.
          'fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm',
          'data-[state=open]:animate-[fade-in_0.15s_ease-out]',
          'data-[state=closed]:animate-[fade-out_0.15s_ease-out]',
        )}
      >
        <DialogPrimitive.Content
          className={cn(
            'max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto outline-none',
            'rounded-xl border bg-card p-6 shadow-2xl',
            // Entry animation: use only opacity/scale to avoid
            // Override centering without translating the content.
            'data-[state=open]:animate-[dialog-in_0.18s_cubic-bezier(0.16,1,0.3,1)]',
            'data-[state=closed]:animate-[dialog-out_0.15s_ease-in]',
            className,
          )}
        >
          {children}
          <DialogPrimitive.Close
            onClick={onClose}
            className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Fermer</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-col gap-1', className)}>{children}</div>;
}

export function DialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <DialogPrimitive.Title className={cn('text-lg font-semibold', className)}>
      {children}
    </DialogPrimitive.Title>
  );
}

export function DialogDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)}>
      {children}
    </DialogPrimitive.Description>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mt-6 flex justify-end gap-2', className)}>{children}</div>;
}
