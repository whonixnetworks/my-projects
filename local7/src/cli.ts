#!/usr/bin/env node
import { store, retrieve, searchKeyword, list, remove, cleanup } from './store.js';
import { semanticSearch, hybridSearch } from './search.js';
import { embedAllMissing } from './vectors.js';
import { consolidateMemory } from './consolidation.js';
import { summarizeText, createHierarchicalSummary } from './summary.js';
import { ingestUrl } from './ingest.js';
import { getDb, closeDb } from './db.js';
import { getStats } from './stats.js';
import { IMPORTANCE_MAP } from './types.js';
import type { DocType } from './types.js';

const args = process.argv.slice(2);
const command = args[0];

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) { resolve(data); return; }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  getDb();

  try {
    switch (command) {
      case 'store': {
        const keyIdx = args.indexOf('--key');
        const typeIdx = args.indexOf('--type');
        const tagsIdx = args.indexOf('--tags');
        const titleIdx = args.indexOf('--title');
        const ttlIdx = args.indexOf('--ttl');
        const impIdx = args.indexOf('--importance');
        const nsIdx = args.indexOf('--namespace');

        const key = keyIdx >= 0 ? args[keyIdx + 1] : undefined;
        const type = typeIdx >= 0 ? args[typeIdx + 1] as DocType : undefined;
        const tags = tagsIdx >= 0 ? args[tagsIdx + 1]?.split(',').filter(Boolean) : undefined;
        const title = titleIdx >= 0 ? args[titleIdx + 1] : undefined;
        const ttl = ttlIdx >= 0 ? parseInt(args[ttlIdx + 1], 10) : undefined;
        const importance = impIdx >= 0 ? args[impIdx + 1] as any : undefined;
        const namespace = nsIdx >= 0 ? args[nsIdx + 1] : undefined;

        let dataStr = '';
        const flagArgs = new Set(['--key', '--type', '--tags', '--title', '--ttl', '--importance', '--namespace']);
        for (let i = 1; i < args.length; i++) {
          const prev = args[i - 1];
          const cur = args[i];
          if (!cur.startsWith('--') && !flagArgs.has(prev)) { dataStr = cur; break; }
        }
        if (!dataStr) { const stdin = await readStdin(); if (stdin) dataStr = stdin.trim(); }
        if (!dataStr) { console.error('Usage: local7 store --key <key> [--type <type>] [--tags t1,t2] [--title <title>] [--ttl <sec>] [--importance <low|normal|high|critical>] [--namespace <ns>] [json-data]'); process.exit(1); }

        let data: unknown;
        try { data = JSON.parse(dataStr); } catch { data = dataStr; }
        const doc = store({ key, data, title, type, tags, expiresInSeconds: ttl, importance, namespace });
        console.log(`Stored: key=${doc.key || doc.id} type=${doc.type} importance=${doc.importance} ns=${doc.namespace}`);
        break;
      }

      case 'get': case 'retrieve': {
        const key = args[1];
        const fmt = args.includes('--json') ? 'json' : 'toon';
        if (!key) { console.error('Usage: local7 get <key-or-id> [--json]'); process.exit(1); }
        const doc = retrieve(key);
        if (!doc) { console.error(`Not found: ${key}`); process.exit(1); }
        console.log(fmt === 'json' ? doc.content_json : doc.content_toon);
        break;
      }

      case 'search': {
        const query = args[1];
        if (!query) { console.error('Usage: local7 search <query> [--limit N] [--type <type>]'); process.exit(1); }
        const limitIdx = args.indexOf('--limit');
        const typeIdx = args.indexOf('--type');
        const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 10;
        const type = typeIdx >= 0 ? args[typeIdx + 1] as DocType : undefined;
        const results = searchKeyword(query, limit, type);
        if (results.length === 0) { console.log('No results.'); break; }
        results.forEach((r, i) => {
          console.log(`${i + 1}. [${r.type}] ${r.title} (key: ${r.key || r.id})`);
          console.log(`   ${r.snippet.replace(/>>>/g, '**').replace(/<<< /g, '**')}`);
        });
        break;
      }

      case 'semantic': {
        const query = args[1];
        if (!query) { console.error('Usage: local7 semantic <query> [--limit N] [--min-score 0.5]'); process.exit(1); }
        const limitIdx = args.indexOf('--limit');
        const scoreIdx = args.indexOf('--min-score');
        const typeIdx = args.indexOf('--type');
        const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 5;
        const minScore = scoreIdx >= 0 ? parseFloat(args[scoreIdx + 1]) : 0.5;
        const type = typeIdx >= 0 ? args[typeIdx + 1] as DocType : undefined;
        console.error('Loading embedding model...');
        const results = await semanticSearch(query, limit, { type, minScore });
        if (results.length === 0) { console.log('No semantically similar documents found.'); break; }
        results.forEach((r, i) => console.log(`${i + 1}. [${r.type}] "${r.title}" (score: ${r.score.toFixed(3)}) key: ${r.key || r.id}`));
        break;
      }

      case 'context': {
        const query = args[1];
        if (!query) { console.error('Usage: local7 context <query> [--limit N]'); process.exit(1); }
        const limitIdx = args.indexOf('--limit');
        const typeIdx = args.indexOf('--type');
        const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 5;
        const type = typeIdx >= 0 ? args[typeIdx + 1] as DocType : undefined;
        console.error('Loading embedding model...');
        const results = await hybridSearch(query, limit, { type });
        if (results.length === 0) { console.log('No results found.'); break; }
        results.forEach((r, i) => console.log(`${i + 1}. [${r.type}] "${r.title}" (score: ${r.score.toFixed(3)}) key: ${r.key || r.id}`));
        break;
      }

      case 'boost': {
        const key = args[1];
        const impIdx = args.indexOf('--importance');
        if (!key || impIdx < 0) { console.error('Usage: local7 boost <key-or-id> --importance <low|normal|high|critical>'); process.exit(1); }
        const importance = args[impIdx + 1] as keyof typeof IMPORTANCE_MAP;
        const score = IMPORTANCE_MAP[importance];
        if (score === undefined) { console.error(`Invalid importance. Use: low, normal, high, critical`); process.exit(1); }
        const db = getDb();
        const result = db.prepare('UPDATE documents SET importance = ? WHERE key = ? OR id = ?').run(score, key, key);
        console.log(result.changes > 0 ? `Boosted "${key}" to ${importance} (${score})` : `Not found: ${key}`);
        break;
      }

      case 'summarize': {
        const key = args[1];
        if (!key) { console.error('Usage: local7 summarize <key-or-id> [--max-length 500] [--hierarchical]'); process.exit(1); }
        const maxLenIdx = args.indexOf('--max-length');
        const hierarchical = args.includes('--hierarchical');
        const maxLen = maxLenIdx >= 0 ? parseInt(args[maxLenIdx + 1], 10) : 500;
        const doc = retrieve(key);
        if (!doc) { console.error(`Not found: ${key}`); process.exit(1); }
        if (hierarchical) {
          const result = await createHierarchicalSummary(doc.content_text, doc.title);
          console.log(`# Summary of "${doc.title}"\n\n## Overall\n${result.fullSummary}`);
          result.sectionSummaries.forEach(s => console.log(`\n### ${s.heading}\n${s.summary}`));
        } else {
          const summary = await summarizeText(doc.content_text, maxLen);
          console.log(summary);
        }
        break;
      }

      case 'consolidate': {
        const dryRun = args.includes('--dry-run');
        if (dryRun) {
          const db = getDb();
          const stale = db.prepare(`SELECT COUNT(*) as count FROM documents WHERE created_at < datetime('now', '-24 hours') AND importance < 0.3`).get() as { count: number };
          const mid = db.prepare(`SELECT COUNT(*) as count FROM documents WHERE created_at < datetime('now', '-168 hours') AND importance >= 0.3 AND importance < 0.8`).get() as { count: number };
          const kept = db.prepare(`SELECT COUNT(*) as count FROM documents WHERE importance >= 0.8`).get() as { count: number };
          console.log(`Consolidation preview:\n- Would delete: ${stale.count} stale low-importance\n- Would consolidate: ${mid.count} mid-importance\n- Would keep: ${kept.count} high-importance`);
        } else {
          const result = await consolidateMemory();
          console.log(`Consolidation complete:\n- Deleted: ${result.deleted}\n- Consolidated: ${result.consolidated}\n- Kept: ${result.kept}\n- Orphaned chunks: ${result.orphanedChunks}`);
          if (result.errors.length > 0) console.log(`Errors: ${result.errors.join('; ')}`);
        }
        break;
      }

      case 'embed': {
        if (args.includes('--status')) {
          const db = getDb();
          const total = (db.prepare('SELECT COUNT(*) as c FROM documents').get() as any).c;
          const vectors = (db.prepare('SELECT COUNT(*) as c FROM vectors').get() as any).c;
          console.log(`Documents: ${total}\nWith vectors: ${vectors}\nPending: ${total - vectors}`);
        } else if (args.includes('--all')) {
          console.error('Embedding all missing documents...');
          const result = await embedAllMissing();
          console.log(`Embedded: ${result.embedded}, Errors: ${result.errors}`);
        } else {
          console.error('Usage: local7 embed [--all | --status]');
        }
        break;
      }

      case 'stats': {
        const stats = getStats();
        console.log(`Documents: ${stats.totalDocuments} (${stats.totalVectors} with vectors, ${stats.embeddingPending} pending)`);
        console.log(`Expired: ${stats.expiredDocuments} (run local7 cleanup)`);
        console.log(`Size: ${stats.dbSizeMB} MB`);
        console.log('\nBy type:');
        stats.byType.forEach((t: any) => console.log(`  ${t.type}: ${t.count}`));
        console.log('\nBy namespace:');
        stats.byNamespace.forEach((n: any) => console.log(`  ${n.namespace}: ${n.count}`));
        console.log('\nBy importance:');
        stats.byImportance.forEach((i: any) => console.log(`  ${i.level}: ${i.count}`));
        break;
      }

      case 'ingest': {
        const url = args[1];
        if (!url) { console.error('Usage: local7 ingest <url> [--key <key>] [--type <type>] [--tags t1,t2] [--ttl <sec>]'); process.exit(1); }
        const keyIdx = args.indexOf('--key');
        const typeIdx = args.indexOf('--type');
        const tagsIdx = args.indexOf('--tags');
        const ttlIdx = args.indexOf('--ttl');
        const key = keyIdx >= 0 ? args[keyIdx + 1] : undefined;
        const type = typeIdx >= 0 ? args[typeIdx + 1] as DocType : 'web_page';
        const tags = tagsIdx >= 0 ? args[tagsIdx + 1]?.split(',').filter(Boolean) : undefined;
        const ttl = ttlIdx >= 0 ? parseInt(args[ttlIdx + 1], 10) : undefined;
        console.log(`Ingesting: ${url}...`);
        const result = await ingestUrl(url);
        const parsed = JSON.parse(result.content);
        const docKey = key || new URL(url).hostname.replace(/\./g, '_') + '_' + Date.now();
        const doc = store({ key: docKey, data: parsed, title: result.title, type: type || 'web_page', tags, sourceUrl: url, expiresInSeconds: ttl });
        console.log(`Ingested: "${result.title}"\nKey: ${docKey}\nLength: ${result.textContent.length} chars`);
        break;
      }

      case 'list': {
        const typeIdx = args.indexOf('--type');
        const tagsIdx = args.indexOf('--tags');
        const nsIdx = args.indexOf('--namespace');
        const type = typeIdx >= 0 ? args[typeIdx + 1] as DocType : undefined;
        const tags = tagsIdx >= 0 ? args[tagsIdx + 1]?.split(',').filter(Boolean) : undefined;
        const namespace = nsIdx >= 0 ? args[nsIdx + 1] : undefined;
        const results = list(type, tags, namespace);
        if (results.length === 0) { console.log('No documents.'); break; }
        results.forEach((r, i) => {
          const tagStr = r.tags.length > 0 ? ` [${r.tags.join(', ')}]` : '';
          console.log(`${i + 1}. ${r.key || r.id} | ${r.type}${tagStr} | "${r.title}"`);
        });
        break;
      }

      case 'delete': case 'rm': {
        const key = args[1];
        if (!key) { console.error('Usage: local7 delete <key-or-id>'); process.exit(1); }
        console.log(remove(key) ? `Deleted: ${key}` : `Not found: ${key}`);
        break;
      }

      case 'cleanup': {
        const count = cleanup();
        console.log(`Cleaned up ${count} expired documents.`);
        break;
      }

      default:
        console.log(`Local7 v2.0 - Persistent semantic memory for AI agents

Usage:
  local7 store    --key <key> [--type <type>] [--tags t1,t2] [--title <title>]
                 [--ttl <sec>] [--importance <low|normal|high|critical>] [--namespace <ns>] [json-data]
  local7 get      <key-or-id> [--json]
  local7 search   <query> [--limit N] [--type <type>]
  local7 semantic <query> [--limit N] [--min-score 0.5] [--type <type>]
  local7 context  <query> [--limit N] [--type <type>]
  local7 list     [--type <type>] [--tags t1,t2] [--namespace <ns>]
  local7 ingest   <url> [--key <key>] [--type <type>] [--tags t1,t2]
  local7 delete   <key-or-id>
  local7 boost    <key-or-id> --importance <low|normal|high|critical>
  local7 summarize <key-or-id> [--max-length N] [--hierarchical]
  local7 consolidate [--dry-run]
  local7 embed    [--all | --status]
  local7 stats
  local7 cleanup

Types: preference, api_doc, web_page, note, search_result, raw
Importance: low (0.2), normal (0.5), high (0.8), critical (0.95)
Namespaces: default, pi, opencode, hermes, or custom

Examples:
  echo '{"mode": "dark"}' | local7 store --key preference_theme --importance high
  local7 get preference_theme
  local7 search "Docker networking"
  local7 semantic "container networking" --min-score 0.7
  local7 context "how to configure Docker networking"
  local7 boost user_preferences --importance critical
  local7 consolidate --dry-run
  local7 stats`);
    }
  } finally {
    closeDb();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});