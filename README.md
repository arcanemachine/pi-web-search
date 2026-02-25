# pi-search

A pi extension that provides web search and URL loading capabilities.

## Features

- **Web Search**: Query SearXNG for web search results
- **URL Loading**: Fetch and extract text content from any URL

## Requirements

- A running SearXNG instance (default: http://127.0.0.1:8080)
- Set `SEARXNG_URL` environment variable if your instance is at a different URL

## Installation

1. Copy or symlink this extension to your pi extensions directory:
   ```bash
   cp -r /path/to/pi-search ~/.pi/agent/extensions/
   ```

2. Or use it as a project extension by placing it in `.pi/extensions/` of your project

3. Restart pi or reload the runtime

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
