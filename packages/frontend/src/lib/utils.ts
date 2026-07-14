import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes intelligently. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a file size. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 o';
  const k = 1024;
  const sizes = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Format an ISO date for the requested locale. */
export function formatDate(iso?: string | Date | null, language: 'fr' | 'en' = 'fr'): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString(language === 'en' ? 'en-GB' : 'fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Format a date with its time for the requested locale. */
export function formatDateTime(iso?: string | Date | null, language: 'fr' | 'en' = 'fr'): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString(language === 'en' ? 'en-GB' : 'fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Return the initial of a name. */
export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Delay execution. */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
