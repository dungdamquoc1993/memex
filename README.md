# memex

[![npm version](https://img.shields.io/npm/v/@dungdq3/memex.svg?style=flat)](https://www.npmjs.com/package/@dungdq3/memex)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/dungdamquoc1993/memex/actions/workflows/ci.yml/badge.svg)](https://github.com/dungdamquoc1993/memex/actions/workflows/ci.yml)

**memex** is a CLI tool that aggregates your AI chat history from multiple platforms into a single, searchable Markdown archive at `~/.memex/`. It integrates with [qmd](https://github.com/dungdamquoc1993/qmd) for semantic search and LLM context injection.

```
AI Platforms          memex sync          ~/.memex/              qmd
─────────────    ──────────────────▶    ───────────────    ──────────────
Claude Code            convert            memory/          qmd search
ChatGPT           (normalize to .md)     wiki/            qmd query
Claude.ai                                state/sync.db
Gemini
Grok
DeepSeek
Codex
OpenClaw
```

---

## Install

**Requirement:** [Bun](https://bun.sh) >= 1.3 must be available in `PATH`.

`memex` is distributed through the npm registry. You can install it with either npm or Bun.

### Install from npm registry

Using npm:

```sh
npm install -g @dungdq3/memex
memex --help
```

Using Bun:

```sh
bun add -g @dungdq3/memex
memex --help
```

Both commands install the published package from the npm registry. The CLI itself still runs with Bun because `bin/memex` uses `#!/usr/bin/env bun`.

### Local development install

Use `bun link` when you want the global `memex` command to run directly from your local checkout:

```sh
git clone https://github.com/dungdamquoc1993/memex.git
cd memex
bun install
bun link
memex --help
```

With `bun link`, edits in the repo affect the global `memex` command immediately.

### Check where `memex` is coming from

Use these commands whenever you are not sure whether `memex` is coming from npm, Bun, or a local link:

```sh
which -a memex
ls -l "$(which memex)"
realpath "$(which memex)"
```

Common results:

```text
/usr/local/bin/memex
```

Usually means npm global from the system npm. Confirm with:

```sh
ls -l /usr/local/bin/memex
/usr/local/bin/npm list -g --depth=0 @dungdq3/memex
```

```text
/Users/<you>/.nvm/versions/node/<version>/bin/memex
```

Means npm global from the active nvm Node/npm. Confirm with:

```sh
which npm
npm prefix -g
npm list -g --depth=0 @dungdq3/memex
```

```text
/Users/<you>/.bun/bin/memex
```

Means Bun global or a Bun local link. Confirm with:

```sh
ls -l ~/.bun/bin/memex
ls -l ~/.bun/install/global/node_modules
```

If `~/.bun/install/global/node_modules/memex` or `~/.bun/install/global/node_modules/@dungdq3/memex` points to your local checkout, you are using a local `bun link`.

### Uninstall and clean old links

Remove npm global installs:

```sh
npm uninstall -g @dungdq3/memex
/usr/local/bin/npm uninstall -g @dungdq3/memex
```

Remove Bun global installs:

```sh
bun remove --global @dungdq3/memex
```

Remove a current local Bun link from inside the repo:

```sh
cd memex
bun unlink
```

If you previously linked the package under an old package name, stale symlinks can remain. Remove only the memex symlinks:

```sh
rm -f ~/.bun/bin/memex
rm -f ~/.bun/install/global/node_modules/memex
rm -f ~/.bun/install/global/node_modules/@dungdq3/memex
```

Verify that the command is gone:

```sh
which -a memex
```

---

## Quick Start

```sh
# 1. Initialize ~/.memex/ directory structure (run once)
memex init

# 2. Sync Claude Code conversations (fully automatic — reads ~/.claude/projects/)
memex sync claude_code

# 3. For web platforms (ChatGPT, Claude.ai, Gemini, Grok, DeepSeek):
#    Get the browser snippet pre-filled with your last sync date
memex sync-script chatgpt

#    Open chatgpt.com → DevTools (F12) → Console → paste → Enter
#    Move the downloaded file, then sync:
mv ~/Downloads/chatgpt_*.json ~/.memex/memory/raw/chatgpt/
memex sync chatgpt

# 4. Check status
memex status
```

---

## Commands

### `memex init`

Initialize `~/.memex/` directory structure. Run once after install.

---

### `memex sync [source] [--dry-run]`

Sync one or all sources. Sync is **incremental and idempotent** — unchanged conversations are skipped by content hash.

```sh
memex sync                  # sync all configured sources
memex sync claude_code      # sync Claude Code only
memex sync chatgpt          # sync ChatGPT only
memex sync deepseek         # sync DeepSeek only
memex sync --dry-run        # preview changes, no files written
```

Supported sources: `chatgpt`, `claude_web` (alias: `claude`), `gemini`, `grok`, `deepseek`, `claude_code`, `codex`, `openclaw`

---

### `memex sync-script <source>`

Print a browser console snippet pre-filled with your last sync date for a web platform. Paste the output into the browser's DevTools Console while logged in.

```sh
memex sync-script chatgpt
memex sync-script claude
memex sync-script gemini
memex sync-script grok
memex sync-script deepseek
```

Browser scripts use the browser's own runtime auth (cookies/tokens from the active session). No credentials are hardcoded or exported to disk.

---

### `memex status`

Show sync statistics from `sync.db`.

```
Source          | Conversations | Last Sync
----------------|---------------|--------------------
chatgpt         |         2479 | 2026-04-14 04:23:32
claude_code     |           17 | 2026-04-14 04:23:08
claude_web      |          187 | 2026-04-14 04:23:40
gemini          |          327 | 2026-04-14 04:23:47
grok            |           12 | 2026-04-15 06:38:18
deepseek        |           25 | 2026-04-15 06:57:29
```

---

### `memex export [file]`

Back up the entire `~/.memex/` profile (including `memory/`, `wiki/`, `scripts/`, `state/`, `logs/`) to a `.tar.gz` archive.

```sh
memex export                            # creates ./memex-profile-YYYYMMDD-HHMMSS.tar.gz
memex export ~/backup/memex.tar.gz      # write to specific path
```

---

### `memex verify <file>`

Validate a backup archive without restoring it. Checks that the tar is readable, the manifest is valid, and required directories are present.

```sh
memex verify ~/backup/memex.tar.gz
```

---

### `memex import <file> [--replace]`

Restore a backup. Fails if `~/.memex/` already exists unless `--replace` is passed (moves the existing profile to `~/.memex.backup-YYYYMMDD-HHMMSS` first).

```sh
memex import ~/backup/memex.tar.gz
memex import ~/backup/memex.tar.gz --replace
```

---

## Platform Support

| Platform | Source key | Method | Incremental |
|---|---|---|---|
| Claude Code | `claude_code` | Automatic (reads `~/.claude/projects/`) | Yes |
| ChatGPT | `chatgpt` | Browser script → JSON file | Yes |
| Claude.ai | `claude_web` / `claude` | Browser script → JSON file | Yes |
| Gemini | `gemini` | Browser script (batchexecute API) → JSON file | Yes |
| Grok | `grok` | Browser script (REST API) → JSON file | Yes |
| DeepSeek | `deepseek` | Browser script (runtime token) → JSON file | Yes |
| Codex | `codex` | Automatic (reads `~/.codex/`) | Yes |
| OpenClaw | `openclaw` | Automatic (reads session files) | Yes |

---

## Profile Structure

```
~/.memex/
├── memory/                           # Immutable — written by memex only
│   ├── chatgpt/
│   │   └── 2026/04/<id>.md           # Normalized Markdown
│   ├── claude_web/
│   ├── claude_code/
│   ├── gemini/
│   ├── grok/
│   ├── deepseek/
│   ├── codex/
│   ├── openclaw/
│   ├── raw/                          # Original JSON exports (not indexed)
│   │   ├── chatgpt/
│   │   ├── claude_web/
│   │   ├── gemini/
│   │   ├── grok/
│   │   └── deepseek/
│   └── attachments/                  # Chat attachments (not indexed)
│
├── wiki/                             # Mutable — agent and user editable
│   ├── domains/                      # Knowledge domain notes
│   ├── references/                   # Raw reference files (not indexed)
│   ├── profile.md                    # Personal context — LLM compiled
│   └── index.md                      # Content catalog
│
├── state/
│   └── sync.db                       # SQLite dedup tracking
└── logs/
    └── sync.log
```

**Rules:**
- `memory/` and `wiki/` contain only `.md` files — these are what qmd indexes.
- `memory/raw/` is append-only; do not edit manually.
- `attachments/` and `references/` are not indexed.
- `state/` is internal; do not edit manually.

Each conversation is stored as one `.md` file with YAML frontmatter:

```markdown
---
id: "chatgpt_abc123"
source: "chatgpt"
title: "My conversation title"
model: "gpt-4o"
created_at: "2026-04-10T03:15:00.000Z"
updated_at: "2026-04-13T09:22:00.000Z"
message_count: 24
original_url: "https://chatgpt.com/c/abc123"
---

## [2026-04-10 03:15:00] user

Message content...

## [2026-04-10 03:15:42] assistant (gpt-4o)

### Thinking

(reasoning block if present)

### Response

Response content...
```

`##` headings at each message boundary allow qmd to chunk at the right granularity for search.

---

## qmd Integration

```sh
# Register collections (once)
qmd collection add ~/.memex/memory --name memex-memory
qmd collection add ~/.memex/wiki --name memex-wiki

# Add as LLM context
qmd context add qmd://memex-memory "Personal AI chat history: ChatGPT, Claude, Gemini, Grok, DeepSeek, Claude Code, Codex, OpenClaw"
qmd context add qmd://memex-wiki "Curated personal wiki, domain notes, profile"

# Index and embed
qmd update
qmd embed

# Search
qmd search "sourdough hydration"
qmd query "what have I discussed about sleep"
qmd get "#abc123"
```

---

## Adding an Adapter

Implement the `Adapter` interface and register it in `src/cli/sync.ts`:

```typescript
// src/adapters/myplatform.ts
import type { Adapter } from './base.ts';
import type { Conversation } from '../normalize/schema.ts';

export class MyPlatformAdapter implements Adapter {
  source = 'myplatform' as const;

  async *sync(): AsyncIterable<Conversation> {
    // Read data from the platform
    // yield each Conversation
  }
}
```

Steps:
1. Create `src/adapters/<platform>.ts` implementing `Adapter`
2. Place raw exports in `~/.memex/memory/raw/<platform>/`
3. Register in `src/cli/sync.ts` in the `ADAPTERS` object
4. If browser-based, add `src/browser-scripts/<platform>.js` using `SINCE_DATE` for incremental sync
5. Add the source key to the `Source` union in `src/normalize/schema.ts`

---

## Roadmap

- [ ] `memex ingest <file>` — manually ingest an arbitrary JSON file
- [ ] Attachment handling — copy attachments to `memory/attachments/`
- [ ] `memex watch` — daemon that auto-syncs Claude Code on new sessions
- [ ] MCP server — expose memex as a tool for LLM agents

---

## License

MIT — see [LICENSE](./LICENSE)
