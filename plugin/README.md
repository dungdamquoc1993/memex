# memex — Claude Code + Codex plugin

Bundled with [memex](https://github.com/dungdamquoc1993/memex). This folder now carries both plugin surfaces:

- `plugin/.claude-plugin/` for Claude Code
- `plugin/.codex-plugin/` for Codex

The user-facing workflows stay the same: sync AI chat history into memex, navigate the memory base, and build a `USER.md` profile from accumulated memory.

Semantic search is delegated to [qmd](https://www.npmjs.com/package/@tobilu/qmd) when installed. qmd is an optional external dependency, not bundled in this plugin.

## Interaction model

This plugin deliberately ships **no slash commands**. The interface is natural language:

- "sync memex" / "đồng bộ memex" → load `memex-sync`
- "find my chat about X" / "tôi đã từng hỏi về X chưa" → load `memex-memory`
- "build my profile" / "xây dựng profile cho tôi" → load `memex-profile`

The same three skills are shared across Claude Code and Codex.

## What's inside

### Skills

| Skill | Purpose |
|---|---|
| `memex-sync` | Run `memex sync`, split automatic vs browser-assisted sources, and guide the user through any manual export/download steps. |
| `memex-memory` | Answer recall questions from `<workdir>/memory/` using the right retrieval ladder: `memex search`, targeted Grep, and optional qmd when installed. |
| `memex-profile` | Build or refresh `<workdir>/profile/USER.md` through the resumable summary → extraction → rollup → synthesis pipeline. |

### Helper agents

| Host | Helper location | Purpose |
|---|---|---|
| Claude Code | `plugin/agents/*.md` | Bundled helper agents for recall, summarize, extract, and final profile synthesis. |
| Codex | `/.codex/agents/*.toml` | Repo-local companion agents mirroring the same four roles: recall navigator, summarizer, extractor, and profile builder. |

Current Codex repo-local parity set:

- `memex-memory-navigator`
- `memex-summarizer`
- `memex-extractor`
- `memex-profile-builder`

The shared skills still own the workflow, but when these repo-local Codex agents are present the intended topology now matches Claude Code's four-agent split.

## Install

### Claude Code

Local marketplace:

```bash
claude plugin marketplace add /Users/apple/Desktop/personal_data/memex/plugin
claude plugin install memex@memex
```

Interactive:

```text
/plugins
→ Browse marketplaces
→ Add marketplace → path to this directory
→ Install "memex"
```

Remote marketplace once published:

```bash
claude plugin marketplace add https://github.com/dungdamquoc1993/memex
claude plugin install memex@memex
```

### Codex

Repo marketplace for local development:

```bash
codex plugin marketplace add /Users/apple/Desktop/personal_data/memex
```

Then restart Codex from this repo and open `/plugins`. The repo-local marketplace entry lives at `/.agents/plugins/marketplace.json` and points to `./plugin`.

If you prefer the UI flow, you can skip the CLI command and rely on the repo marketplace directly:

```text
/plugins
→ Browse marketplaces
→ Find "memex local"
→ Install "memex"
```

After changing files under `plugin/`, restart Codex so the installed copy refreshes from the marketplace source.

## Prerequisites

- [memex CLI](https://github.com/dungdamquoc1993/memex) installed and `memex init` run at least once
- Bun >= 1.3 on PATH
- [qmd](https://www.npmjs.com/package/@tobilu/qmd) optional but recommended for fuzzy recall

Check manually:

```bash
memex --help
memex config get workdir
qmd --help              # optional
```

## Typical flow

```text
You: "show me memex status"
→ The host agent loads memex-memory, runs `memex status`, summarizes.

You: "sync my codex chats"
→ The host agent loads memex-sync, runs `memex sync codex`, reports counts.

You: "sync chatgpt too"
→ The host agent runs `memex sync-script chatgpt`, shows the snippet, waits for you to download the export, then moves the file and runs `memex sync chatgpt`.

You: "what did I discuss about sourdough?"
→ The host agent loads memex-memory, uses qmd if available, otherwise falls back to `memex search` + targeted Grep, then cites the matching conversations.

You: "build my user profile from everything"
→ The host agent loads memex-profile, runs the resumable pipeline, writes `<workdir>/profile/USER.md`, and can optionally mirror it into another harness.
```

## What The Skills Will And Will Not Do

**Will:**

- Run `memex sync`, `memex search`, `memex status`, `memex config`
- Run `qmd query`, `qmd search`, `qmd get` if qmd is already installed
- Move downloaded JSON exports from `~/Downloads/` into the raw directory
- Write `<workdir>/profile/USER.md`, `profile/state.json`, and build logs

**Will not:**

- Paste browser console snippets for you
- Trigger a website export/download inside your authenticated browser
- Edit files under `memory/` manually
- Depend on repo-local Codex subagents just to answer basic memex requests

## Configuration

All skills honor the memex workdir resolution chain:

1. `--workdir <path>` flag
2. `MEMEX_WORKDIR` env var
3. `workdir` in `~/.memex/config.json`
4. Default: `~/.memex`

Nothing hard-codes `~/.memex`. Always resolve through `memex config get workdir` or let the CLI resolve it internally.

## Uninstall

Claude Code:

```bash
claude plugin uninstall memex
```

Codex:

- Remove it from `/plugins`, or
- Remove the repo marketplace entry from `/.agents/plugins/marketplace.json`

The memex CLI, workdir, and qmd index stay untouched.

## License

MIT — matches memex.
