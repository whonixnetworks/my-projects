import { IMPORTANCE_MAP } from './types.js';
import type { Importance } from './types.js';

export interface RelevanceConfig {
  semanticWeight: number;
  recencyWeight: number;
  frequencyWeight: number;
  decayHours: number;
  importanceBoost: number;
}

export const DEFAULT_RELEVANCE: RelevanceConfig = {
  semanticWeight: 0.6,
  recencyWeight: 0.25,
  frequencyWeight: 0.15,
  decayHours: 168,
  importanceBoost: 0.3,
};

export function calculateRelevance(
  semanticSimilarity: number,
  lastAccessed: string | null,
  createdAt: string,
  accessCount: number,
  importance: Importance | number,
  config: Partial<RelevanceConfig> = {},
): number {
  const cfg = { ...DEFAULT_RELEVANCE, ...config };

  const importanceValue = typeof importance === 'number'
    ? importance
    : IMPORTANCE_MAP[importance] ?? 0.5;

  // Time decay: exponential decay based on hours since last access
  const referenceTime = lastAccessed || createdAt;
  const hoursSinceAccess =
    (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60);
  const recency = Math.exp(-hoursSinceAccess / cfg.decayHours);

  // Frequency bonus: log10(accessCount+1) / log10(100), normalized so 1 at 100 accesses
  const frequency = Math.log10(accessCount + 1) / Math.log10(100);

  // Combined score
  const raw =
    semanticSimilarity * cfg.semanticWeight +
    recency * cfg.recencyWeight +
    frequency * cfg.frequencyWeight +
    importanceValue * cfg.importanceBoost;

  return Math.max(0, Math.min(1, raw));
}
