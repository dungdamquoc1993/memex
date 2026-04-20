---
name: memex-sync
description: Drive the memex CLI to scrape and sync AI chat history into the memory base, and walk the user through the manual steps only they can do (paste browser snippet + click download). Load when the user wants to pull/refresh/update chat history from any AI platform — ChatGPT, Claude.ai, Gemini, Grok, DeepSeek (browser-assisted) or Claude Code / Codex / OpenClaw (fully automatic). Trigger phrases include "sync memex", "update memory", "pull my chats", "scrape chatgpt/claude/gemini/grok/deepseek", "đồng bộ memex", "cập nhật chat history", "lấy chat từ X", or any mention of `memex sync` / `memex sync-script`. Also activate proactively before answering any recall/profile question when `memex status` shows the relevant source is stale (>24h).
allowed-tools: Bash(memex:*), Bash(qmd:*), Bash(mv:*), Bash(ls:*), Bash(command:*)
---

# memex-sync

Drive the `memex` CLI to keep the user's memory base fresh. The user owns two manual steps you cannot do: (1) pasting browser snippets into DevTools, and (2) clicking the browser download that the snippet produces. Everything else you can orchestrate.

## Interactive flow (read this first)

For browser-based sources, the conversation is a turn-by-turn dance. Use this exact pattern — it's what the user expects.

**Turn 1 — you:** run `memex sync-script <source>`, print the output, and say (in the user's language):

> "Đây là snippet cho `<source>`. Vui lòng:
> 1. Mở `<URL>` trong tab đã đăng nhập
> 2. DevTools (F12) → Console
> 3. Dán snippet trên → Enter
> 4. Đợi file tải về (`~/Downloads/`)
> 5. Báo tôi khi xong."

(or the English equivalent if they use English).

**Turn 2 — user:** "done" / "xong" / similar.

**Turn 3 — you:** move the downloaded file + run sync + report counts:

```bash
WORKDIR="$(memex config get workdir)"
mv ~/Downloads/<source>_*.json "$WORKDIR/memory/raw/<source>/"
memex sync <source>
```

If `mv` finds nothing, ask — the download may not have landed, or the filename pattern is different. Don't guess.

## When to activate

- User says: "sync memex", "update memory", "pull my chats", "sync claude_code", etc.
- User asks about memex CLI commands or the sync pipeline.
- You need fresh memory before answering a recall question (`/memex-recall`, `/memex-profile`) and the last sync is stale (>1 day).

## The two sync modes

| Source | Mode | Manual step? |
|---|---|---|
| `claude_code` | Automatic — reads `~/.claude/projects/**/*.jsonl` | No |
| `codex` | Automatic — reads `~/.codex/` | No |
| `openclaw` | Automatic — reads session files | No |
| `chatgpt` | Browser script → JSON file in Downloads | **Yes** — user must paste + download |
| `claude_web` (alias `claude`) | Browser script → JSON | **Yes** |
| `gemini` | Browser script → JSON | **Yes** |
| `grok` | Browser script → JSON | **Yes** |
| `deepseek` | Browser script → JSON | **Yes** |

## Full sync workflow

### Step 1 — decide scope

- `memex sync` syncs everything configured.
- `memex sync <source>` syncs one source.
- `memex sync --dry-run` previews without writing.

Ask the user which sources they want. If they say "everything", still split automatic from browser-based — automatic you can do alone, browser requires their action.

### Step 2 — automatic sources (no user action)

```bash
memex sync claude_code
memex sync codex
memex sync openclaw
```

These are idempotent (content-hash dedup). Safe to run any time.

### Step 3 — browser-based sources

For each web source the user asked for, run `sync-script` to print the snippet pre-filled with `SINCE_DATE`:

```bash
memex sync-script chatgpt
memex sync-script claude
memex sync-script gemini
memex sync-script grok
memex sync-script deepseek
```

Then **show the output** to the user and tell them exactly:

1. Open `<platform URL>` in a logged-in browser tab
2. DevTools (F12) → Console tab
3. Paste the snippet → Enter
4. Wait for the download to finish (file lands in `~/Downloads/`)
5. Tell you when done

When they say done, move the file to the raw directory and run sync:

```bash
# Example for chatgpt
WORKDIR="$(memex config get workdir)"
mv ~/Downloads/chatgpt_*.json "$WORKDIR/memory/raw/chatgpt/"
memex sync chatgpt
```

If multiple files exist, move them all (glob pattern handles it).

### Step 4 — verify

```bash
memex status
```

Compare the "Last Sync" timestamps against expectations. Report to the user which sources advanced and which didn't.

## Important rules

- **Never paste browser snippets yourself.** The browser script runs inside the user's authenticated session; you have no access. State this plainly if they ask you to.
- **Never download chat history files.** The platform's download API only works from the logged-in browser.
- **Check for the workdir before file ops.** Always resolve via `memex config get workdir` — never hard-code `~/.memex` because the user may have set a custom workdir (e.g. Dropbox, iCloud, a git repo).
- **Incremental by default.** Don't use `--rebuild-index` unless the user explicitly asks; it rebuilds the catalog from all `.md` files which takes time.
- **`--no-index` is rarely useful.** Skip only if the user is debugging indexing or chaining multiple syncs.

## After sync — what changes on disk

```
<workdir>/memory/<source>/YYYY/MM/<id>.md   # new/updated conversations
<workdir>/memory/catalog.jsonl               # regenerated at end of sync
~/.memex/state/sync.db                       # hash + conversation tables
~/.memex/logs/sync.log                       # appended
```

If the user had qmd collections registered, sync writes new `.md` files but does **not** call `qmd update`. If they want search to see the new content, suggest running `qmd update` after sync (see `qmd-query` skill).

## Error recovery

- **"workdir not initialized"** → run `memex init` (ask first about workdir path).
- **"adapter failed on <source>"** → check `~/.memex/logs/sync.log`. Often a raw JSON file is malformed or missing. Do not delete the raw file; move it aside.
- **Unexpected files in `memory/raw/<source>/`** → probably a previous download that didn't get synced. Offer to run `memex sync <source>` against it rather than deleting.

## Reference — every CLI flag

```
memex init [--workdir <path>]
memex sync [source] [--dry-run] [--no-index] [--rebuild-index]
memex search [--source X] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--model X]
             [--project X] [--search text] [--limit N] [--json]
memex status
memex sync-script <source> [path]
memex export [file]
memex verify <file>
memex import <file> [--replace] [--workdir <path>]
memex config get|set|list|path [key] [val]

Global flag on every command:
  --workdir <path>    Override workdir (flag > MEMEX_WORKDIR env > config.json > ~/.memex)
```
