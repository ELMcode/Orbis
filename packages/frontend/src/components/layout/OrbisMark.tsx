import { cn } from '@/lib/utils';

export function OrbisMark({ className, title = 'Orbis' }: { className?: string; title?: string }) {
  return (
    <svg className={cn('shrink-0', className)} viewBox="0 0 48 48" fill="none" role="img" aria-label={title}>
      <defs>
        <linearGradient id="orbis-mark-gradient" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38bdf8" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="19" fill="url(#orbis-mark-gradient)" />
      <ellipse cx="24" cy="24" rx="9" ry="19" stroke="white" strokeWidth="1.8" opacity="0.9" />
      <ellipse cx="24" cy="24" rx="19" ry="7.5" stroke="white" strokeWidth="1.8" opacity="0.9" />
      <path d="M6 24h36" stroke="white" strokeWidth="1.4" opacity="0.65" />
      <circle cx="18" cy="17" r="2.1" fill="white" />
    </svg>
  );
}
