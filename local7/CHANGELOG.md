# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-18

### Added

- **Token reduction proof**: Comprehensive benchmark showing 36.7% average token reduction across 8 use cases, with up to 59.2% for tabular data
- **Real examples**: `example.md` with live format comparisons, tool usage traces, and model compatibility results
- **Model compatibility testing**: Verified tool-calling support with deepseek/deepseek-chat (5/5 tests passed)

### Changed

- Updated README with real benchmark numbers and tested examples
- Version bump to 1.1.0

## [1.0.0] - 2026-04-17

### Added

- Initial release
- 7 MCP tools: store, retrieve, search, ingest, list, delete, cleanup
- SQLite + FTS5 full-text search
- TOON format serialization for token-efficient retrieval
- Web page ingestion with Readability extraction
- TTL expiration with automatic cleanup
- CLI interface for direct usage
- Document type categorization (preference, api_doc, web_page, note, search_result, raw)
