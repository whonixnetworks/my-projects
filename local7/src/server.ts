#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { store, retrieve, search, searchKeyword, list, remove, cleanup } from './store.js';
import { semanticSearch, hybridSearch, searchWithRelevance } from './search.js';
import { embedAllMissing } from './vectors.js';
import { consolidateMemory } from './consolidation.js';
import { summarizeText, createHierarchicalSummary } from './summary.js';
import { ingestUrl } from './ingest.js';
import { getDb, closeDb } from './db.js';
import { IMPORTANCE_MAP } from './types.js';
import { getStats } from './stats.js';
import type { DocType } from './types.js';

const server = new McpServer({
  name: 'local7',
  version: '2.0.0',
});

// ─── local7_store ────────────────────────────────────────────────────────

server.tool(
  'local7_store',
  `Save information for later retrieval. ALWAYS use this when the user asks you to remember something, when you learn a preference, or when you discover information worth keeping. Data is stored permanently unless you set expiresInSeconds. Use meaningful keys like "preference_theme" or "api_docs_docker_networking". Tags help with categorization. Set importance for things the user explicitly says are important or that you reference frequently.`,
  {
    key: z.string().optional().describe('Unique key for direct lookup (e.g., "preference_theme", "api_docs_docker"). If exists, replaces existing data.'),
    data: z.record(z.string(), z.unknown()).or(z.array(z.unknown())).or(z.string()).or(z.number()).or(z.boolean()).describe('The data to store. Any JSON-serializable value.'),
    title: z.string().optional().describe('Human-readable title. Defaults to key name.'),
    type: z.enum(['preference', 'api_doc', 'web_page', 'note', 'search_result', 'raw']).optional().describe('Document type for categorization.'),
    tags: z.array(z.string()).optional().describe('Tags for filtering and search.'),
    importance: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('How important this is. "critical" = never deleted. "low" = deletable after 24h. Default: "normal".'),
    namespace: z.string().optional().describe('Namespace for agent isolation (e.g., "pi", "opencode"). Default: "default".'),
    expiresInSeconds: z.number().optional().describe('TTL in seconds. Data auto-deletes after this time.'),
  },
  async (args) => {
    const doc = store({
      key: args.key,
      data: args.data,
      title: args.title,
      type: args.type as DocType | undefined,
      tags: args.tags,
      importance: args.importance as any,
      namespace: args.namespace,
      expiresInSeconds: args.expiresInSeconds,
    });
    return {
      content: [{
        type: 'text' as const,
        text: `Stored: key=${doc.key || doc.id} type=${doc.type} importance=${doc.importance} namespace=${doc.namespace} expires=${doc.expires_at || 'never'}`,
      }],
    };
  }
);

// ─── local7_retrieve ─────────────────────────────────────────────────────

server.tool(
  'local7_retrieve',
  `Get stored data by exact key or ID. FAST. Use when you know exactly what you're looking for. Returns data in TOON format (token-efficient) by default. Pass format="json" for raw JSON. Retrieval automatically tracks access count for relevance scoring.`,
  {
    key: z.string().describe('The key or id to retrieve.'),
    format: z.enum(['toon', 'json']).optional().default('toon').describe('Output format. TOON uses ~40% fewer tokens.'),
  },
  async (args) => {
    const doc = retrieve(args.key);
    if (!doc) {
      return { content: [{ type: 'text' as const, text: `Not found: ${args.key}` }] };
    }
    const content = args.format === 'json' ? doc.content_json : doc.content_toon;
    return {
      content: [{
        type: 'text' as const,
        text: args.format === 'json' ? content : `\`\`\`toon\n${content}\n\`\`\``,
      }],
    };
  }
);

// ─── local7_search ───────────────────────────────────────────────────────

