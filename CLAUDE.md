# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Memex is a personal memory base CLI that syncs AI chat conversations from multiple platforms (ChatGPT, Claude.ai, Claude Code, Gemini, Grok, DeepSeek) into a unified, searchable Markdown archive at `~/.memex/`. It integrates with `qmd` for semantic search.

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
memex init                              # Initialize ~/.memex/ directory structure
memex sync [source] [--dry-run]        # Sync one or all sources
memex status                           # Show stats from sync.db + disk usage
memex sync-script <source> [path]      # Generate browser export snippet (injects SINCE_DATE)
memex export [file]                    # Backup profile to .tar.gz
memex verify <file>                    # Validate backup integrity
memex import <file> [--replace]        # Restore backup
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

- **`src/cli/main.ts`** — Entry point; routes all commands
- **`src/cli/sync.ts`** — Orchestrates adapter iteration, markdown writing, and sync.db updates
- **`src/adapters/base.ts`** — Adapter interface: `{ source, sync(): AsyncIterable<Conversation> }`
- **`src/adapters/claude_code.ts`** — Reads `~/.claude/projects/**/*.jsonl` automatically (no browser script needed)
- **`src/adapters/<platform>.ts`** — Web platform adapters read from `~/.memex/memory/raw/`
- **`src/normalize/schema.ts`** — Core TypeScript types: `Conversation`, `Message`, `ContentBlock`
- **`src/normalize/markdown.ts`** — Converts `Conversation` → Markdown with YAML frontmatter
- **`src/profile/state.ts`** — SQLite wrapper (bun:sqlite, WAL mode); tracks content hash per conversation
- **`src/profile/paths.ts`** — Path resolvers for `~/.memex/` subfolders
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

### What qmd indexes vs. ignores

Only `.md` files under `~/.memex/memory/` and `~/.memex/wiki/` are indexed for search. Excluded: `memory/raw/` (JSON exports), `memory/attachments/` (binaries), `wiki/references/` (raw refs).

## Adding a New Adapter

1. Create `src/adapters/<platform>.ts` implementing the `Adapter` interface from `base.ts`
2. Place raw export files in `~/.memex/memory/raw/<platform>/`
3. Register the adapter in `src/cli/sync.ts`
4. If browser-based, add export script to `src/browser-scripts/<platform>.js` (use `SINCE_DATE` for incremental sync)
5. Add source to the `Source` union type in `src/normalize/schema.ts`
