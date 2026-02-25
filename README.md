# pi-search

A pi extension that provides web search and URL loading capabilities.

## Features

- **Web Search**: Query SearXNG for web search results
- **URL Loading**: Fetch and extract text content from any URL

## Requirements

- A running SearXNG instance (default: http://127.0.0.1:8080)
- Set `SEARXNG_URL` environment variable if your instance is at a different URL

## Installation

### Clone & Install

```bash
git clone https://github.com/arcanemachine/pi-search.git
cd pi-search
npm install
pi install /path/to/pi-search
```

Note: `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` are bundled with pi, so they're not installed as dependencies.

## Usage

Once installed, the `search` tool will be available to the pi agent:

- **Search**: `action: "search"`, `input: "your query"`
- **Load URL**: `action: "load"`, `input: "https://example.com"`

## Development

```bash
# Run type checks
npx tsc --noEmit

# Build (if transpilation needed)
tsc
```
