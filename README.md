## memex

[![npm version](https://img.shields.io/npm/v/@dungdq3/memex.svg?style=flat)](https://www.npmjs.com/package/@dungdq3/memex)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/dungdamquoc1993/memex/actions/workflows/ci.yml/badge.svg)](https://github.com/dungdamquoc1993/memex/actions/workflows/ci.yml)

**memex** is a CLI tool that aggregates your AI chat history from multiple platforms into a single, searchable Markdown archive. It integrates with [qmd](https://github.com/dungdamquoc1993/qmd) for semantic search and LLM context injection.

```
AI Platforms          memex sync         workdir/               qmd / memex
─────────────    ──────────────────▶    ───────────────    ───────────────────
Claude Code            convert            memory/          qmd search · query
ChatGPT           (normalize to .md)     wiki/            memex search (index)
Claude.ai
Gemini                                  ~/.memex/
Grok                                     state/sync.db
DeepSeek                                 logs/
Codex                                    config.json
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

On each push or PR to `main`, [CI](https://github.com/dungdamquoc1993/memex/actions/workflows/ci.yml) runs `bun install`, `tsc --noEmit`, and `bun run build`.

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
# 1. Initialize profile (default workdir = ~/.memex)
memex init

# Or choose a custom workdir (e.g. Dropbox, iCloud, a git repo)
memex init --workdir ~/Dropbox/memex-data

# 2. Sync Claude Code conversations (fully automatic — reads ~/.claude/projects/)
memex sync claude_code

# 3. For web platforms (ChatGPT, Claude.ai, Gemini, Grok, DeepSeek):
#    Generate the browser script (saved under <workdir>/scripts/ and copied to clipboard)
memex sync-script chatgpt

#    Open chatgpt.com → DevTools (F12) → Console → paste → Enter
#    Move the downloaded JSON into the raw folder, then sync:
mv ~/Downloads/chatgpt_*.json "$(memex config get workdir)/memory/raw/chatgpt/"
memex sync chatgpt

# 4. List or filter conversations (uses the local index in sync.db)
memex search --limit 5

# 5. Check status (paths, per-source counts, disk usage)
memex status

# Optional: environment / profile sanity check
memex doctor
```

**Global options** (all commands): `--workdir <path>`, `-h` / `--help`, `-v` / `--version`, `--debug` (or `MEMEX_DEBUG=1`).

---

## Commands

### `memex init [--workdir <path>]`

Initialize the memex profile. Run once after install.

- Internal state (`state/`, `logs/`, `config.json`) always lives in `~/.memex/`.
- User content (`memory/`, `wiki/`, `scripts/`, `profile/`) goes into the **workdir** — defaults to `~/.memex/` but can be set to any path (Dropbox, iCloud Drive, a git repo, etc.).

```sh
memex init                              # workdir = ~/.memex (default)
memex init --workdir ~/Dropbox/memex   # workdir = ~/Dropbox/memex
```

The chosen workdir is persisted to `~/.memex/config.json` so subsequent commands pick it up automatically.

---

### `memex sync [source] [--dry-run] [--no-index] [--rebuild-index] [--force]`

Sync one or all sources. Sync is **incremental and idempotent** — unchanged conversations are skipped by content hash. With indexing enabled (default), each run refreshes the `conversations` index and `<workdir>/memory/catalog.jsonl`.

```sh
memex sync                     # all sources
memex sync claude_code         # Claude Code only
memex sync chatgpt             # ChatGPT only
memex sync deepseek            # DeepSeek only
memex sync --dry-run           # preview only, no writes
memex sync --no-index          # skip catalog / conversations table update
memex sync --rebuild-index     # rebuild index from existing .md files under memory/
memex sync --force             # re-process every conversation (ignore hash skip)
```

Supported sources: `chatgpt`, `claude_web` (alias: `claude`), `gemini`, `grok`, `deepseek`, `claude_code`, `codex`, `openclaw`

---

### `memex sync-script <source> [dir] [--full]`

Generate a browser console script for a web platform. The script is **written to** `<workdir>/scripts/<source>.js` (or under `[dir]` if you pass a directory) and **copied to the clipboard** when `pbcopy` / `xclip` / `xsel` is available. Variables such as `SINCE_DATE` are injected from your last sync when possible. Use `--full` to ignore sync history and fetch everything.

```sh
memex sync-script chatgpt
memex sync-script claude
memex sync-script gemini
memex sync-script grok
memex sync-script deepseek
memex sync-script chatgpt ~/Desktop              # save script under ~/Desktop
memex sync-script chatgpt --full                 # full export script
```

Browser scripts rely on the browser session (cookies/tokens). No credentials are stored in the repo.

---

### `memex search`

Query the local conversation index (SQLite `conversations` table, populated during sync). Plain-text output includes absolute paths to `.md` files and original URLs when present.

```sh
memex search --search sourdough --limit 10
memex search --source chatgpt,claude_code --since 2026-01-01 --json
memex search --all --source gemini
```

---

### `memex doctor`

Runs Bun version checks, profile/workdir layout, `sync.db` readability, `config.json`, and compares the installed package version to the latest on npm. Exits `1` if any check fails.

```sh
memex doctor
```

---

### `memex status`

Prints per-source conversation counts and last sync time from `sync.db`, resolved profile/workdir paths, folder sizes, markdown and raw file counts, and total disk usage.

```
Source          | Conversations | Last Sync
----------------|---------------|--------------------
chatgpt         |         2479 | 2026-04-14 04:23:32
claude_code     |           17 | 2026-04-14 04:23:08
...
```

*(Example output; your numbers will differ.)*

---

### `memex config <subcommand>`

Read and write `~/.memex/config.json`.

```sh
memex config list                       # print full config
memex config get workdir                # print current workdir path
memex config set workdir ~/new/path     # update workdir pointer (does not move data)
memex config path                       # print path to config.json
```

---

### `memex export [file]`

Back up both the profile root (`~/.memex/`) and the workdir to a single `.tar.gz` archive (requires `tar` on `PATH`).

```sh
memex export                            # ./memex-profile-<timestamp>.tar.gz in cwd
memex export ~/backup/memex.tar.gz      # explicit path
```

---

### `memex verify <file>`

Validate a backup archive without restoring it. Checks that the tar is readable, the manifest is valid, and required directories are present.

```sh
memex verify ~/backup/memex.tar.gz
```

---

### `memex import <file> [--replace] [--workdir <path>]`

Restore a backup. **First-time restore:** `~/.memex` (and the target workdir if separate) must not already exist, **or** pass `--replace` so existing trees are moved aside to `*.backup-<timestamp>` before extraction (nothing is deleted in place).

```sh
# Typical first restore on a clean machine
memex import ~/backup/memex.tar.gz

# Replace an existing profile/workdir (previous dirs renamed aside)
memex import ~/backup/memex.tar.gz --replace

# Restore workdir to a new location (e.g. new machine or different drive)
memex import ~/backup/memex.tar.gz --workdir ~/new/memex-data
```

If the archive's original workdir path is missing or wrong for this machine, use `--workdir` explicitly — memex avoids silently restoring to an unintended location.

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

## Directory Structure

memex separates internal state from user content into two roots:

```
~/.memex/                             # Profile root — always here, internal
├── state/
│   └── sync.db                       # SQLite dedup tracking
├── logs/
│   └── sync.log
└── config.json                       # workdir path + settings

<workdir>/                            # Configurable — default is also ~/.memex
├── memory/                           # Immutable — written by memex only
│   ├── catalog.jsonl                 # Regenerated when sync indexes (all conversations)
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
├── profile/                          # User profile pipeline output (e.g. USER.md); optional
│
└── scripts/                          # Generated browser export snippets (`memex sync-script`)
```

**Workdir resolution order** (highest priority first):
1. `--workdir <path>` CLI flag
2. `MEMEX_WORKDIR` environment variable
3. `workdir` field in `~/.memex/config.json`
4. Default: `~/.memex`

**Rules:**
- **Indexed by qmd:** `.md` under `memory/` (except `raw/` and `attachments/`) and under `wiki/` (except `references/`).
- **`memex search`** uses the SQLite index plus paths under `memory/`; `catalog.jsonl` is convenient for jq pipelines and tooling.
- `memory/raw/` is append-only; do not edit manually.
- `attachments/` and `wiki/references/` are not indexed by qmd.
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
# Register collections (once) — use your actual workdir path
qmd collection add "$(memex config get workdir)/memory" --name memex-memory
qmd collection add "$(memex config get workdir)/wiki" --name memex-wiki

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
2. Place raw exports in `<workdir>/memory/raw/<platform>/`
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
