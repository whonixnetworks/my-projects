import { store, retrieve, search, list, remove, cleanup } from './dist/store.js';
import { getDb, closeDb } from './dist/db.js';
import { jsonToToon } from './dist/toon.js';

process.env.LOCAL7_DB = '/tmp/local7_bench.db';

function estimateTokens(text) {
  if (!text) return 0;
  const cl100kRatio = 3.8;
  const charTokens = Math.ceil(text.length / cl100kRatio);
  const whitespaceBonus = (text.match(/\s+/g) || []).length;
  const punctBonus = (text.match(/[{}[\]:,"]/g) || []).length;
  return charTokens + Math.floor(whitespaceBonus * 0.3) + Math.floor(punctBonus * 0.2);
}

function preciseTokenEstimate(text) {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  const specialChars = (text.match(/[^a-zA-Z0-9\s]/g) || []).length;
  const numbers = (text.match(/\d+/g) || []).length;
  return Math.ceil(words * 1.3 + specialChars * 0.5 + numbers * 0.3);
}

const results = [];
let totalJsonChars = 0;
let totalToonChars = 0;
let totalJsonTokens = 0;
let totalToonTokens = 0;

function recordTest(name, jsonData, toonData, category) {
  const jsonChars = typeof jsonData === 'string' ? jsonData.length : JSON.stringify(jsonData).length;
  const toonChars = typeof toonData === 'string' ? toonData.length : 0;
  const jsonStr = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData);
  const toonStr = typeof toonData === 'string' ? toonData : '';

  const jsonTokens = estimateTokens(jsonStr);
  const toonTokens = estimateTokens(toonStr);
  const charReduction = jsonChars > 0 ? ((1 - toonChars / jsonChars) * 100).toFixed(1) : 0;
  const tokenReduction = jsonTokens > 0 ? ((1 - toonTokens / jsonTokens) * 100).toFixed(1) : 0;

  totalJsonChars += jsonChars;
  totalToonChars += toonChars;
  totalJsonTokens += jsonTokens;
  totalToonTokens += toonTokens;

  results.push({
    name,
    category,
    jsonChars,
    toonChars,
    charReduction: parseFloat(charReduction),
    jsonTokens,
    toonTokens,
    tokenReduction: parseFloat(tokenReduction),
    jsonPreview: jsonStr.slice(0, 200),
    toonPreview: toonStr.slice(0, 200),
  });
}

getDb();

console.log('='.repeat(80));
console.log('LOCAL7 COMPREHENSIVE BENCHMARK - ALL USE CASES');
console.log('='.repeat(80));
console.log();

// =====================================================
// USE CASE 1: User Preferences (small object)
// =====================================================
console.log('--- USE CASE 1: User Preferences ---');
const userProfile = {
  location: 'Sydney, Australia',
  stack: 'Node.js',
  language_preference: 'TypeScript',
  editor: 'VS Code',
  theme: 'dark',
  indent_size: 2,
  package_manager: 'pnpm',
  framework: 'Next.js',
  deployment: 'Vercel',
};
const doc1 = store({ key: 'dev_profile', data: userProfile, type: 'preference', tags: ['personal', 'dev'] });
const retrieved1 = retrieve('dev_profile');
recordTest('User Preferences (small object)', retrieved1.content_json, retrieved1.content_toon, 'preference');
console.log(`  Stored & retrieved user profile`);
console.log(`  JSON: ${retrieved1.content_json.length} chars`);
console.log(`  TOON: ${retrieved1.content_toon.length} chars`);

// =====================================================
// USE CASE 2: API Documentation (large structured data)
// =====================================================
console.log('\n--- USE CASE 2: API Documentation ---');
const apiDoc = {
  endpoint: '/api/v1/chat/completions',
  method: 'POST',
  description: 'Creates a model response for the given chat conversation.',
  authentication: {
    type: 'Bearer Token',
    header: 'Authorization: Bearer <token>',
    required: true,
  },
  parameters: [
    { name: 'model', type: 'string', required: true, description: 'ID of the model to use' },
    { name: 'messages', type: 'array', required: true, description: 'List of messages in the conversation' },
    { name: 'temperature', type: 'number', required: false, description: 'Sampling temperature between 0 and 2' },
    { name: 'max_tokens', type: 'integer', required: false, description: 'Maximum number of tokens to generate' },
    { name: 'top_p', type: 'number', required: false, description: 'Nucleus sampling parameter' },
    { name: 'stream', type: 'boolean', required: false, description: 'Whether to stream back partial progress' },
    { name: 'stop', type: 'array', required: false, description: 'Up to 4 sequences where the API will stop generating' },
    { name: 'frequency_penalty', type: 'number', required: false, description: 'Penalize new tokens based on frequency (-2 to 2)' },
  ],
  request_example: {
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello, how are you?' },
    ],
    temperature: 0.7,
  },
  response_example: {
    id: 'chatcmpl-abc123',
    object: 'chat.completion',
    created: 1677858242,
    model: 'gpt-4',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'Hello! I am doing well, thank you for asking.' },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 13, completion_tokens: 12, total_tokens: 25 },
  },
  rate_limits: {
    requests_per_minute: 60,
    tokens_per_minute: 150000,
    requests_per_day: 100000,
  },
  error_codes: [
    { code: 400, message: 'Invalid request body', description: 'The request body is malformed or missing required fields.' },
    { code: 401, message: 'Unauthorized', description: 'Invalid or missing authentication token.' },
    { code: 429, message: 'Rate limit exceeded', description: 'Too many requests. Retry after the time in the header.' },
    { code: 500, message: 'Internal server error', description: 'An unexpected error occurred on the server.' },
    { code: 503, message: 'Service unavailable', description: 'The server is temporarily overloaded.' },
  ],
};
const doc2 = store({ key: 'chat_api_docs', data: apiDoc, type: 'api_doc', tags: ['api', 'openai', 'chat'] });
const retrieved2 = retrieve('chat_api_docs');
recordTest('API Documentation (large structured)', retrieved2.content_json, retrieved2.content_toon, 'api_doc');
console.log(`  Stored & retrieved API documentation`);
console.log(`  JSON: ${retrieved2.content_json.length} chars`);
console.log(`  TOON: ${retrieved2.content_toon.length} chars`);

