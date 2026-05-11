import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

let db: Database.Database | null = null;
const DEFAULT_DB_PATH = join(process.env.HOME || '/tmp', '.local7', 'data.db');

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;
  const path = dbPath || process.env.LOCAL7_DB || DEFAULT_DB_PATH;
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  const userVersion = (db.pragma('user_version') as { user_version: number }[])[0]?.user_version ?? 0;

  // v1: base schema — always idempotent via IF NOT EXISTS
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      content_json TEXT NOT NULL,
      content_toon TEXT NOT NULL,
      content_text TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      type TEXT NOT NULL DEFAULT 'raw',
      tags TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_documents_key ON documents(key);
    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
    CREATE INDEX IF NOT EXISTS idx_documents_expires ON documents(expires_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      title,
      content_text,
      tags,
      content='documents',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, title, content_text, tags)
        VALUES (new.rowid, new.title, new.content_text, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, title, content_text, tags)
        VALUES ('delete', old.rowid, old.title, old.content_text, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, title, content_text, tags)
        VALUES ('delete', old.rowid, old.title, old.content_text, old.tags);
      INSERT INTO documents_fts(rowid, title, content_text, tags)
        VALUES (new.rowid, new.title, new.content_text, new.tags);
    END;
  `);

  // v2: add namespace, importance, access_count, last_accessed, content_hash columns
  if (userVersion < 2) {
    db.exec(`
      ALTER TABLE documents ADD COLUMN namespace TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE documents ADD COLUMN importance REAL NOT NULL DEFAULT 0.5;
      ALTER TABLE documents ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE documents ADD COLUMN last_accessed TEXT;
      ALTER TABLE documents ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';

      CREATE INDEX IF NOT EXISTS idx_documents_namespace ON documents(namespace);
      CREATE INDEX IF NOT EXISTS idx_documents_importance ON documents(importance);
      CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);

      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        vector BLOB NOT NULL,
        model TEXT NOT NULL,
        dims INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_vectors_document_id ON vectors(document_id);

      CREATE TABLE IF NOT EXISTS embed_cache (
        text_hash TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.pragma('user_version = 2');
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