server.tool(
  'local7_search',
  `Keyword search across stored documents. FAST. Use for exact phrase matching (e.g., "Docker compose", "FastAPI", "preference"). For concept-based search, use local7_semantic_search instead. For best results combining both, use local7_context.`,
  {
    query: z.string().describe('Search keywords. Supports FTS5 syntax.'),
    limit: z.number().optional().default(5).describe('Max results.'),
    type: z.enum(['preference', 'api_doc', 'web_page', 'note', 'search_result', 'raw']).optional().describe('Filter by type.'),
    tags: z.array(z.string()).optional().describe('Filter by tags (matches any).'),
    namespace: z.string().optional().describe('Filter by namespace.'),
  },
  async (args) => {
    const results = searchKeyword(args.query, args.limit, args.type as DocType | undefined, args.tags, args.namespace);
    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No results found.' }] };
    }
    const lines = results.map((r, i) =>
      `${i + 1}. [${r.type}] ${r.title} (key: ${r.key || r.id})\n   ${r.snippet}`
    );
    return {
      content: [{
        type: 'text' as const,
        text: `Found ${results.length} results:\n\n${lines.join('\n\n')}\n\nUse local7_retrieve with the key to get full data.`,
      }],
    };
  }
);

// ─── local7_semantic_search ──────────────────────────────────────────────

server.tool(
  'local7_semantic_search',
  `Find documents by MEANING, not keywords. Use when exact phrase matching fails or you need conceptually similar results. Examples: "container networking" finds Docker networking docs even if they say "pod connectivity"; "user preferences" finds theme settings even if stored as "dark mode preference". Set minScore higher (0.7+) for strict matching, lower (0.3+) for broad exploration.`,
  {
    query: z.string().describe('Natural language query. Describe what you\'re looking for.'),
    limit: z.number().optional().default(5).describe('Max results.'),
    type: z.enum(['preference', 'api_doc', 'web_page', 'note', 'search_result', 'raw']).optional().describe('Filter by type.'),
    namespace: z.string().optional().describe('Filter by namespace.'),
    minScore: z.number().optional().default(0.5).describe('Minimum similarity (0-1). 0.3=broad, 0.5=balanced, 0.7=strict.'),
  },
  async (args) => {
    const results = await semanticSearch(args.query, args.limit, {
      type: args.type as DocType | undefined,
      namespace: args.namespace,
      minScore: args.minScore,
    });
    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No semantically similar documents found.' }] };
    }
    const lines = results.map((r, i) =>
      `${i + 1}. [${r.type}] "${r.title}" (score: ${r.score.toFixed(3)})\n   Key: ${r.key || r.id}`
    );
    return {
      content: [{
        type: 'text' as const,
        text: `Found ${results.length} similar documents:\n\n${lines.join('\n\n')}\n\nUse local7_retrieve with the key for full content.`,
      }],
    };
  }
);

// ─── local7_context ──────────────────────────────────────────────────────

server.tool(
  'local7_context',
  `BEST for general retrieval. Combines keyword and semantic search for optimal results. Use this as your DEFAULT search when you don't know exactly what you're looking for. Returns results ranked by combined score.`,
  {
    query: z.string().describe('Search query. Works with both keywords and natural language.'),
    limit: z.number().optional().default(5).describe('Max results.'),
    type: z.enum(['preference', 'api_doc', 'web_page', 'note', 'search_result', 'raw']).optional().describe('Filter by type.'),
    namespace: z.string().optional().describe('Filter by namespace.'),
  },
  async (args) => {
    const results = await hybridSearch(args.query, args.limit, {
      type: args.type as DocType | undefined,
      namespace: args.namespace,
    });
    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No results found.' }] };
    }
    const lines = results.map((r, i) =>
      `${i + 1}. [${r.type}] "${r.title}" (combined: ${r.score.toFixed(3)}, semantic: ${r.semanticScore.toFixed(2)}, keyword: ${r.keywordScore.toFixed(2)})\n   Key: ${r.key || r.id}`
    );
    return {
      content: [{
        type: 'text' as const,
        text: `Found ${results.length} results:\n\n${lines.join('\n\n')}\n\nUse local7_retrieve with the key for full content.`,
      }],
    };
  }
);

// ─── local7_boost ────────────────────────────────────────────────────────