// =====================================================
// USE CASE 3: Project Knowledge Base (nested objects)
// =====================================================
console.log('\n--- USE CASE 3: Project Knowledge Base ---');
const projectKB = {
  project_name: 'local7',
  version: '1.0.0',
  conventions: {
    branch_naming: 'feat/TICKET-description',
    commit_style: 'conventional commits',
    test_required: true,
    review_required: true,
    max_pr_lines: 400,
    lint_before_commit: true,
  },
  tech_stack: {
    language: 'TypeScript',
    runtime: 'Node.js 18+',
    database: 'SQLite (better-sqlite3)',
    serialization: 'TOON format',
    protocol: 'MCP (Model Context Protocol)',
  },
  team: [
    { name: 'Alice Chen', role: 'Lead Developer', timezone: 'UTC+10', specialties: ['backend', 'database'] },
    { name: 'Bob Smith', role: 'Frontend Developer', timezone: 'UTC-5', specialties: ['react', 'css'] },
    { name: 'Carol Wu', role: 'DevOps Engineer', timezone: 'UTC+8', specialties: ['docker', 'ci-cd'] },
    { name: 'Dave Jones', role: 'QA Engineer', timezone: 'UTC+0', specialties: ['testing', 'automation'] },
    { name: 'Eve Brown', role: 'Technical Writer', timezone: 'UTC-8', specialties: ['docs', 'api-reference'] },
  ],
  deployment: {
    environments: ['development', 'staging', 'production'],
    ci_provider: 'GitHub Actions',
    cd_strategy: 'blue-green',
    monitoring: 'Prometheus + Grafana',
  },
};
const doc3 = store({ key: 'project_kb', data: projectKB, type: 'note', tags: ['team', 'conventions', 'project'] });
const retrieved3 = retrieve('project_kb');
recordTest('Project Knowledge Base (nested)', retrieved3.content_json, retrieved3.content_toon, 'note');
console.log(`  Stored & retrieved project knowledge base`);
console.log(`  JSON: ${retrieved3.content_json.length} chars`);
console.log(`  TOON: ${retrieved3.content_toon.length} chars`);

