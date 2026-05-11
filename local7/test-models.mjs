#!/usr/bin/env node
import { execSync } from 'child_process';

const API_KEY = process.env.OPENROUTER_API_KEY;
const CLI = 'node dist/cli.js';
const results = [];

function cli(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000 }).trim();
  } catch (e) {
    return `ERROR: ${e.message.split('\n')[0]}`;
  }
}

async function callModel(model, messages, tools) {
  const body = { model, messages };
  if (tools) body.tools = tools;

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/whonixnetworks/local7',
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

function execToolCall(name, args) {
  const argStr = JSON.stringify(args);
  switch (name) {
    case 'local7_store': {
      const dataStr = JSON.stringify(args.data || args).replace(/'/g, "'\\''");
      const cmd = `echo '${dataStr}' | ${CLI} store --key ${args.key || ''} --type ${args.type || 'raw'} ${args.tags ? '--tags ' + args.tags.join(',') : ''} ${args.expiresInSeconds ? '--ttl ' + args.expiresInSeconds : ''}`;
      return cli(cmd);
    }
    case 'local7_retrieve':
      return cli(`${CLI} get ${args.key} ${args.format === 'json' ? '--json' : ''}`);
    case 'local7_search':
      return cli(`${CLI} search "${args.query}" --limit ${args.limit || 5}`);
    case 'local7_list':
      return cli(`${CLI} list ${args.type ? '--type ' + args.type : ''}`);
    case 'local7_delete':
      return cli(`${CLI} delete ${args.key}`);
    case 'local7_cleanup':
      return cli(`${CLI} cleanup`);
    default:
      return `Unknown tool: ${name}`;
  }
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'local7_store',
      description: 'Store data in local7 for later retrieval as TOON format.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Unique key' },
          data: { type: 'object', description: 'Data to store' },
          type: { type: 'string', enum: ['preference', 'api_doc', 'web_page', 'note', 'search_result', 'raw'] },
          tags: { type: 'array', items: { type: 'string' } },
          expiresInSeconds: { type: 'number' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'local7_retrieve',
      description: 'Retrieve stored data by key. Returns TOON format by default.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to retrieve' },
          format: { type: 'string', enum: ['toon', 'json'] },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'local7_search',
      description: 'Full-text search across all stored documents.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'local7_list',
      description: 'List stored documents.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['preference', 'api_doc', 'web_page', 'note', 'search_result', 'raw'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'local7_delete',
      description: 'Delete a document by key.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', description: 'Key to delete' } },
        required: ['key'],
      },
    },
  },
];

async function runTest(model, testName, prompt, expectedTool) {
  const label = `[${model}] ${testName}`;
  console.log(`\n--- ${label} ---`);
  console.log(`Prompt: ${prompt}`);

  try {
    const messages = [{ role: 'user', content: prompt }];
    const data = await callModel(model, messages, TOOLS);
    const choice = data.choices?.[0];
    const toolCalls = choice?.message?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      const text = choice?.message?.content || 'No response';
      console.log(`Model response (no tool call): ${text.slice(0, 200)}`);
      results.push({ model, test: testName, status: 'NO_TOOL_CALL', response: text.slice(0, 300) });
      return;
    }

    for (const tc of toolCalls) {
      const fnName = tc.function.name;
      const fnArgs = JSON.parse(tc.function.arguments);
      console.log(`Tool call: ${fnName}(${JSON.stringify(fnArgs).slice(0, 150)})`);

      const output = execToolCall(fnName, fnArgs);
      console.log(`CLI output: ${output.slice(0, 200)}`);

      const hasError = output.startsWith('ERROR');
      results.push({
        model,
        test: testName,
        status: hasError ? 'ERROR' : 'PASS',
        tool: fnName,
        args: fnArgs,
        output: output.slice(0, 300),
      });
    }
  } catch (err) {
    console.log(`FAILED: ${err.message.slice(0, 200)}`);
    results.push({ model, test: testName, status: 'FAILED', error: err.message.slice(0, 200) });
  }
}

