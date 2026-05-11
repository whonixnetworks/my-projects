<p align="center">
  <img src="https://raw.githubusercontent.com/whonixnetworks/local7/main/assets/local7.png" alt="local7 logo" width="300"/>
</p>

Local, self-hosted, token-efficient context storage for AI agents. A fast alternative to Context7 that runs entirely on your machine — store personal preferences, API documentation, web research, and any structured data. Retrieves data as [TOON](https://github.com/toon-format/toon) format to cut token usage by ~40-60%.

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## Quick Install

```bash
git clone https://github.com/whonixnetworks/local7.git
cd local7
npm install
npm run build
```

<details>
<summary>Connect to Opencode</summary>

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "local7": {
      "type": "local",
      "command": ["node", "/path/to/local7/dist/server.js"],
      "enabled": true
    }
  },
  "tools": {
    "local7_store": true,
    "local7_retrieve": true,
    "local7_search": true,
    "local7_ingest": true,
    "local7_list": true,
    "local7_delete": true,
    "local7_cleanup": true
  }
}
```

Restart Opencode. All 7 tools are now available to your agent.

</details>

<details>
<summary>Connect to Claude Code, OpenWebUI, or any MCP client</summary>

Any MCP-compatible client can connect. Use the stdio transport with:

```
command: node
args: ["/path/to/local7/dist/server.js"]
```

Refer to your client's documentation for MCP server configuration.

</details>

---

## Why Local7?

AI agents need context — personal preferences, API docs, research notes — but current options waste tokens and send data to external servers.

| Problem | Local7 Solution |
|---------|-----------------|
| Context7 is cloud-only, not self-hostable | Everything runs locally, zero external calls |
| JSON responses burn tokens (~40% waste) | Data returned as TOON — ~40-60% fewer tokens |
| No persistent memory across sessions | SQLite storage persists between sessions |
| Raw web pages are noisy (nav, ads, JS) | Readability extraction strips boilerplate |
| Stale cached data accumulates | TTL expiration with automatic cleanup |
| Can't store arbitrary data types | Store anything: objects, arrays, strings, nested structures |

---

## How It Works

```text
Agent ──► MCP Server ──► SQLite + FTS5
               │
               ├── store()     → JSON → TOON (auto-serialize)
               ├── retrieve()  → Return TOON to agent
               ├── search()    → Full-text query across all docs
               ├── ingest()    → Fetch URL → Readability → Store
               └── cleanup()   → Purge expired entries
```

**Storage**: All data lives in `~/.local7/data.db` (SQLite with FTS5 full-text search). No external databases, no Docker, no services to manage.

**Serialization**: When data is stored, it's automatically converted to both JSON (for querying) and TOON (for retrieval). TOON uses tab delimiters and CSV-style tabular arrays to minimize token count.

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `local7_store` | Store any JSON data with optional key, type, tags, and TTL |
| `local7_retrieve` | Get data by key or id (returns TOON or JSON) |
| `local7_search` | Full-text search across all stored documents |
| `local7_ingest` | Fetch a URL, extract main content, store efficiently |
| `local7_list` | List documents, filter by type or tags |
| `local7_delete` | Remove a document by key or id |
| `local7_cleanup` | Purge all expired documents |

---

## Usage Examples

### Remember user details across sessions

```text
User:   I'm based in Sydney, working with Node.js, prefer TypeScript over JavaScript.
        Remember this so you don't have to ask again.

Agent:  → local7_store(key="dev_profile", type="preference", tags=["personal","dev"])
        Stored.

Next session:

User:   Set up a new project for me.
Agent:  → local7_retrieve(key="dev_profile")
        → local7_search(query="TypeScript preference")
        Knows you want TypeScript. Doesn't ask. Gets on with it.
```

Stored as TOON on retrieval:

```toon
location: Sydney
stack: Node.js
language_preference: TypeScript
```

---

### Ingest and query API documentation

```text
User:   I need to use the Ollama API to build a chat tool. Pull the docs.

Agent:  → local7_ingest(
            url="https://github.com/ollama/ollama/blob/main/docs/api.md",
            key="ollama_api",
            type="api_doc",
            tags=["ollama","api","llm"]
          )
          Ingested. 49,000+ chars of API reference stored.

User:   How do I stream a chat completion?

Agent:  → local7_search(query="chat completion streaming")
          → local7_retrieve(key="ollama_api")
          Returns the exact endpoint, parameters, and curl examples.
          All in TOON format. All token-efficient.
```

---

### Cache web research with expiration

```text
User:   Look up the latest Next.js 15 routing changes and save what you find.

Agent:  → Searches web for Next.js 15 routing
        → local7_store(
            key="nextjs15_routing",
            type="search_result",
            tags=["nextjs","routing","react"],
            expiresInSeconds=86400   ← auto-deletes after 24 hours
          )
          Cached for today. Won't clutter storage tomorrow.
