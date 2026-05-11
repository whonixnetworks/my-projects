export type DocType = 'preference' | 'api_doc' | 'web_page' | 'note' | 'search_result' | 'raw';

export type Importance = 'low' | 'normal' | 'high' | 'critical';

export const IMPORTANCE_MAP: Record<Importance, number> = {
  low: 0.2,
  normal: 0.5,
  high: 0.8,
  critical: 0.95,
};

export interface Document {
  id: string;
  key: string | null;
  title: string;
  content_json: string;
  content_toon: string;
  content_text: string;
  source_url: string | null;
  type: DocType;
  tags: string;
  metadata: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  namespace: string;
  importance: number;
  access_count: number;
  last_accessed: string | null;
  content_hash: string;
}

export interface StoreInput {
  key?: string;
  data: unknown;
  title?: string;
  type?: DocType;
  tags?: string[];
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
  expiresInSeconds?: number;
  namespace?: string;
  importance?: Importance;
}

export interface SearchResult {
  id: string;
  key: string | null;
  title: string;
  type: DocType;
  snippet: string;
  rank: number;
  namespace: string;
}

export interface ListResult {
  id: string;
  key: string | null;
  title: string;
  type: DocType;
  tags: string[];
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  namespace: string;
}

export interface SemanticSearchResult {
  id: string;
  key: string | null;
  title: string;
  type: DocType;
  namespace: string;
  score: number;
}

export interface HybridSearchResult {
  id: string;
  key: string | null;
  title: string;
  type: DocType;
  namespace: string;
  score: number;
  semanticScore: number;
  keywordScore: number;
}
