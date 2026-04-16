# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Memex is a personal memory base CLI that syncs AI chat conversations from multiple platforms (ChatGPT, Claude.ai, Claude Code, Gemini, Grok, DeepSeek) into a unified, searchable Markdown archive. Internal state always lives in `~/.memex/`; user content (memory, wiki, scripts) lives in a configurable **workdir** (default: `~/.memex`). Integrates with `qmd` for semantic search.

## Commands

```bash
# Development (run without building)
bun src/cli/main.ts <command> [args]

# Build
bun build src/cli/main.ts --outdir dist --target bun

# Install dependencies
bun install

# Link globally as `memex` CLI
bun link
```

**CLI commands:**
```bash
memex init [--workdir <path>]              # Initialize profile; persists workdir to config.json
memex sync [source] [--dry-run] [--no-index] [--rebuild-index]
                                          # Sync one or all sources; indexes by default
                                          # --no-index: skip indexing; --rebuild-index: full rebuild from .md files
memex search [--source X] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--model X] [--project X] [--search text] [--limit N] [--json]
                                          # Query conversations from index
memex status                              # Show stats from sync.db + disk usage
memex sync-script <source> [path]         # Generate browser export snippet (injects SINCE_DATE)
memex export [file]                       # Backup profile root + workdir to .tar.gz
memex verify <file>                       # Validate backup integrity
memex import <file> [--replace] [--workdir <path>]  # Restore backup
memex config get|set|list|path [key] [val]           # Manage ~/.memex/config.json
```

**Global flag** (all commands):
```bash
--workdir <path>    Override workdir for this invocation
                    Priority: flag > MEMEX_WORKDIR env > config.json > ~/.memex
```

Supported sources: `chatgpt`, `claude_web` (alias: `claude`), `gemini`, `claude_code`, `codex`, `openclaw`, `grok`, `deepseek`

## Architecture

### Data Flow

```
AI Platforms ──> Browser scripts (manual export) ──> ~/.memex/memory/raw/
Claude Code   ──> auto-read ~/.claude/projects/**/*.jsonl
                         ↓
              src/adapters/<source>.ts  (parse raw → Conversation[])
                         ↓
              src/normalize/markdown.ts (Conversation → .md)
                         ↓
         ~/.memex/memory/<source>/YYYY/MM/<id>.md
                         ↓
              src/profile/state.ts (hash dedup in sync.db)
                         ↓
              qmd indexes .md files for semantic search
```

### Key Modules

- **`src/cli/main.ts`** — Entry point; parses global `--workdir` flag, calls `initPaths()`, routes commands
- **`src/cli/config.ts`** — `memex config` subcommands; `saveConfig()` used by init and import
- **`src/cli/sync.ts`** — Orchestrates adapter iteration, markdown writing, and sync.db updates
- **`src/adapters/base.ts`** — Adapter interface: `{ source, sync(): AsyncIterable<Conversation> }`
- **`src/adapters/claude_code.ts`** — Reads `~/.claude/projects/**/*.jsonl` automatically (no browser script needed)
- **`src/adapters/<platform>.ts`** — Web platform adapters read from `paths.rawSource(<source>)`
- **`src/normalize/schema.ts`** — Core TypeScript types: `Conversation`, `Message`, `ContentBlock`
- **`src/normalize/markdown.ts`** — Converts `Conversation` → Markdown with YAML frontmatter
- **`src/profile/state.ts`** — SQLite wrapper (bun:sqlite, WAL mode); tracks content hash per conversation
- **`src/profile/paths.ts`** — Two roots: `profileRoot` (`~/.memex`, fixed) and `workdir` (configurable). `resolveWorkdir()` implements the flag → env → config → default chain. `initPaths()` must be called at CLI startup before any other module uses `paths`.
- **`src/browser-scripts/<platform>.js`** — Browser console snippets; `sync-script` command injects SINCE_DATE into these templates

### Conversation Schema (`src/normalize/schema.ts`)

All adapters normalize to this schema before writing:

```typescript
interface Conversation {
  id: string;              // "<source>_<original_id>"
  source: Source;
  title: string;
  model: string | null;
  project: string | null;
  created_at: string;      // ISO 8601
  updated_at: string;
  messages: Message[];
  attachments: Attachment[];
  source_metadata: Record<string, unknown>;
  original_url?: string;
}

interface Message {
  timestamp: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  model?: string;
  content: ContentBlock[];
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }                          // reasoning traces
  | { type: 'tool_use'; name; input; output?; truncated? }     // tool calls (capped at 2000 chars)
  | { type: 'attachment'; kind: 'image'|'file'; name; exists; mime?; ref? }
```

### Sync & Deduplication

State is tracked in `~/.memex/state/sync.db`:
```sql
CREATE TABLE sync_state (
  source TEXT, conversation_id TEXT, content_hash TEXT, last_synced_at TEXT,
  PRIMARY KEY (source, conversation_id)
)
```

`state.checkSync(source, convId, hash)` returns `'skip'` | `'insert'` | `'update'`. Sync is idempotent — unchanged conversations are skipped by hash comparison.

### Index & Catalog

Sync also maintains a `conversations` table in `sync.db` (incremental upsert for each synced conversation) and exports `<workdir>/memory/catalog.jsonl` (one JSON object per line, all conversations). The catalog is regenerated at the end of every sync with indexing enabled. Auto-bootstrap: if the `conversations` table is empty, sync triggers a full rebuild from existing `.md` files.

### What qmd indexes vs. ignores

Only `.md` files under `<workdir>/memory/` and `<workdir>/wiki/` are indexed for search. Excluded: `memory/raw/` (JSON exports), `memory/attachments/` (binaries), `wiki/references/` (raw refs).

## Adding a New Adapter

1. Create `src/adapters/<platform>.ts` implementing the `Adapter` interface from `base.ts`
2. Place raw export files in `paths.rawSource('<platform>')` (= `<workdir>/memory/raw/<platform>/`)
3. Register the adapter in `src/cli/sync.ts`
4. If browser-based, add export script to `src/browser-scripts/<platform>.js` (use `SINCE_DATE` for incremental sync)
5. Add source to the `Source` union type in `src/normalize/schema.ts`
