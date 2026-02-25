# pi-search

A pi extension that provides web search and URL loading capabilities.

## Features

- **Web Search**: Query SearXNG for web search results
- **URL Loading**: Fetch and extract text content from any URL

## Requirements

- A running SearXNG instance (default: http://127.0.0.1:8080)
- Set `SEARXNG_URL` environment variable if your instance is at a different URL

## Installation

### Via Pi Package (Recommended)

Install as a pi package using the `pi install` command:

```bash
pi install /path/to/pi-search
```

Verify installation:

```bash
pi list
```

To remove later:

```bash
pi remove /path/to/pi-search
```

### First Time Setup (Clone & Install)

If you're cloning the repo for the first time:

```bash
# Clone the repository
git clone https://github.com/arcanemachine/pi-search.git

# Navigate to the project directory
cd pi-search

# Install dependencies
npm install

# Build the extension (if needed)
npm run build

# Install as a pi package
pi install /path/to/pi-search
```

### Manual Installation

Copy or symlink this extension to your pi extensions directory:

```bash
cp -r /path/to/pi-search ~/.pi/agent/extensions/
```

Or use it as a project extension by placing it in `.pi/extensions/` of your project

### Project-wide Installation

To share the extension with your team, add it to project settings (requires `.pi/settings.json` in your project):

```bash
pi install /path/to/pi-search -l
```

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