async function main() {
  console.log('=== local7 Free Model Testing ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`DB: ${process.env.HOME}/.local7/data.db\n`);

  cli(`rm -f ${process.env.HOME}/.local7/data.db 2>/dev/null`);

  // Model 1: google/gemma-3-27b-it:free (2 tests)
  console.log('\n============ google/gemma-3-27b-it:free ============');
  await runTest(
    'google/gemma-3-27b-it:free',
    'Store developer profile',
    'Use local7_store to save my developer profile: I am Alice, a senior engineer in Sydney working with TypeScript, Node.js, and React. Use key "dev_profile", type "preference", tags ["personal","dev"].',
    'local7_store'
  );
  await runTest(
    'google/gemma-3-27b-it:free',
    'Retrieve developer profile',
    'Use local7_retrieve to get back the developer profile stored as "dev_profile" in toon format.',
    'local7_retrieve'
  );

  // Model 2: meta-llama/llama-3.3-70b-instruct:free (2 tests)
  console.log('\n============ meta-llama/llama-3.3-70b-instruct:free ============');
  await runTest(
    'meta-llama/llama-3.3-70b-instruct:free',
    'Store project conventions',
    'Use local7_store to save project conventions: branch naming is "feat/TICKET-desc", commit style is "conventional commits", tests are required, max PR size is 400 lines. Use key "project_conv", type "note", tags ["team","conventions"].',
    'local7_store'
  );
  await runTest(
    'meta-llama/llama-3.3-70b-instruct:free',
    'Search for conventions',
    'Use local7_search to search for "branch naming convention" across stored documents.',
    'local7_search'
  );

  // Model 3: qwen/qwen3-next-80b-a3b-instruct:free (2 tests)
  console.log('\n============ qwen/qwen3-next-80b-a3b-instruct:free ============');
  await runTest(
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'List all documents',
    'Use local7_list to show all stored documents.',
    'local7_list'
  );
  await runTest(
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'Store and retrieve API cache',
    'Use local7_store to cache an API reference: key "ollama_api", type "api_doc", tags ["ollama","api"], data should include endpoints for chat completion and model listing. Then use local7_retrieve to get it back in toon format.',
    'local7_store'
  );

  // Model 4: deepseek/deepseek-chat - extensive test (5 tests)
  console.log('\n============ deepseek/deepseek-chat (extensive) ============');
  await runTest(
    'deepseek/deepseek-chat',
    'Store user preferences',
    'Use local7_store to store user preferences: key "user_prefs", type "preference", tags ["personal","settings"]. The data should include: theme "dark", editor "vim", shell "zsh", language "TypeScript".',
    'local7_store'
  );
  await runTest(
    'deepseek/deepseek-chat',
    'Store with TTL',
    'Use local7_store to cache a temporary search result about "React Server Components" with key "react_sc_search", type "search_result", tags ["react","server-components"], expiresInSeconds 3600.',
    'local7_store'
  );
  await runTest(
    'deepseek/deepseek-chat',
    'Search across all data',
    'Use local7_search to search for "TypeScript developer" across all stored documents.',
    'local7_search'
  );
  await runTest(
    'deepseek/deepseek-chat',
    'List preferences only',
    'Use local7_list to list only documents of type "preference".',
    'local7_list'
  );
  await runTest(
    'deepseek/deepseek-chat',
    'Delete temp data and cleanup',
    'Use local7_delete to delete "react_sc_search", then use local7_cleanup to purge expired documents.',
    'local7_delete'
  );

  // Summary
  console.log('\n\n========== TEST SUMMARY ==========');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status !== 'PASS').length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  const byModel = {};
  results.forEach(r => { (byModel[r.model] ||= []).push(r); });
  Object.entries(byModel).forEach(([model, tests]) => {
    const p = tests.filter(t => t.status === 'PASS').length;
    console.log(`  ${model}: ${p}/${tests.length} passed`);
  });

  // Write results to file
  const fs = await import('fs');
  const reportPath = '/home/greedy/devops/local7/test-results.json';
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), results, summary: { total: results.length, passed, failed } }, null, 2));
  console.log(`\nResults saved to ${reportPath}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
