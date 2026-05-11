import { getDb } from './db.js';
import { summarizeText } from './summary.js';
import { embeddingQueue } from './embed-queue.js';
import { deleteVector } from './vectors.js';
import { jsonToToon, extractText } from './toon.js';
import type { Document } from './types.js';

export interface ConsolidationConfig {
  shortTermMaxHours: number;
  midTermMaxHours: number;
  lowImportanceThreshold: number;
  highImportanceThreshold: number;
  consolidateBatchSize: number;
}

export const DEFAULT_CONSOLIDATION: ConsolidationConfig = {
  shortTermMaxHours: 24,
  midTermMaxHours: 168,
  lowImportanceThreshold: 0.3,
  highImportanceThreshold: 0.8,
  consolidateBatchSize: 100,
};

export interface ConsolidationResult {
  deleted: number;
  consolidated: number;
  kept: number;
  orphanedChunks: number;
  errors: string[];
}

/**
 * Run memory consolidation.
 *
 * 1. Delete stale low-importance items (older than shortTermMaxHours, importance below lowThreshold)
 * 2. Summarize mid-importance items (older than midTermMaxHours, importance between thresholds)
 * 3. Always keep high-importance items (importance >= highThreshold)
 * 4. Clean up orphaned chunks (parent was deleted)
 */
export async function consolidateMemory(
  config: ConsolidationConfig = DEFAULT_CONSOLIDATION,
): Promise<ConsolidationResult> {
  const db = getDb();
  const result: ConsolidationResult = {
    deleted: 0,
    consolidated: 0,
    kept: 0,
    orphanedChunks: 0,
    errors: [],
  };

  // 1. Delete stale low-importance items
  const staleResult = db.prepare(`
    DELETE FROM documents
    WHERE created_at < datetime('now', '-${config.shortTermMaxHours} hours')
      AND importance < ?
      AND importance < ?
      AND json_extract(metadata, '$.parentId') IS NULL
  `).run(config.lowImportanceThreshold, config.highImportanceThreshold);

  result.deleted = staleResult.changes;

  // 2. Consolidate mid-importance items
  const candidates = db.prepare(`
    SELECT * FROM documents
    WHERE created_at < datetime('now', '-${config.midTermMaxHours} hours')
      AND importance >= ?
      AND importance < ?
      AND content_text IS NOT NULL
      AND length(content_text) > 200
      AND json_extract(metadata, '$.parentId') IS NULL
      AND json_extract(metadata, '$.consolidated') IS NULL
    LIMIT ?
  `).all(
    config.lowImportanceThreshold,
    config.highImportanceThreshold,
    config.consolidateBatchSize,
  ) as Document[];

  for (const doc of candidates) {
    try {
      const summary = await summarizeText(doc.content_text, 300);

      const consolidatedJson = JSON.stringify({
        summary,
        originalKey: doc.key,
        originalType: doc.type,
        consolidatedAt: new Date().toISOString(),
        originalLength: doc.content_text.length,
      });

      const consolidatedToon = jsonToToon(JSON.parse(consolidatedJson));
      const newImportance = Math.max(doc.importance, 0.7);
      const existingMetadata = JSON.parse(doc.metadata || '{}');

      db.prepare(`
        UPDATE documents SET
          content_json = ?,
          content_toon = ?,
          content_text = ?,
          title = ?,
          type = 'note',
          importance = ?,
          metadata = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        consolidatedJson,
        consolidatedToon,
        summary,
        `[consolidated] ${doc.title}`,
        newImportance,
        JSON.stringify({ ...existingMetadata, consolidated: true, originalLength: doc.content_text.length }),
        doc.id,
      );

      // Re-embed with the new content
      deleteVector(doc.id);
      embeddingQueue.enqueue(doc.id, summary);

      result.consolidated++;
    } catch (err) {
      result.errors.push(`Failed to consolidate ${doc.key || doc.id}: ${String(err)}`);
    }
  }

  // 3. Count high-importance items kept
  const keptCount = db.prepare(`
    SELECT COUNT(*) as count FROM documents WHERE importance >= ?
  `).get(config.highImportanceThreshold) as { count: number };
  result.kept = keptCount.count;

  // 4. Clean up orphaned chunks
  const orphaned = db.prepare(`
    SELECT d.id FROM documents d
    WHERE json_extract(d.metadata, '$.parentId') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM documents p WHERE p.id = json_extract(d.metadata, '$.parentId')
      )
  `).all() as { id: string }[];

  for (const orph of orphaned) {
    db.prepare('DELETE FROM vectors WHERE document_id = ?').run(orph.id);
    db.prepare('DELETE FROM documents WHERE id = ?').run(orph.id);
  }
  result.orphanedChunks = orphaned.length;

  return result;
}