import { getDb } from './db.js';
import { embedAndStore } from './vectors.js';
import type { Document } from './types.js';

interface EmbedJob {
  documentId: string;
  text: string;
  retries: number;
}

/**
 * Background queue for embedding documents.
 * Store operations return immediately; embeddings are generated
 * in the background so the agent is never blocked.
 */
class EmbeddingQueue {
  private queue: EmbedJob[] = [];
  private processing = false;
  private maxRetries = 3;

  /**
   * Add a document to the embedding queue.
   */
  enqueue(documentId: string, text: string): void {
    this.queue.push({ documentId, text, retries: 0 });
    this.processNext();
  }

  /**
   * Enqueue multiple documents at once.
   */
  enqueueBatch(documents: Array<{ id: string; text: string }>): void {
    for (const doc of documents) {
      this.queue.push({ documentId: doc.id, text: doc.text, retries: 0 });
    }
    this.processNext();
  }

  /**
   * Number of pending jobs in the queue.
   */
  get pending(): number {
    return this.queue.length;
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const job = this.queue.shift()!;
    const db = getDb();

    try {
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(job.documentId) as Document | undefined;

      if (!doc) {
        // Document was deleted before we could embed it — skip silently
        this.processing = false;
        this.processNext();
        return;
      }

      await embedAndStore(doc);
    } catch (err) {
      console.error(`[local7] Embedding failed for ${job.documentId}:`, err);

      if (job.retries < this.maxRetries) {
        // Retry with exponential backoff
        setTimeout(() => {
          this.queue.push({ ...job, retries: job.retries + 1 });
        }, 1000 * Math.pow(2, job.retries));
      }
    } finally {
      this.processing = false;
      this.processNext();
    }
  }
}

export const embeddingQueue = new EmbeddingQueue();