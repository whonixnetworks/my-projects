import { getDb } from './db.js';

export interface Local7Stats {
  totalDocuments: number;
  totalVectors: number;
  embeddingPending: number;
  expiredDocuments: number;
  byType: Array<{ type: string; count: number }>;
  byNamespace: Array<{ namespace: string; count: number }>;
  byImportance: Array<{ level: string; count: number }>;
  dbSizeMB: number;
}

export function getStats(): Local7Stats {
  const db = getDb();

  const totalDocs = (db.prepare('SELECT COUNT(*) as count FROM documents').get() as any).count;
  const totalVectors = (db.prepare('SELECT COUNT(*) as count FROM vectors').get() as any).count;
  const expired = (db.prepare(`SELECT COUNT(*) as count FROM documents WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`).get() as any).count;

  const byType = db.prepare('SELECT type, COUNT(*) as count FROM documents GROUP BY type ORDER BY count DESC').all() as Array<{ type: string; count: number }>;
  const byNamespace = db.prepare('SELECT namespace, COUNT(*) as count FROM documents GROUP BY namespace ORDER BY count DESC').all() as Array<{ namespace: string; count: number }>;
  const byImportance = db.prepare(`
    SELECT
      CASE
        WHEN importance >= 0.9 THEN 'critical'
        WHEN importance >= 0.6 THEN 'high'
        WHEN importance >= 0.4 THEN 'normal'
        ELSE 'low'
      END as level,
      COUNT(*) as count
    FROM documents GROUP BY level ORDER BY importance DESC
  `).all() as Array<{ level: string; count: number }>;

  const pageStats = db.pragma('page_count') as Array<{ page_count: number }>;
  const pageSize = db.pragma('page_size') as Array<{ page_size: number }>;
  const dbSizeBytes = (pageStats[0]?.page_count ?? 0) * (pageSize[0]?.page_size ?? 4096);

  return {
    totalDocuments: totalDocs,
    totalVectors,
    embeddingPending: totalDocs - totalVectors,
    expiredDocuments: expired,
    byType,
    byNamespace,
    byImportance,
    dbSizeMB: Number((dbSizeBytes / (1024 * 1024)).toFixed(2)),
  };
}