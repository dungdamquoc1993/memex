---
name: memex-memory
description: Navigate the memex memory base to answer recall questions from the user's AI chat history. Covers directory layout, YAML frontmatter schema, catalog.jsonl, sync.db, what qmd indexes vs ignores, and how to pick the right tool (qmd vs `memex search` vs Grep vs Read). Load when the user asks to find/read/recall anything from past conversations — "what did I talk to AI about X", "tôi đã từng hỏi về X chưa", "find the conversation where I decided Y", "show my chats from last month about Z", or any question that requires retrieval from accumulated chat history. Pairs with the bundled `qmd` skill for semantic search — load both together when the question is fuzzy/semantic.
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

Section headings at each message boundary let qmd chunk at the right granularity.

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
| Semantic: "what have I discussed about X", "find conversations where I worried about Y" | `qmd` skill (query/vec/hyde) | Embedding search handles paraphrase |
| Keyword/exact: "find 'npm ERR! ENOSPC' in any conversation" | `qmd` skill (lex) or `Grep` | BM25 / literal match is faster and more precise |
| By metadata (source, date range, model, title substring) | `memex search --json` | Uses the conversations table; no text scan |
| "Show conversation #abc123" | `qmd get "#abc123"` or Read the file | Direct fetch |
| Browse by time period | `<workdir>/memory/<source>/YYYY/MM/` via Glob | Path encodes the time axis |
| Global stats (counts, last sync) | `memex status` | Reads sync.db |

**Decision rule for Claude:** if the user asks a fuzzy semantic question, load the bundled `qmd` skill (see `skills/qmd/SKILL.md`) and use it. If they give exact strings or structured filters, prefer `memex search` or Grep. Never Read every `.md` file — the base can have thousands of files.

### Using qmd (load the qmd skill)

When you need qmd, also load the bundled `qmd` skill — it covers install detection (`qmd status` or fallback to `npm install -g @tobilu/qmd`), MCP setup (preferred) vs CLI, the hybrid query format (`lex` / `vec` / `hyde` / `intent`), and all the commands (`query`, `search`, `vsearch`, `get`, `multi-get`). Treat the `qmd` skill as the source of truth for qmd usage; this skill just tells you *when* to reach for it.

**Preflight before first qmd use in a session:**

```bash
command -v qmd || echo "qmd not installed — see skills/qmd for setup (npm install -g @tobilu/qmd)"
qmd collection list 2>/dev/null | head -5  # confirm collections exist
```

If qmd is missing, tell the user and offer to install (CLI via `npm install -g @tobilu/qmd`, or MCP via the setup block in `skills/qmd/references/mcp-setup.md`). Fall back to `memex search` + Grep until qmd is available.

**Typical memex collection convention** (confirm via `qmd collection list` — do not assume):

```
chatgpt-YYYY, claude_code-YYYY, claude_web-YYYY, codex-YYYY,
gemini-YYYY, grok-YYYY, deepseek-YYYY, openclaw-YYYY
```

One collection per source per year.

## What qmd indexes vs ignores

**Indexed** (`.md` files only):
- `<workdir>/memory/<source>/**/*.md`
- `<workdir>/wiki/**/*.md`

**Ignored:**
- `memory/raw/` (JSON exports)
- `memory/attachments/` (binaries)
- `wiki/references/` (raw refs)
- `~/.memex/` entirely (profile root)

If the user asks "why isn't X in search" — check if it lives under an ignored path.

## Common memory tasks

### Find a specific conversation you half-remember

1. Try `qmd query "<fuzzy description>"` first
2. If that misses, try `memex search --search "<keyword>" --json` with a title keyword
3. Browse `<workdir>/memory/<source>/YYYY/MM/` if you know roughly when

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

Prefer `qmd get "#<id>"` over Read when the file is large — qmd will slice it. Otherwise just Read.

## Guardrails

- `memory/` is immutable to memex's convention. Do not write to it manually.
- `memory/raw/` is append-only; do not edit or delete unless debugging.
- `state/` is internal. Do not touch `sync.db` directly unless the user explicitly asks.
- `wiki/` is the user/agent-editable zone — put compiled artifacts like `profile.md`, `USER.md`, domain notes here.
