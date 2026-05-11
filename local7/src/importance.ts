import { IMPORTANCE_MAP } from './types.js';
import type { Importance } from './types.js';

export function resolveImportance(level?: Importance): number {
  if (!level) return IMPORTANCE_MAP.normal;
  return IMPORTANCE_MAP[level];
}

export function boostImportance(current: number, reason: 'accessed' | 'linked' | 'marked'): number {
  const boosts: Record<string, number> = {
    accessed: 0.05,
    linked: 0.1,
    marked: 0.2,
  };
  return Math.min(1.0, current + (boosts[reason] ?? 0));
}
