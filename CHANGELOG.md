# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
