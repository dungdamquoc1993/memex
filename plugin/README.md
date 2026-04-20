# memex — Claude Code plugin

Bundled with [memex](https://github.com/dungdamquoc1993/memex). Lets Claude Code drive the memex CLI, navigate your memory base, and compile a `USER.md` profile usable in agent harnesses like [openclaw](https://github.com/affaan-m/openclaw).

Semantic search is delegated to [qmd](https://www.npmjs.com/package/@tobilu/qmd) when installed — qmd is an **external** recommended dependency, not bundled in this plugin.

## Interaction model — no slash commands

This plugin deliberately ships **no slash commands**. Skills auto-activate on natural language, and two agents handle the heavy orchestration. Just talk to Claude:

- "sync memex" / "đồng bộ memex" → loads `memex-sync`, walks you through paste-script + download for browser sources, runs automatic sources alone.
- "tôi đã từng hỏi về X chưa" / "find my chat about X" → loads `memex-memory`, delegates to the `memex-memory-navigator` agent, returns cited evidence.
- "build my profile" / "xây dựng profile cho tôi" → loads `memex-profile`, delegates to the `memex-profile-builder` agent, writes `<workdir>/wiki/USER.md`.

No commands to memorize. The skills' descriptions are the interface.

## What's inside

### Skills (auto-activated by description)

| Skill | Purpose |
|---|---|
| `memex-sync` | Drive the memex CLI to scrape and sync. Knows which sources are automatic vs browser-based, and orchestrates the turn-by-turn guidance for manual paste+download steps. |
| `memex-memory` | Navigate `<workdir>/` — directory layout, YAML frontmatter schema, catalog.jsonl, sync.db, and how to pick between `memex search`, Grep, and (optional external) qmd. Delegates fuzzy recall to the `memex-memory-navigator` agent. |
| `memex-profile` | Build a `USER.md` profile from accumulated memory — theme discovery, evidence citation, openclaw-compatible output shape. Uses its own deterministic pipeline, not qmd. |

### Agents (delegated to on demand)

| Agent | Purpose |
|---|---|
| `memex-memory-navigator` | Recall-question retrieval — picks the right tool, cites conversation ids with evidence. |
| `memex-profile-builder` | Full profile build pipeline — inventory → theme discovery → draft → backup → write → harness integration. |

## Install

### As a local marketplace (development)

```bash
claude plugin marketplace add /Users/apple/Desktop/personal_data/memex/plugin
claude plugin install memex@memex
```

### Via `/plugins` interactive

```
/plugins
→ Browse marketplaces
→ Add marketplace → path to this directory
→ Install "memex"
```

### As a remote marketplace (once published)

```bash
claude plugin marketplace add https://github.com/dungdamquoc1993/memex
claude plugin install memex@memex
```

## Prerequisites

- [memex CLI](https://github.com/dungdamquoc1993/memex) installed and `memex init` run at least once
- Bun >= 1.3 on PATH (memex's runtime)
- [qmd](https://www.npmjs.com/package/@tobilu/qmd) — **recommended, external**. Improves recall on fuzzy/semantic questions. Install with `npm install -g @tobilu/qmd`, then `qmd collection add "$(memex config get workdir)/memory" --name memex && qmd embed`. Without qmd, the plugin falls back to `memex search` + Grep — still works, just less forgiving on paraphrase.

Check manually:

```bash
memex --help
memex config get workdir
qmd --help              # optional
```

## Typical flow (natural language, no commands)

```
You: "show me memex status"
→ Claude loads memex-memory, runs `memex status`, summarizes.

You: "sync my claude code chats"
→ Claude loads memex-sync, runs `memex sync claude_code`, reports counts.

You: "sync chatgpt too"
→ Claude runs `memex sync-script chatgpt`, shows snippet, tells you
  exactly what to paste in DevTools, waits.
→ You: "done"
→ Claude moves file, runs sync, reports counts.

You: "tôi đã từng nói chuyện gì về sourdough?"
→ Claude loads memex-memory, delegates to memex-memory-navigator,
  returns cited conversations (uses qmd if installed, falls back otherwise).

You: "build my user profile from everything"
→ Claude loads memex-profile, delegates to memex-profile-builder,
  runs theme discovery, writes <workdir>/wiki/USER.md with evidence,
  offers to symlink into ~/.openclaw/workspace/USER.md.
```

## What Claude Code will and will not do

**Will:**
- Run `memex sync`, `memex search`, `memex status`, `memex config`
- Run `qmd query`, `qmd search`, `qmd get` **if qmd is already installed** — never force-installs it
- Move downloaded JSON files from `~/Downloads/` into the raw directory
- Write `<workdir>/wiki/USER.md` (and back up any existing copy)
- Offer to symlink/copy the profile into `~/.openclaw/workspace/`

**Will not:**
- Paste browser console snippets (no access to your authenticated browser)
- Download chat history (platforms only allow this from a logged-in browser)
- Edit anything under `memory/` (immutable by convention)
- Touch openclaw files other than `USER.md`

## Configuration

All skills/agents honor the memex workdir resolution chain:
1. `--workdir <path>` flag
2. `MEMEX_WORKDIR` env var
3. `workdir` in `~/.memex/config.json`
4. Default: `~/.memex`

Nothing hard-codes `~/.memex` — always resolved via `memex config get workdir`.

## Uninstall

```bash
claude plugin uninstall memex
```

The memex CLI, your workdir, and your qmd index are untouched.

## License

MIT — matches memex.
