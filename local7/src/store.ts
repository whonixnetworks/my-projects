import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { getDb } from './db.js';
import { jsonToToon, extractText } from './toon.js';
import { resolveNamespace } from './namespace.js';
import { resolveImportance, boostImportance } from './importance.js';
import { embeddingQueue } from './embed-queue.js';
import { chunkText } from './chunking.js';
import type { Document, StoreInput, SearchResult, ListResult, DocType } from './types.js';

const AUTO_CHUNK_THRESHOLD = 2000;

export function store(input: StoreInput): Document {
  const db = getDb();
  const id = uuid();
  const key = input.key || null;
  const title = input.title || (key ? key : 'untitled');
  const type = input.type || 'raw';
  const tags = JSON.stringify(input.tags || []);
  const metadata = JSON.stringify(input.metadata || {});
  const sourceUrl = input.sourceUrl || null;
  const contentJson = JSON.stringify(input.data);
  const contentToon = jsonToToon(input.data);
  const contentText = extractText(input.data);
  const namespace = resolveNamespace(input.namespace);
  const importance = resolveImportance(input.importance);
  const contentHash = createHash('sha256').update(contentJson).digest('hex');

  let expiresAt: string | null = null;
  if (input.expiresInSeconds) {
    if (input.expiresInSeconds <= 0) {
      throw new Error('expiresInSeconds must be positive');
    }
    expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, '');
  }

  if (key) {
    const existing = db.prepare('SELECT id, importance, content_hash FROM documents WHERE key = ?').get(key) as { id: string; importance: number; content_hash: string } | undefined;
    if (existing) {
      const mergedImportance = Math.max(existing.importance, importance);
      db.prepare(`
        UPDATE documents SET
          title = ?, content_json = ?, content_toon = ?, content_text = ?,
          source_url = ?, type = ?, tags = ?, metadata = ?,
          expires_at = ?, namespace = ?, importance = ?, content_hash = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(title, contentJson, contentToon, contentText, sourceUrl, type, tags, metadata, expiresAt, namespace, mergedImportance, contentHash, existing.id);
      // Delete old vector if content changed
      if (existing.content_hash !== contentHash) {
        db.prepare('DELETE FROM vectors WHERE document_id = ?').run(existing.id);
        // Delete old child chunks too
        db.prepare(`DELETE FROM documents WHERE json_extract(metadata, '$.parentId') = ?`).run(existing.id);
      }
      const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(existing.id) as Document;

      // Re-enqueue for embedding and re-chunk if content changed
      if (existing.content_hash !== contentHash) {
        embeddingQueue.enqueue(existing.id, contentText);
        if (contentText.length > AUTO_CHUNK_THRESHOLD) {
          autoChunk(db, existing.id, contentText, title, namespace, tags, mergedImportance);
        }
      }

      return updated;
    }
  }

  db.prepare(`
    INSERT INTO documents (id, key, title, content_json, content_toon, content_text, source_url, type, tags, metadata, expires_at, namespace, importance, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, key, title, contentJson, contentToon, contentText, sourceUrl, type, tags, metadata, expiresAt, namespace, importance, contentHash);

  // Enqueue for embedding (non-blocking)
  embeddingQueue.enqueue(id, contentText);

  // Auto-chunk long content for better semantic search
  if (contentText.length > AUTO_CHUNK_THRESHOLD) {
    autoChunk(db, id, contentText, title, namespace, tags, importance);
  }

  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Document;
}

/**
 * Automatically chunk a long document and store chunks as children.
 * Each chunk gets its own embedding for fine-grained retrieval.
 */
function autoChunk(
  db: Database.Database,
  parentId: string,
  text: string,
  parentTitle: string,
  namespace: string,
  tagsJson: string,
  importance: number,
): void {
  const chunks = chunkText(text);
  const parentTags = JSON.parse(tagsJson);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkId = uuid();
    const chunkTitle = chunk.heading
      ? `${parentTitle} → ${chunk.heading}`
      : `${parentTitle} [${i + 1}/${chunks.length}]`;
    const chunkTags = JSON.stringify([...parentTags, 'chunk', `part_${i + 1}_of_${chunks.length}`]);
    const chunkMetadata = JSON.stringify({
      parentId,
      chunkIndex: i,
      totalChunks: chunks.length,
      heading: chunk.heading,
    });

    db.prepare(`
      INSERT INTO documents (id, key, title, content_json, content_toon, content_text,
        type, tags, metadata, namespace, importance, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, 'note', ?, ?, ?, ?, ?)
    `).run(
      chunkId,
      null, // Chunks don't get keys
      chunkTitle,
      JSON.stringify({ text: chunk.text, heading: chunk.heading, parentId }),
      chunk.text,
      chunk.text,
      chunkTags,
      chunkMetadata,
      namespace,
      importance,
      createHash('sha256').update(chunk.text).digest('hex'),
    );

    // Enqueue chunk for embedding
    embeddingQueue.enqueue(chunkId, chunk.text);
  }
}

export function retrieveByKey(key: string): Document | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM documents WHERE key = ?').get(key) as Document) || null;
}

