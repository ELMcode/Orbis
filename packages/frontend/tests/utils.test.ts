import { describe, it, expect } from 'vitest';
import { cn, formatBytes, initials, formatDate } from '@/lib/utils';

describe('cn', () => {
  it('fusionne les classes Tailwind', () => {
    expect(cn('px-2', 'py-1', false && 'hidden', 'px-4')).toBe('py-1 px-4');
  });
});

describe('formatBytes', () => {
  it('formate les bytes', () => {
    expect(formatBytes(0)).toBe('0 o');
    expect(formatBytes(1024)).toBe('1 Ko');
    expect(formatBytes(1536)).toBe('1.5 Ko');
    expect(formatBytes(1048576)).toBe('1 Mo');
  });
});

describe('initials', () => {
  it('retourne les initiales', () => {
    expect(initials('Jean Dupont')).toBe('JD');
    expect(initials('Marie')).toBe('M');
    expect(initials('Alice Bob Charlie')).toBe('AB');
  });
});

describe('formatDate', () => {
  it('formate les dates ISO en FR', () => {
    const d = formatDate('2026-07-05T10:00:00Z');
    expect(d).toMatch(/2026/);
  });
  it('retourne — pour une date vide', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });
});
