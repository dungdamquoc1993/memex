---
name: memex-memory
description: Navigate the memex memory base to answer recall questions from the user's AI chat history. Covers directory layout, YAML frontmatter schema, catalog.jsonl, sync.db, and how to pick the right retrieval tool (`memex search`, Grep, optional external qmd). Load when the user asks to find/read/recall anything from past conversations — "what did I talk to AI about X", "tôi đã từng hỏi về X chưa", "find the conversation where I decided Y", "show my chats from last month about Z". For fuzzy/semantic recall questions, delegate to the `memex-memory-navigator` agent (it is self-sufficient and picks the best retrieval path).
allowed-tools: Bash(memex:*), Bash(qmd:*), Bash(jq:*), Bash(wc:*), Bash(ls:*), Bash(du:*), Read, Grep, Glob
---

# memex-memory

Understand and navigate the `<workdir>/` tree so you can answer "what did I talk to AI about X" questions without wasting tokens.

## Resolving the workdir

**Always** resolve first — it is configurable:

```bash
WORKDIR="$(memex config get workdir)"
```

Priority chain (memex respects this internally): `--workdir` CLI flag → `MEMEX_WORKDIR` env → `workdir` in `~/.memex/config.json` → default `~/.memex`.

## Directory layout

```
<workdir>/
├── memory/                             # written by memex, do not edit
│   ├── <source>/YYYY/MM/<id>.md        # one file per conversation
│   ├── raw/<source>/                   # original JSON exports (NOT indexed)
│   ├── attachments/                    # binaries (NOT indexed)
│   ├── catalog.jsonl                   # one JSON object per line, all convs
│   └── index.md                        # human-readable catalog grouped by source+month
├── wiki/                               # editable by user and agent
│   ├── domains/                        # knowledge notes
│   ├── references/                     # raw refs (NOT indexed)
│   ├── profile.md                      # LLM-compiled personal context
│   └── index.md                        # wiki catalog
└── scripts/                            # generated browser export snippets

~/.memex/                               # profile root — fixed, do not edit
├── state/sync.db                       # SQLite; conversations + sync_state tables
├── logs/sync.log
└── config.json                         # workdir pointer
```

## Conversation file schema

Every conversation `.md` has YAML frontmatter, then `## [timestamp] role` section headings per message:

```markdown
---
id: "chatgpt_abc123"
source: "chatgpt"
title: "My conversation title"
model: "gpt-4o"
project: null
created_at: "2026-04-10T03:15:00.000Z"
updated_at: "2026-04-13T09:22:00.000Z"
message_count: 24
original_url: "https://chatgpt.com/c/abc123"
---

## [2026-04-10 03:15:00] user

Message content...

## [2026-04-10 03:15:42] assistant (gpt-4o)

### Thinking
(reasoning if present)

### Response
Response content...
```

Section headings at each message boundary give downstream indexers (e.g. qmd) a clean chunk boundary.

### Sources

`chatgpt`, `claude_web` (alias `claude`), `gemini`, `claude_code`, `codex`, `openclaw`, `grok`, `deepseek`.

### IDs

Format: `<source>_<platform_id>`. The platform id is the provider's original conversation id. Referencing conversations: `#<id>` (qmd supports `qmd get "#<id>"`).

## Index files you can use

### `<workdir>/memory/catalog.jsonl`

One JSON object per line, regenerated at end of every sync with indexing enabled. Good for quick filtering without reading every `.md` file. May not exist if the user hasn't synced with indexing yet — check before relying on it.

```bash
# Example: last 20 chatgpt conversations about "sourdough"
jq 'select(.source=="chatgpt" and (.title | test("sourdough"; "i")))' "$WORKDIR/memory/catalog.jsonl" | head -40
```

### `<workdir>/memory/index.md`

Human-readable table of contents grouped by `source/YYYY/MM`. Good for showing the user a browsable overview.

### `~/.memex/state/sync.db`

SQLite with two tables:

```sql
CREATE TABLE sync_state (
  source TEXT, conversation_id TEXT, content_hash TEXT, last_synced_at TEXT,
  PRIMARY KEY (source, conversation_id)
);
CREATE TABLE conversations (  -- incremental upsert during sync
  -- id, source, title, model, created_at, updated_at, message_count, etc.
);
```

