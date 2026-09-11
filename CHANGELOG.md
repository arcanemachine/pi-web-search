# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 2.1.0 - 2026-09-11

### Changed

- When no explicit backend order is configured, automatically add Brave after DuckDuckGo when a Brave API key is available; explicit backend lists remain authoritative and SearXNG remains opt-in.

## 2.0.1 - 2026-09-11

### Fixed

- Use Pi's wildcard optional peer metadata for the coding-agent runtime.

## 2.0.0 - 2026-09-06

### Changed

- Renamed `grep_url_content` to `find_text_in_url_content` so the web-page text search tool is distinct from Pi's local-file tools.

## 1.0.3 - 2026-09-06

### Changed

- Search response bodies are streamed and bounded before parsing, backend results honor requested limits, and failed fallback chains preserve the meaningful primary error with visible retry guidance and backend diagnostics.
- Search and literal-find query schemas now advertise their hard length limits.
- Document-tool failures now show the same retry guidance as search failures.

## 1.0.2 - 2026-09-03

### Changed

- Brave API keys can be configured with `braveApiKey`, with `BRAVE_SEARCH_API_KEY` retained as a lower-priority environment fallback.
- `grep_url_content` guidance now distinguishes web-page text searches from local-file searches.
- Tool call rows now show each tool's full registered name.
- Grep returns ordinary match sets without false truncation, uses numeric offsets for oversized results, and defaults to no surrounding context lines.
- Document output formatting allows complete ordinary multi-match results while retaining byte and pathological-result bounds.

## 1.0.1 - 2026-09-01

### Changed

- DuckDuckGo is now the only default backend; SearXNG and Brave run only when explicitly configured.
- README setup instructions now describe the default backend behavior and optional fallbacks clearly.

## 1.0.0 - 2026-09-01

### Added

- Native DuckDuckGo HTML search with region, safe-search, recency, result limits, and structured errors.
- Optional SearXNG and Brave search backends with ordered fallback.
- Bounded static page reading and literal search through `read_url_content` and `grep_url_content`.
- Optional bounded page summaries through `summarize_url_content`.

### Changed

- Search and document operations use bounded caches, rate limits, cancellation, provenance, and model-visible output limits.
- Search results are returned as structured title, URL, and snippet fields.
- Configuration errors list the supported search backends.

### Removed

- The external DuckDuckGo command and its Python/runtime setup.