server.tool(
  'local7_boost',
  `Increase the importance score of a document. Important documents persist longer in memory and rank higher in consolidation. Use when the user says "this is important" or "remember this" or when you frequently retrieve the same document.`,
  {
    key: z.string().describe('Key or ID of the document.'),
    importance: z.enum(['low', 'normal', 'high', 'critical']).describe('New importance level.'),
  },
  async (args) => {
    const db = getDb();
    const score = IMPORTANCE_MAP[args.importance];
    const result = db.prepare('UPDATE documents SET importance = ? WHERE key = ? OR id = ?').run(score, args.key, args.key);
    if (result.changes === 0) {
      return { content: [{ type: 'text' as const, text: `Not found: ${args.key}` }] };
    }
    return {
      content: [{
        type: 'text' as const,
        text: `Boosted "${args.key}" to ${args.importance} (${score})`,
      }],
    };
  }
);

// ─── local7_summarize ────────────────────────────────────────────────────

server.tool(
  'local7_summarize',
  `Get a summary of a stored document without retrieving full content. Useful for quickly understanding long documents. Requires LOCAL7_SUMMARY_PROVIDER env var for LLM-powered summaries; falls back to truncation otherwise.`,
  {
    key: z.string().describe('Key or ID of the document.'),
    maxLength: z.number().optional().default(500).describe('Max summary length in characters.'),
    hierarchical: z.boolean().optional().default(false).describe('Generate section-by-section summary hierarchy.'),
  },
  async (args) => {
    const doc = retrieve(args.key);
    if (!doc) {
      return { content: [{ type: 'text' as const, text: `Not found: ${args.key}` }] };
    }

    if (args.hierarchical) {
      const result = await createHierarchicalSummary(doc.content_text, doc.title);
      return {
        content: [{
          type: 'text' as const,
          text: `# Summary of "${doc.title}"\n\n## Overall\n${result.fullSummary}\n\n${result.sectionSummaries.map(s => `### ${s.heading}\n${s.summary}`).join('\n\n')}`,
        }],
      };
    }

    const summary = await summarizeText(doc.content_text, args.maxLength);
    return {
      content: [{
        type: 'text' as const,
        text: `Summary of "${doc.title}":\n\n${summary}`,
      }],
    };
  }
);

// ─── local7_consolidate ──────────────────────────────────────────────────

server.tool(
  'local7_consolidate',
  `Clean up stale and low-importance memories. Low-importance old items are deleted. Mid-importance old items are summarized. High-importance items are always kept. Use dryRun=true to preview without making changes.`,
  {
    dryRun: z.boolean().optional().default(false).describe('Preview without making changes.'),
  },
  async (args) => {
    if (args.dryRun) {
      const db = getDb();
      const stale = db.prepare(`SELECT COUNT(*) as count FROM documents WHERE created_at < datetime('now', '-24 hours') AND importance < 0.3 AND importance < 0.8`).get() as { count: number };
      const consolidatable = db.prepare(`SELECT COUNT(*) as count FROM documents WHERE created_at < datetime('now', '-168 hours') AND importance >= 0.3 AND importance < 0.8`).get() as { count: number };
      const permanent = db.prepare(`SELECT COUNT(*) as count FROM documents WHERE importance >= 0.8`).get() as { count: number };

      return {
        content: [{
          type: 'text' as const,
          text: `Consolidation preview:\n- Would delete: ${stale.count} stale low-importance items\n- Would consolidate: ${consolidatable.count} mid-importance items\n- Would keep: ${permanent.count} high-importance items`,
        }],
      };
    }

    const result = await consolidateMemory();
    return {
      content: [{
        type: 'text' as const,
        text: `Consolidation complete:\n- Deleted: ${result.deleted} stale items\n- Consolidated: ${result.consolidated} mid-importance items\n- Kept: ${result.kept} high-importance items\n- Orphaned chunks: ${result.orphanedChunks}${result.errors.length > 0 ? `\n- Errors: ${result.errors.slice(0, 5).join('; ')}` : ''}`,
      }],
    };
  }
);

// ─── local7_ingest ───────────────────────────────────────────────────────

