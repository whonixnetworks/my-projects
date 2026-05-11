import { v4 as uuid } from 'uuid';
import { getDb } from './db.js';
import { embedText, embedBatch, quantizeToInt8, dequantizeFromInt8 } from './embeddings.js';
import type { Document } from './types.js';

/**
 * Store an embedding vector for a document.
 */
export function storeVector(documentId: string, vector: Float32Array): void {
  const db = getDb();
  const id = uuid();
  const quantized = quantizeToInt8(vector);

  db.prepare(`
    INSERT OR REPLACE INTO vectors (id, document_id, vector, model, dims)
    VALUES (?, ?, ?, 'all-MiniLM-L6-v2', 384)
  `).run(id, documentId, quantized);
}

/**
 * Store vectors for multiple documents in a transaction.
 */
export function storeVectors(entries: Array<{ documentId: string; vector: Float32Array }>): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO vectors (id, document_id, vector, model, dims)
    VALUES (?, ?, ?, 'all-MiniLM-L6-v2', 384)
  `);

  const insertMany = db.transaction((items: typeof entries) => {
    for (const item of items) {
      const id = uuid();
      const quantized = quantizeToInt8(item.vector);
      stmt.run(id, item.documentId, quantized);
    }
  });

  insertMany(entries);
}

/**
 * Delete the vector for a document.
 */
export function deleteVector(documentId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM vectors WHERE document_id = ?').run(documentId);
}

/**
 * Generate and store embedding for a single document.
 * Returns the generated vector for optional caching.
 */
export async function embedAndStore(document: Document): Promise<Float32Array> {
  const text = document.content_text || document.title;
  const vector = await embedText(text);
  storeVector(document.id, vector);
  return vector;
}

/**
 * Generate and store embeddings for all documents that don't have one yet.
 * Used for initial index build and migration.
 */
export async function embedAllMissing(): Promise<{ embedded: number; errors: number }> {
  const db = getDb();

  const docs = db.prepare(`
    SELECT d.* FROM documents d
    LEFT JOIN vectors v ON v.document_id = d.id
    WHERE v.id IS NULL
      AND (d.expires_at IS NULL OR d.expires_at > datetime('now'))
  `).all() as Document[];

  if (docs.length === 0) return { embedded: 0, errors: 0 };

  console.error(`[local7] Embedding ${docs.length} documents...`);

  let embedded = 0;
  let errors = 0;

  for (const doc of docs) {
    try {
      await embedAndStore(doc);
      embedded++;
    } catch (err) {
      console.error(`[local7] Embedding failed for ${doc.key || doc.id}:`, err);
      errors++;
    }
  }

  console.error(`[local7] Embedded ${embedded} documents, ${errors} errors`);
  return { embedded, errors };
}

/**
 * Get a stored vector for a document.
 */
export function getVector(documentId: string): Float32Array | null {
  const db = getDb();
  const row = db.prepare('SELECT vector FROM vectors WHERE document_id = ?').get(documentId) as { vector: Buffer } | undefined;
  if (!row) return null;
  return dequantizeFromInt8(row.vector);
}