// =====================================================
// USE CASE 4: Search Results Cache (array of uniform objects)
// =====================================================
console.log('\n--- USE CASE 4: Search Results Cache ---');
const searchResults = {
  query: 'Next.js 15 routing changes',
  timestamp: '2025-01-15T10:30:00Z',
  results: [
    { title: 'App Router Fundamentals', url: 'https://nextjs.org/docs/app/building-your-application/routing', relevance: 0.98, snippet: 'The App Router is a new routing paradigm built on React Server Components.' },
    { title: 'Migration from Pages Router', url: 'https://nextjs.org/docs/app/building-your-application/upgrading', relevance: 0.95, snippet: 'How to incrementally migrate from the Pages Router to the App Router.' },
    { title: 'Dynamic Routes and Layouts', url: 'https://nextjs.org/docs/app/building-your-application/routing/dynamic-routes', relevance: 0.92, snippet: 'Dynamic routes allow you to match URLs with dynamic segments.' },
    { title: 'Loading UI and Streaming', url: 'https://nextjs.org/docs/app/building-your-application/routing/loading-ui', relevance: 0.88, snippet: 'Built on Suspense, instant loading states improve user experience.' },
    { title: 'Route Groups and Parallel Routes', url: 'https://nextjs.org/docs/app/building-your-application/routing/route-groups', relevance: 0.85, snippet: 'Organize routes without affecting the URL path structure.' },
    { title: 'Intercepting Routes', url: 'https://nextjs.org/docs/app/building-your-application/routing/intercepting-routes', relevance: 0.82, snippet: 'Load routes from other parts of your application within the current layout.' },
    { title: 'Middleware in Next.js 15', url: 'https://nextjs.org/docs/app/building-your-application/routing/middleware', relevance: 0.80, snippet: 'Run code before a request is completed for authentication and redirects.' },
    { title: 'Internationalization Routing', url: 'https://nextjs.org/docs/app/building-your-application/routing/internationalization', relevance: 0.75, snippet: 'Built-in support for i18n routing with dynamic locale segments.' },
  ],
  total_results: 8,
  search_engine: 'brave',
};
const doc4 = store({ key: 'nextjs15_routing', data: searchResults, type: 'search_result', tags: ['nextjs', 'routing', 'react'], expiresInSeconds: 86400 });
const retrieved4 = retrieve('nextjs15_routing');
recordTest('Search Results Cache (uniform array)', retrieved4.content_json, retrieved4.content_toon, 'search_result');
console.log(`  Stored & retrieved search results with TTL`);
console.log(`  JSON: ${retrieved4.content_json.length} chars`);
console.log(`  TOON: ${retrieved4.content_toon.length} chars`);