Use `memex search` rather than raw sqlite when you can — it handles the query shape and JSON output:

```bash
memex search --source chatgpt --since 2026-01-01 --search "sourdough" --limit 20 --json
```

## Choosing the right query tool

| Question shape | Tool | Why |
|---|---|---|
| Fuzzy / semantic recall ("what have I discussed about X", "when I decided Y") | **Delegate to `memex-memory-navigator` agent** | Agent handles the full retrieval ladder (qmd MCP → qmd CLI → `memex search` → Grep) and cites evidence |
| Exact string lookup ("find 'npm ERR! ENOSPC'") | `Grep` over `$WORKDIR/memory/` or `qmd search` if installed | BM25 / literal match is precise |
| By metadata (source, date range, model, title substring) | `memex search --json` | Uses the conversations table; no text scan |
| "Show conversation #abc123" | Read the `.md` file directly (resolve path via Glob) or `qmd get "#abc123"` if installed | Direct fetch |
| Browse by time period | `<workdir>/memory/<source>/YYYY/MM/` via Glob | Path encodes the time axis |
| Global stats (counts, last sync) | `memex status` | Reads sync.db |

**Important** — `memex search --search "X"` only matches `title` (case-insensitive substring on the conversations table). It does NOT scan message bodies. For content-level search, use Grep or qmd.

**Decision rule for Claude:** if the user asks a fuzzy semantic question, spawn the `memex-memory-navigator` agent — do not do semantic retrieval from this skill. If they give exact strings or structured filters, use `memex search` / Grep directly here. Never Read every `.md` file — the base can have thousands of files.

### External query engine: qmd (optional)

[qmd](https://www.npmjs.com/package/@tobilu/qmd) is the recommended semantic search engine for this memory base, but it is **external** — not bundled with this plugin. If you need fuzzy recall and qmd is not installed, the `memex-memory-navigator` agent degrades gracefully to `memex search` + Grep. Offer install only if the user explicitly asks:

```bash
npm install -g @tobilu/qmd
qmd collection add "$WORKDIR/memory" --name memex     # or per-source collections
qmd embed
```

Collection convention when registered (confirm via `qmd collection list` — do not assume): `{source}-{year}` (e.g., `chatgpt-2026`, `claude_code-2026`).

## What gets indexed for search (qmd or otherwise)

Only `.md` files under these paths are meaningful to search:
- `<workdir>/memory/<source>/**/*.md`
- `<workdir>/wiki/**/*.md`

Not indexed / skipped by convention:
- `memory/raw/` (JSON exports)
- `memory/attachments/` (binaries)
- `wiki/references/` (raw refs)
- `~/.memex/` entirely (profile root)

If the user asks "why isn't X in search" — check if it lives under an ignored path.

## Common memory tasks

### Find a specific conversation you half-remember

Spawn the `memex-memory-navigator` agent — it walks the full ladder (qmd MCP/CLI → `memex search` → Grep) and cites evidence. Don't try to reimplement that retrieval logic here.

For very narrow lookups you can skip the agent:

1. Title keyword: `memex search --search "<keyword>" --json`
2. Time window browse: `ls "$WORKDIR/memory/<source>/YYYY/MM/"`
3. Exact phrase in body: `Grep "<phrase>" -r "$WORKDIR/memory/" --glob "*.md"`

### Count conversations per source

```bash
memex status
```

### List recent activity for a source

```bash
ls -t "$WORKDIR/memory/chatgpt/2026/04/" | head -10
```

Or via catalog:

```bash
jq -r 'select(.source=="chatgpt") | [.updated_at, .id, .title] | @tsv' "$WORKDIR/memory/catalog.jsonl" \
  | sort -r | head -20
```

### Read a conversation

Use Read on the resolved `.md` path. If the file is large and qmd is installed, `qmd get "#<id>"` will slice it for you.

## Guardrails

- `memory/` is immutable to memex's convention. Do not write to it manually.
- `memory/raw/` is append-only; do not edit or delete unless debugging.
- `state/` is internal. Do not touch `sync.db` directly unless the user explicitly asks.
- `wiki/` is the user/agent-editable zone — put compiled artifacts like `profile.md`, `USER.md`, domain notes here.
