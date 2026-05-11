import { getDb } from './db.js';
import { embedText, dequantizeFromInt8, cosineSimilarity } from './embeddings.js';
import { calculateRelevance, DEFAULT_RELEVANCE } from './relevance.js';
import { searchKeyword } from './store.js';
import type { DocType, SemanticSearchResult, HybridSearchResult } from './types.js';
import type { RelevanceConfig } from './relevance.js';

/**
 * Pure semantic search using vector similarity.
 * Finds documents by meaning, not keywords.
 */
export async function semanticSearch(
  query: string,
  limit: number = 10,
  options: {
    type?: DocType;
    namespace?: string;
    minScore?: number;
    importanceThreshold?: number;
  } = {},
): Promise<SemanticSearchResult[]> {
  const db = getDb();
  const queryVector = await embedText(query);
  const minScore = options.minScore ?? 0.5;

  let where = "(d.expires_at IS NULL OR d.expires_at > datetime('now'))";
  const params: unknown[] = [];

  if (options.type) {
    where += ' AND d.type = ?';
    params.push(options.type);
  }
  if (options.namespace) {
    where += ' AND d.namespace = ?';
    params.push(options.namespace);
  }
  if (options.importanceThreshold) {
    where += ' AND d.importance >= ?';
    params.push(options.importanceThreshold);
  }

  const rows = db.prepare(`
    SELECT d.id, d.key, d.title, d.type, d.namespace, d.content_text, v.vector
    FROM documents d
    JOIN vectors v ON v.document_id = d.id
    WHERE ${where}
  `).all(...params) as any[];

  const scored = rows.map(row => {
    const storedVector = dequantizeFromInt8(row.vector);
    const score = cosineSimilarity(queryVector, storedVector);
    return {
      id: row.id,
      key: row.key,
      title: row.title,
      type: row.type,
      namespace: row.namespace,
      snippet: (row.content_text || '').slice(0, 200),
      score,
    };
  });

  return scored
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Hybrid search: combines keyword (FTS5) and semantic results.
 * This is the best default search mode for agents.
 */
export async function hybridSearch(
  query: string,
  limit: number = 10,
  options: {
    type?: DocType;
    namespace?: string;
    minScore?: number;
    semanticWeight?: number;
    keywordWeight?: number;
  } = {},
): Promise<HybridSearchResult[]> {
  const semanticWeight = options.semanticWeight ?? 0.6;
  const keywordWeight = options.keywordWeight ?? 0.4;

  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(query, limit * 2, options),
    Promise.resolve(searchKeyword(query, limit * 2, options.type, undefined, options.namespace)),
  ]);

  const scores = new Map<string, {
    semantic: number;
    keyword: number;
    doc: any;
  }>();

  for (const r of semanticResults) {
    scores.set(r.id, { semantic: r.score, keyword: 0, doc: r });
  }

  for (const r of keywordResults) {
    const normalizedRank = 1 / (1 + Math.exp(-r.rank));
    const existing = scores.get(r.id);
    if (existing) {
      existing.keyword = normalizedRank;
    } else {
      scores.set(r.id, { semantic: 0, keyword: normalizedRank, doc: r });
    }
  }

  const combined = Array.from(scores.entries()).map(([id, s]) => ({
    id,
    key: s.doc.key,
    title: s.doc.title,
    type: s.doc.type,
    namespace: s.doc.namespace || 'default',
    snippet: s.doc.snippet || '',
    score: s.semantic * semanticWeight + s.keyword * keywordWeight,
    semanticScore: s.semantic,
    keywordScore: s.keyword,
  }));

  return combined
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Relevance-weighted search — the primary search for agents.
 * Combines semantic similarity, recency, frequency, and importance.
 */
export async function searchWithRelevance(
  query: string,
  limit: number = 10,
  options: {
    type?: DocType;
    namespace?: string;
    minScore?: number;
    config?: Partial<RelevanceConfig>;
  } = {},
): Promise<Array<HybridSearchResult & { relevance: number }>> {
  const db = getDb();
  const config = { ...DEFAULT_RELEVANCE, ...options.config };
  const queryVector = await embedText(query);

  let where = "(d.expires_at IS NULL OR d.expires_at > datetime('now'))";
  const params: unknown[] = [];

  if (options.type) {
    where += ' AND d.type = ?';
    params.push(options.type);
  }
  if (options.namespace) {
    where += ' AND d.namespace = ?';
    params.push(options.namespace);
  }

  const rows = db.prepare(`
    SELECT d.id, d.key, d.title, d.type, d.namespace, d.content_text,
           d.importance, d.access_count, d.last_accessed, d.created_at,
           v.vector
    FROM documents d
    JOIN vectors v ON v.document_id = d.id
    WHERE ${where}
  `).all(...params) as any[];

  // Also get keyword results for hybrid scoring
  const keywordResults = searchKeyword(query, limit * 2, options.type, undefined, options.namespace);
  const keywordScores = new Map<string, number>();
  for (const r of keywordResults) {
    keywordScores.set(r.id, 1 / (1 + Math.exp(-r.rank)));
  }

  const scored = rows.map(row => {
    const storedVector = dequantizeFromInt8(row.vector);
    const semanticScore = cosineSimilarity(queryVector, storedVector);
    const keywordScore = keywordScores.get(row.id) || 0;
    const relevance = calculateRelevance(
      semanticScore,
      row.last_accessed,
      row.created_at,
      row.access_count,
      row.importance,
      config,
    );

    return {
      id: row.id,
      key: row.key,
      title: row.title,
      type: row.type,
      namespace: row.namespace,
      snippet: (row.content_text || '').slice(0, 200),
      score: relevance,
      semanticScore,
      keywordScore,
      relevance,
    };
  });

  const minScore = options.minScore ?? 0.3;
  return scored
    .filter(r => r.relevance >= minScore)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}