// =====================================================
// USE CASE 5: Web Page Content (flat text-heavy)
// =====================================================
console.log('\n--- USE CASE 5: Web Page Content ---');
const webPage = {
  title: 'Understanding SQLite FTS5 Full-Text Search',
  url: 'https://www.sqlite.org/fts5.html',
  sections: [
    { heading: 'Overview', content: 'FTS5 is an SQLite virtual table module that provides full-text search functionality. It allows applications to efficiently search for documents containing specific words or phrases, even across very large datasets.' },
    { heading: 'Creating FTS5 Tables', content: 'To create an FTS5 table, use CREATE VIRTUAL TABLE ... USING fts5(column1, column2, ...). Each column in an FTS5 table is a text column that can be searched. Additional columns can be added for non-indexed data.' },
    { heading: 'Query Syntax', content: 'FTS5 supports a rich query syntax including AND, OR, NOT operators, phrase queries in double quotes, NEAR queries, and column filters. The MATCH operator is used to filter results.' },
    { heading: 'Ranking', content: 'By default, FTS5 ranks results using bm25(). You can customize ranking by providing a rank function or by using the rank column in ORDER BY clauses for weighted results.' },
    { heading: 'Performance', content: 'FTS5 is highly optimized for search performance. It uses an inverted index structure that allows O(1) lookups for terms. For large datasets, consider using the merge option to control index segment merging.' },
    { heading: 'Triggers and Sync', content: 'Content sync triggers automatically keep the FTS index in sync with the content table. Using content= and content_rowid= allows FTS5 to index an existing table without duplicating data.' },
  ],
  author: 'SQLite Documentation Team',
  last_updated: '2024-12-01',
  word_count: 850,
  read_time_minutes: 4,
};
const doc5 = store({ key: 'sqlite_fts5_article', data: webPage, type: 'web_page', tags: ['sqlite', 'database', 'search'] });
const retrieved5 = retrieve('sqlite_fts5_article');
recordTest('Web Page Content (text-heavy)', retrieved5.content_json, retrieved5.content_toon, 'web_page');
console.log(`  Stored & retrieved web page content`);
console.log(`  JSON: ${retrieved5.content_json.length} chars`);
console.log(`  TOON: ${retrieved5.content_toon.length} chars`);

// =====================================================
// USE CASE 6: Configuration / Raw Data (mixed types)
// =====================================================
console.log('\n--- USE CASE 6: Configuration Data ---');
const configData = {
  server: {
    host: '0.0.0.0',
    port: 3000,
    workers: 4,
    timeout: 30000,
    keep_alive: true,
    max_connections: 1000,
  },
  database: {
    host: 'localhost',
    port: 5432,
    name: 'production',
    pool_size: 20,
    ssl: true,
    ssl_cert: '/etc/ssl/certs/db.pem',
    retry_attempts: 3,
    retry_delay_ms: 1000,
  },
  cache: {
    driver: 'redis',
    host: 'localhost',
    port: 6379,
    ttl: 3600,
    prefix: 'app:',
    compression: true,
  },
  logging: {
    level: 'info',
    format: 'json',
    outputs: ['stdout', 'file', 'syslog'],
    file_path: '/var/log/app.log',
    rotation: 'daily',
    max_size_mb: 100,
  },
  features: {
    dark_mode: true,
    notifications: true,
    analytics: false,
    rate_limiting: true,
    cors_enabled: true,
    allowed_origins: ['https://app.example.com', 'https://admin.example.com'],
  },
};
const doc6 = store({ key: 'app_config', data: configData, type: 'raw', tags: ['config', 'production'] });
const retrieved6 = retrieve('app_config');
recordTest('Configuration Data (mixed types)', retrieved6.content_json, retrieved6.content_toon, 'raw');
console.log(`  Stored & retrieved configuration data`);
console.log(`  JSON: ${retrieved6.content_json.length} chars`);
console.log(`  TOON: ${retrieved6.content_toon.length} chars`);

// =====================================================
// USE CASE 7: Large Table Data (tabular - TOON excels)
// =====================================================
console.log('\n--- USE CASE 7: Large Tabular Data (TOON optimal) ---');
const users = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  username: `user_${i + 1}`,
  email: `user${i + 1}@example.com`,
  role: ['admin', 'editor', 'viewer'][i % 3],
  department: ['engineering', 'marketing', 'sales', 'design', 'support'][i % 5],
  active: i % 7 !== 0,
  login_count: Math.floor(Math.random() * 1000),
  last_login: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString().split('T')[0],
}));
const doc7 = store({ key: 'user_directory', data: { total: 50, users }, type: 'raw', tags: ['users', 'directory'] });
const retrieved7 = retrieve('user_directory');
recordTest('Large Tabular Data (50 users)', retrieved7.content_json, retrieved7.content_toon, 'raw');
console.log(`  Stored & retrieved 50-user directory`);
console.log(`  JSON: ${retrieved7.content_json.length} chars`);
console.log(`  TOON: ${retrieved7.content_toon.length} chars`);