server.tool(
  'local7_ingest',
  `Fetch a web page, extract its main content (stripping navigation, ads, boilerplate), and store it. Ideal for API documentation, blog posts, and reference material. Auto-chunks long content for better semantic search.`,
  {
    url: z.string().describe('URL to fetch and ingest.'),
    key: z.string().optional().describe('Storage key. Defaults to domain-based key.'),
    type: z.enum(['api_doc', 'web_page', 'note', 'search_result', 'raw']).optional().default('web_page').describe('Document type.'),
    tags: z.array(z.string()).optional().describe('Tags.'),
    importance: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('Importance level.'),
    namespace: z.string().optional().describe('Namespace.'),
    expiresInSeconds: z.number().optional().describe('TTL for the ingested data.'),
  },
  async (args) => {
    const result = await ingestUrl(args.url);
    const parsed = JSON.parse(result.content);
    const docKey = args.key || new URL(args.url).hostname.replace(/\./g, '_') + '_' + Date.now();

    const doc = store({
      key: docKey,
      data: parsed,
      title: result.title,
      type: args.type as DocType,
      tags: args.tags,
      importance: args.importance as any,
      namespace: args.namespace,
      sourceUrl: args.url,
      expiresInSeconds: args.expiresInSeconds,
    });

    const preview = result.textContent.slice(0, 500);
    return {
      content: [{
        type: 'text' as const,
        text: `Ingested: "${result.title}"\nSource: ${args.url}\nKey: ${docKey}\nLength: ${result.textContent.length} chars\n\nPreview:\n${preview}${result.textContent.length > 500 ? '...' : ''}\n\nUse local7_retrieve with key "${docKey}" for full content.`,
      }],
    };
  }
);

// ─── local7_list ─────────────────────────────────────────────────────────

server.tool(
  'local7_list',
  `List stored documents with filters. Use this to see what's in memory, browse by type, or check namespace contents.`,
  {
    type: z.enum(['preference', 'api_doc', 'web_page', 'note', 'search_result', 'raw']).optional().describe('Filter by type.'),
    tags: z.array(z.string()).optional().describe('Filter by tags.'),
    namespace: z.string().optional().describe('Filter by namespace.'),
  },
  async (args) => {
    const results = list(args.type as DocType | undefined, args.tags, args.namespace);
    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No documents found.' }] };
    }
    const lines = results.map((r, i) => {
      const tagStr = r.tags.length > 0 ? ` [${r.tags.join(', ')}]` : '';
      const expires = r.expires_at ? ` expires:${r.expires_at}` : '';
      return `${i + 1}. ${r.key || r.id} | ${r.type}${tagStr} | "${r.title}"${expires}`;
    });
    return {
      content: [{
        type: 'text' as const,
        text: `${results.length} documents:\n${lines.join('\n')}`,
      }],
    };
  }
);

// ─── local7_delete ───────────────────────────────────────────────────────

server.tool(
  'local7_delete',
  `Delete a stored document by key or ID. Also deletes associated vectors and chunked children.`,
  {
    key: z.string().describe('Key or id to delete.'),
  },
  async (args) => {
    const deleted = remove(args.key);
    return {
      content: [{
        type: 'text' as const,
        text: deleted ? `Deleted: ${args.key}` : `Not found: ${args.key}`,
      }],
    };
  }
);

// ─── local7_cleanup ──────────────────────────────────────────────────────

server.tool(
  'local7_cleanup',
  `Remove all expired documents. Does NOT run consolidation — use local7_consolidate for that.`,
  {},
  async () => {
    const count = cleanup();
    return {
      content: [{
        type: 'text' as const,
        text: `Cleaned up ${count} expired documents.`,
      }],
    };
  }
);

// ─── Start server ─────────────────────────────────────────────────────────

async function main() {
  getDb();
  cleanup();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on('SIGINT', () => { closeDb(); process.exit(0); });
  process.on('SIGTERM', () => { closeDb(); process.exit(0); });
}

main().catch((err) => {
  console.error('Local7 MCP server error:', err);
  process.exit(1);
});