```

---

### Build a project knowledge base

```text
User:   Save the project conventions so the team stays consistent.

Agent:  → local7_store(key="project_conventions", type="note", tags=["team","conventions"],
            data={
              branch_naming: "feat/TICKET-description",
              commit_style: "conventional commits",
              test_required: true,
              review_required: true,
              max_pr_lines: 400
            })

Later anyone asks "what's our branch naming convention?":

Agent:  → local7_search(query="branch naming convention")
          Returns instantly from local storage.
```

---

## CLI

```bash
# Store data from stdin or argument
echo '{"stack":"Node.js","location":"Sydney"}' | node dist/cli.js store --key dev_profile --type preference

# Retrieve as TOON (default)
node dist/cli.js get dev_profile

# Retrieve as JSON
node dist/cli.js get dev_profile --json

# Full-text search
node dist/cli.js search "Sydney Node"

# Ingest a web page
node dist/cli.js ingest https://example.com/docs --type api_doc --tags docs,api

# List all stored documents
node dist/cli.js list

# Filter by type
node dist/cli.js list --type preference

# Delete a document
node dist/cli.js delete dev_profile

# Purge expired entries
node dist/cli.js cleanup
```

---

## Document Types

| Type | Purpose | Example |
|------|---------|---------|
| `preference` | User preferences, personal info | Dev environment, location, stack |
| `api_doc` | API documentation | Ollama API, Stripe docs, internal APIs |
| `web_page` | General web content | Blog posts, articles, tutorials |
| `note` | Freeform notes | Project conventions, meeting notes |
| `search_result` | Cached search results | Web research with TTL |
| `raw` | Unclassified data | Anything else |

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL7_DB` | `~/.local7/data.db` | SQLite database path |

---

## Token Savings

TOON format reduces token usage by eliminating repeated keys and using tabular layouts for arrays of uniform objects.

### Real Benchmark Results (8 use cases, 2026-04-17)

| Use Case | JSON chars | TOON chars | Token Reduction |
|----------|-----------|-----------|----------------|
| User Preferences | 204 | 177 | 15.6% |
| API Documentation | 2,232 | 1,745 | 25.0% |
| Project Knowledge Base | 1,076 | 1,061 | 5.8% |
| Search Results Cache | 1,863 | 1,563 | 18.6% |
| Web Page Content | 1,619 | 1,479 | 9.8% |
| Configuration Data | 712 | 705 | 4.4% |
| **50-User Tabular Data** | **7,856** | **3,420** | **59.2%** |
| Env Variables Template | 547 | 509 | 9.0% |
| **TOTAL** | **16,109** | **10,659** | **36.7%** |

> **1,875 tokens saved** across 8 test cases. Tabular data (arrays of objects) sees up to 59.2% reduction.

### Format Comparison Example

```text
JSON (7,856 chars, ~2,510 tokens):
  {"users":[{"id":1,"username":"user_1","email":"user1@example.com","role":"admin"},...]}

TOON (3,420 chars, ~1,024 tokens):
  users[50]{id,username,email,role}:
    1,user_1,user1@example.com,admin
    2,user_2,user2@example.com,editor
    ...

Result: 59.2% fewer tokens for tabular data
```

See [example.md](example.md) for full proof with real format comparisons and model compatibility tests.

---

<details>
<summary>Requirements</summary>

- Node.js 18+
- npm
- No external services, databases, or API keys required

</details>

<details>
<summary>Project Structure</summary>

```text
local7/
├── src/
│   ├── server.ts      # MCP server (7 tools)
│   ├── cli.ts         # CLI interface
│   ├── store.ts       # CRUD operations
│   ├── db.ts          # SQLite schema + migrations
│   ├── ingest.ts      # Web page extraction
│   ├── toon.ts        # TOON serialization
│   └── types.ts       # Type definitions
├── dist/              # Compiled JavaScript
├── package.json
├── tsconfig.json
├── LICENSE
├── CHANGELOG.md
└── README.md
```

</details>

<details>
<summary>Troubleshooting</summary>

**Problem**: MCP server not showing up in Opencode
**Solution**: Restart Opencode. Verify the path in `opencode.json` points to `dist/server.js`.

**Problem**: `better-sqlite3` build fails on install
**Solution**: Ensure you have `build-essential` and `python3` installed: `sudo apt install build-essential python3`

**Problem**: Database permission error
**Solution**: Check `~/.local7/` exists and is writable: `mkdir -p ~/.local7 && chmod 755 ~/.local7`

**Problem**: Web ingestion returns empty content
**Solution**: Some sites block automated requests. Try the URL in a browser first. JavaScript-heavy sites may not extract properly.

</details>

---

## License

MIT License - see [LICENSE](LICENSE) for details.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