// =====================================================
// USE CASE 8: Environment Variables / Secrets Template
// =====================================================
console.log('\n--- USE CASE 8: Env Vars Template ---');
const envTemplate = {
  NODE_ENV: 'production',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/mydb',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'your-secret-key-here',
  JWT_EXPIRY: '24h',
  LOG_LEVEL: 'info',
  CORS_ORIGIN: 'https://example.com',
  RATE_LIMIT_WINDOW_MS: '900000',
  RATE_LIMIT_MAX: '100',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'noreply@example.com',
  S3_BUCKET: 'my-app-assets',
  S3_REGION: 'us-east-1',
  CDN_URL: 'https://cdn.example.com',
  SENTRY_DSN: 'https://key@sentry.io/project',
  ANALYTICS_ID: 'UA-XXXXXXXXX',
};
const doc8 = store({ key: 'env_template', data: envTemplate, type: 'note', tags: ['config', 'env', 'template'] });
const retrieved8 = retrieve('env_template');
recordTest('Env Variables Template (flat key-value)', retrieved8.content_json, retrieved8.content_toon, 'note');
console.log(`  Stored & retrieved env template`);
console.log(`  JSON: ${retrieved8.content_json.length} chars`);
console.log(`  TOON: ${retrieved8.content_toon.length} chars`);

// =====================================================
// SEARCH TESTS
// =====================================================
console.log('\n--- SEARCH USE CASES ---');

const search1 = search('TypeScript', 5);
console.log(`  Search "TypeScript": ${search1.length} results`);

const search2 = search('routing', 5);
console.log(`  Search "routing": ${search2.length} results`);

const search3 = search('SQLite FTS5', 3, 'web_page');
console.log(`  Search "SQLite FTS5" (type=web_page): ${search3.length} results`);

const search4 = search('admin OR production', 5);
console.log(`  Search "admin OR production": ${search4.length} results`);

const search5 = search('configuration', 3, undefined, ['config']);
console.log(`  Search "configuration" (tag=config): ${search5.length} results`);

// =====================================================
// LIST TESTS
// =====================================================
console.log('\n--- LIST USE CASES ---');

const listAll = list();
console.log(`  List all: ${listAll.length} documents`);

const listByType = list('preference');
console.log(`  List type=preference: ${listByType.length} documents`);

const listByTag = list(undefined, ['config']);
console.log(`  List tag=config: ${listByTag.length} documents`);

// =====================================================
// DELETE & CLEANUP TESTS
// =====================================================
console.log('\n--- DELETE & CLEANUP ---');

const tempDoc = store({ key: 'temp_data', data: { temp: true }, type: 'raw', expiresInSeconds: 1 });
console.log(`  Stored temp document: ${tempDoc.key}`);

const deleteResult = remove('temp_data');
console.log(`  Deleted temp_data: ${deleteResult}`);

const cleanupResult = cleanup();
console.log(`  Cleanup expired: ${cleanupResult} documents`);

// =====================================================
// FINAL RESULTS
// =====================================================
console.log('\n' + '='.repeat(80));
console.log('TOKEN REDUCTION RESULTS BY USE CASE');
console.log('='.repeat(80));
console.log();
console.log(`${'Use Case'.padEnd(42)} | ${'JSON chars'.padEnd(10)} | ${'TOON chars'.padEnd(10)} | ${'Char Saved'.padEnd(10)} | ${'JSON tok'.padEnd(8)} | ${'TOON tok'.padEnd(8)} | ${'Tok Saved'.padEnd(10)}`);
console.log('-'.repeat(115));

