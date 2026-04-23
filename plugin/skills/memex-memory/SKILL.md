---
name: memex-memory
description: Navigate the memex memory base to answer recall questions from the user's AI chat history. Covers directory layout, YAML frontmatter schema, catalog.jsonl, sync.db, and how to pick the right retrieval ladder (`memex search`, targeted Grep, optional external qmd). Load when the user asks to find, read, or recall anything from past conversations — "what did I talk to AI about X", "tôi đã từng hỏi về X chưa", "find the conversation where I decided Y", "show my chats from last month about Z".
allowed-tools: Bash(memex:*), Bash(qmd:*), Bash(jq:*), Bash(wc:*), Bash(ls:*), Bash(du:*), Read, Grep, Glob
---

# memex-memory

Understand and navigate the `<workdir>/` tree so you can answer recall questions without wasting tokens. This skill must work on its own in Codex or Claude Code. When a repo-local `memex-memory-navigator` agent exists, prefer delegating fuzzy recall to it; otherwise execute the same retrieval ladder directly here.

## Resolve the workdir first

Always resolve before doing file work:

```bash
WORKDIR="$(memex config get workdir)"
```

Priority chain: `--workdir` CLI flag → `MEMEX_WORKDIR` env → `workdir` in `~/.memex/config.json` → default `~/.memex`.

## Directory layout

```text
<workdir>/
├── memory/
│   ├── <source>/YYYY/MM/<id>.md
│   ├── raw/<source>/
│   ├── attachments/
│   ├── catalog.jsonl
│   └── index.md
├── wiki/
│   ├── domains/
│   ├── references/
│   ├── profile.md
│   └── index.md
└── scripts/

~/.memex/
├── state/sync.db
├── logs/sync.log
└── config.json
```

`memory/` is effectively immutable output from memex. `wiki/` is the editable zone. Never write into `memory/` manually.

## Conversation file shape

Every conversation Markdown file has YAML frontmatter plus timestamped message sections:

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
```

Sources: `chatgpt`, `claude_web` (alias `claude`), `gemini`, `claude_code`, `codex`, `openclaw`, `grok`, `deepseek`.

## Indexes you should use before reading raw files

### `<workdir>/memory/catalog.jsonl`

Fast metadata scan. Good for source, date, model, title, and count filtering.

```bash
jq 'select(.source=="chatgpt" and (.title | test("sourdough"; "i")))' "$WORKDIR/memory/catalog.jsonl" | head -40
```

### `memex search --json`

Prefer this for structured filters:

```bash
memex search --source chatgpt --since 2026-01-01 --search "sourdough" --limit 20 --json
```

Important: `memex search --search` matches **title substring only**. It does not scan message bodies.

### `~/.memex/state/sync.db`

Useful for debugging sync state, but use `memex search` or `memex status` before touching SQLite directly.

## Retrieval ladder

Choose the cheapest path that can still answer the question.

| Question shape | Primary tool | Why |
|---|---|---|
| Source/date/model/title filters | `memex search --json` | Uses indexed metadata; no body scan |
| Exact phrase or error string | `Grep` or `rg` over `$WORKDIR/memory/**/*.md` | Literal body match |
| "Show conversation #id" | `Glob` + `Read` | Direct fetch |
| Browsing a month or source | `Glob` / `ls` on `memory/<source>/YYYY/MM/` | Path already encodes time |
| Fuzzy or semantic recall | qmd if installed; otherwise layered fallback below | Best recall with bounded cost |

## How to handle fuzzy recall without helper agents

Preferred path when available:

1. If the host can spawn `memex-memory-navigator`, delegate the fuzzy recall question to it with the current constraints and expected citation style.
2. If that helper is unavailable, do the retrieval directly in this skill using the ladder below.

Do the retrieval directly in this skill:

1. Resolve likely scope first.
   - If the user names a source, date range, model, or project, narrow with `memex search --json`.
   - If they provide a distinctive noun phrase, check titles first with `memex search --search`.
2. If qmd is installed and collections are ready, use it.
   - Confirm with `command -v qmd`.
   - Use `qmd collection list` only if you need to verify the memex collection exists.
   - Prefer `qmd query` or `qmd search` over broad Markdown reads.
3. If qmd is absent, combine metadata narrowing with targeted Grep.
   - Filter likely conversations or months from `catalog.jsonl`.
   - Grep only likely source/date slices instead of the whole archive when possible.
4. Read only the top candidate conversations you need to answer.
5. Cite the exact conversation ids, dates, and file paths you used.

Do not block on helper availability. The skill itself owns the retrieval ladder and must be able to complete the task directly.

## External query engine: qmd

[qmd](https://www.npmjs.com/package/@tobilu/qmd) is the recommended semantic search engine for this memory base, but it is external. If it is not already installed, degrade to `memex search` + targeted Grep. Offer installation help only if the user explicitly asks.

Typical commands:

```bash
qmd collection list
qmd query "<question>"
qmd search "<phrase>"
qmd get "#<id>"
```

## Common tasks

### Find a half-remembered conversation

1. Try `memex search --json` with any source/date/title hints.
2. If the question is semantic, try qmd if available.
3. Fall back to `Grep` for exact phrases or identifiers.
4. Read only final candidates and summarize with evidence.

### Count conversations per source

```bash
memex status
```

### List recent activity for a source

```bash
ls -t "$WORKDIR/memory/chatgpt/2026/04/" | head -10
```

Or:

```bash
jq -r 'select(.source=="chatgpt") | [.updated_at, .id, .title] | @tsv' "$WORKDIR/memory/catalog.jsonl" \
  | sort -r | head -20
```

### Read a specific conversation

Resolve the `.md` path via `Glob`, then `Read` it. If qmd is installed and the user gives an id, `qmd get "#<id>"` can be cheaper.

## Guardrails

- Never scan every conversation file unless the archive is tiny and the user explicitly wants exhaustive reading.
- Never write to `memory/`, `memory/raw/`, or `~/.memex/state/`.
- Prefer catalog, status, and targeted filters before body-level search.
- When confidence is low, say so and show the best evidence you found.
