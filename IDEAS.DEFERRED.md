# Deferred Web-Search Ideas

Status: Inactive. Do not read or act on this file unless the user explicitly asks to revisit deferred work.

This file keeps non-current ideas out of research, planning, implementation, and routine handoffs. Its contents are not implied scope, recommendations, or action items. Agents must not raise them during ordinary work on `pi-web-search`.

## Deferred areas

- Persistent or cross-process caches, including `XDG_CACHE_HOME` storage, disk spillover, locking, cleanup, and retained browsing history.
- Cross-process search throttling or coordination between Pi and subagent processes.
- Optional article-oriented extraction modes such as Defuddle-backed `readable` mode.
- Browser-backed or service-backed document backends, including Crawl4AI and Firecrawl integration.
- Alternative external extractors and converters such as Trafilatura, Pandoc, Lynx, and W3M.
- Additional search-backend candidates beyond SearXNG and `ddgr`.
- Tool-level page-summary convenience or any model invocation hidden inside retrieval tools.
- Hosted extraction services, automated crawling, multi-page site indexing, and persistent search history.

## Preserved rationale

These ideas were deferred because they add deployment weight, privacy or retention concerns, locking and cleanup requirements, browser or Python dependencies, hidden model cost, or scope beyond the immediate search-correctness and deterministic document-extraction workflow.

The active implementation deliberately uses process-local bounded caches, process-local throttling, deterministic Node extraction, explicit subagent orchestration when available, and only the approved SearXNG and PATH-resolved `ddgr` search backends.

## Reconsideration rule

Only revisit an item when the user names it or explicitly asks to review deferred ideas. At that point, research that item afresh rather than assuming the historical idea is still suitable.