for (const r of results) {
  console.log(
    `${r.name.padEnd(42)} | ${String(r.jsonChars).padEnd(10)} | ${String(r.toonChars).padEnd(10)} | ${(r.charReduction + '%').padEnd(10)} | ${String(r.jsonTokens).padEnd(8)} | ${String(r.toonTokens).padEnd(8)} | ${(r.tokenReduction + '%').padEnd(10)}`
  );
}

console.log('-'.repeat(115));
const totalCharReduction = ((1 - totalToonChars / totalJsonChars) * 100).toFixed(1);
const totalTokenReduction = ((1 - totalToonTokens / totalJsonTokens) * 100).toFixed(1);
console.log(
  `${'TOTAL'.padEnd(42)} | ${String(totalJsonChars).padEnd(10)} | ${String(totalToonChars).padEnd(10)} | ${(totalCharReduction + '%').padEnd(10)} | ${String(totalJsonTokens).padEnd(8)} | ${String(totalToonTokens).padEnd(8)} | ${(totalTokenReduction + '%').padEnd(10)}`
);

console.log();
console.log(`Overall Character Reduction: ${totalCharReduction}%`);
console.log(`Overall Token Reduction:    ${totalTokenReduction}%`);
console.log(`Tokens Saved (estimated):   ${totalJsonTokens - totalToonTokens}`);
console.log();

// =====================================================
// DETAILED FORMAT COMPARISONS
// =====================================================
console.log('='.repeat(80));
console.log('DETAILED FORMAT COMPARISONS (JSON vs TOON)');
console.log('='.repeat(80));

const detailedExamples = [
  { name: 'User Preferences (small)', json: retrieved1.content_json, toon: retrieved1.content_toon },
  { name: 'API Doc (tabular arrays)', json: retrieved2.content_json, toon: retrieved2.content_toon },
  { name: '50-User Directory (tabular)', json: retrieved7.content_json, toon: retrieved7.content_toon },
];

for (const ex of detailedExamples) {
  console.log(`\n### ${ex.name} ###\n`);
  console.log(`JSON (${ex.json.length} chars, ~${estimateTokens(ex.json)} tokens):`);
  console.log(ex.json.slice(0, 500));
  if (ex.json.length > 500) console.log(`... (${ex.json.length - 500} more chars)`);
  console.log();
  console.log(`TOON (${ex.toon.length} chars, ~${estimateTokens(ex.toon)} tokens):`);
  console.log(ex.toon.slice(0, 500));
  if (ex.toon.length > 500) console.log(`... (${ex.toon.length - 500} more chars)`);
}

closeDb();

// Output machine-readable JSON
const report = {
  timestamp: new Date().toISOString(),
  tests: results.map(r => ({
    name: r.name,
    category: r.category,
    json_chars: r.jsonChars,
    toon_chars: r.toonChars,
    char_reduction_pct: r.charReduction,
    json_tokens_est: r.jsonTokens,
    toon_tokens_est: r.toonTokens,
    token_reduction_pct: r.tokenReduction,
  })),
  totals: {
    json_chars: totalJsonChars,
    toon_chars: totalToonChars,
    char_reduction_pct: parseFloat(totalCharReduction),
    json_tokens: totalJsonTokens,
    toon_tokens: totalToonTokens,
    token_reduction_pct: parseFloat(totalTokenReduction),
    tokens_saved: totalJsonTokens - totalToonTokens,
  },
  search_tests: {
    typescript_results: search1.length,
    routing_results: search2.length,
    filtered_type_results: search3.length,
    boolean_results: search4.length,
    tag_filtered_results: search5.length,
  },
  list_tests: {
    all: listAll.length,
    by_type: listByType.length,
    by_tag: listByTag.length,
  },
};

import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/local7_benchmark_report.json', JSON.stringify(report, null, 2));
console.log('\n\nBenchmark report saved to /tmp/local7_benchmark_report.json');