export function retrieveById(id: string): Document | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Document) || null;
}

export function recordAccess(id: string): void {
  const db = getDb();
  const doc = db.prepare('SELECT importance FROM documents WHERE id = ?').get(id) as { importance: number } | undefined;
  if (!doc) return;
  const boosted = boostImportance(doc.importance, 'accessed');
  db.prepare(`
    UPDATE documents SET
      access_count = access_count + 1,
      last_accessed = datetime('now'),
      importance = ?
    WHERE id = ?
  `).run(boosted, id);
}

export function retrieve(keyOrId: string): Document | null {
  const doc = retrieveByKey(keyOrId) || retrieveById(keyOrId);
  if (doc) recordAccess(doc.id);
  return doc;
}

export function searchKeyword(query: string, limit: number = 10, type?: DocType, tags?: string[], namespace?: string): SearchResult[] {
  const db = getDb();
  let sql = `
    SELECT d.id, d.key, d.title, d.type, d.namespace, snippet(documents_fts, 1, '>>>', '<<<', '...', 32) as snippet, rank
    FROM documents_fts f
    JOIN documents d ON d.rowid = f.rowid
    WHERE documents_fts MATCH ?
  `;
  const params: unknown[] = [query];

  if (type) {
    sql += ' AND d.type = ?';
    params.push(type);
  }
  if (namespace) {
    sql += ' AND d.namespace = ?';
    params.push(namespace);
  }
  if (tags && tags.length > 0) {
    sql += ` AND (${tags.map(() => 'd.tags LIKE ?').join(' OR ')})`;
    tags.forEach(t => params.push(`%"${t}"%`));
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params) as SearchResult[];
}

export function search(query: string, limit: number = 10, type?: DocType, tags?: string[]): SearchResult[] {
  return searchKeyword(query, limit, type, tags);
}

export function list(type?: DocType, tags?: string[], namespace?: string): ListResult[] {
  const db = getDb();
  let sql = 'SELECT id, key, title, type, tags, created_at, updated_at, expires_at, namespace FROM documents WHERE 1=1';
  const params: unknown[] = [];

  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (namespace) {
    sql += ' AND namespace = ?';
    params.push(namespace);
  }
  if (tags && tags.length > 0) {
    sql += ` AND (${tags.map(() => 'tags LIKE ?').join(' OR ')})`;
    tags.forEach(t => params.push(`%"${t}"%`));
  }

  sql += ' ORDER BY updated_at DESC';

  const rows = db.prepare(sql).all(...params) as (Omit<ListResult, 'tags'> & { tags: string })[];
  return rows.map(r => ({ ...r, tags: JSON.parse(r.tags) }));
}

export function remove(keyOrId: string): boolean {
  const db = getDb();
  // Find the document id first so we can cascade to vectors
  const doc = db.prepare('SELECT id FROM documents WHERE key = ? OR id = ?').get(keyOrId, keyOrId) as { id: string } | undefined;
  if (!doc) return false;

  // Delete vectors and any child chunks (foreign key ON DELETE CASCADE handles vectors)
  db.prepare('DELETE FROM vectors WHERE document_id = ?').run(doc.id);
  const deleted = db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  return deleted.changes > 0;
}

export function cleanup(): number {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM documents WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
  ).run();
  return result.changes;
}
