# memex — Claude Code plugin

Bundled with [memex](https://github.com/dungdamquoc1993/memex). Lets Claude Code drive the memex CLI, navigate your memory base, query it via qmd, and compile a `USER.md` profile usable in agent harnesses like [openclaw](https://github.com/affaan-m/openclaw).

## Interaction model — no slash commands

This plugin deliberately ships **no slash commands**. Skills auto-activate on natural language, and two agents handle the heavy orchestration. Just talk to Claude:

- "sync memex" / "đồng bộ memex" → loads `memex-sync`, walks you through paste-script + download for browser sources, runs automatic sources alone.
- "tôi đã từng hỏi về X chưa" / "find my chat about X" → loads `memex-memory` + `qmd`, delegates to the `memex-memory-navigator` agent, returns cited evidence.
- "build my profile" / "xây dựng profile cho tôi" → loads `memex-profile` + `qmd`, delegates to the `memex-profile-builder` agent, writes `<workdir>/wiki/USER.md`.

No commands to memorize. The skills' descriptions are the interface.

## What's inside

### Skills (auto-activated by description)

| Skill | Purpose |
|---|---|
| `memex-sync` | Drive the memex CLI to scrape and sync. Knows which sources are automatic vs browser-based, and orchestrates the turn-by-turn guidance for manual paste+download steps. |
| `memex-memory` | Navigate `<workdir>/` — directory layout, YAML frontmatter schema, catalog.jsonl, sync.db, what qmd indexes vs ignores, and how to pick qmd vs `memex search` vs Grep vs Read. |
| `memex-profile` | Build a `USER.md` profile from accumulated memory — theme discovery, evidence citation, openclaw-compatible output shape. |
| `qmd` | Native qmd skill (MIT, by `@tobilu`) — install detection, MCP setup, hybrid query grammar (`lex:` / `vec:` / `hyde:` / `intent:`), all commands. Loaded on demand by `memex-memory` and `memex-profile`. |

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
- [qmd](https://www.npmjs.com/package/@tobilu/qmd) — recommended. The `qmd` skill handles install detection and MCP setup on first use. CLI install: `npm install -g @tobilu/qmd`
- Bun >= 1.3 on PATH (memex's runtime)

Check manually (the skills will also check):

```bash
memex --help
qmd --help
memex config get workdir
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
→ Claude loads memex-memory + qmd, delegates to memex-memory-navigator,
  returns cited conversations.

You: "build my user profile from everything"
→ Claude loads memex-profile + qmd, delegates to memex-profile-builder,
  runs theme discovery, writes <workdir>/wiki/USER.md with evidence,
  offers to symlink into ~/.openclaw/workspace/USER.md.
```

## What Claude Code will and will not do

**Will:**
- Run `memex sync`, `memex search`, `memex status`, `memex config`
- Run `qmd query`, `qmd search`, `qmd get`, `qmd update`, `qmd embed` (after loading the `qmd` skill)
- Install qmd if missing (with your confirmation) — `npm install -g @tobilu/qmd`
- Configure qmd as an MCP server in `~/.claude/settings.json` (with your confirmation) per `skills/qmd/references/mcp-setup.md`
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

MIT — matches memex. The bundled `qmd` skill is MIT-licensed by `@tobilu`.
