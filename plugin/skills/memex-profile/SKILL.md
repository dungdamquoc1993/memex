---
name: memex-profile
description: Build or refresh a USER.md profile from memex data using a 3-layer pipeline (per-conversation summary → batch extraction → deterministic rollup → synthesis). Output is compatible with openclaw-style agent harnesses (drop-in replacement for `~/.openclaw/workspace/USER.md`). Profile lives under a dedicated `<workdir>/profile/` directory with state tracking and full resumability under rate limits. Load when the user asks to "build my profile", "analyze my memory", "figure out who I am from my chats", "xây dựng profile", "phân tích tôi qua memex", "tạo USER.md", "generate user profile for openclaw", or any request to compile personal context from chat history. Pipeline specification is in `PIPELINE.md` in this folder.
allowed-tools: Bash(memex:*), Bash(jq:*), Bash(wc:*), Bash(cp:*), Bash(ls:*), Bash(ln:*), Bash(date:*), Bash(mkdir:*), Bash(shasum:*), Bash(find:*), Bash(stat:*), Bash(sort:*), Bash(xargs:*), Bash(awk:*), Bash(tr:*), Read, Write, Grep, Glob
---

# memex-profile

Turn accumulated memory, wiki notes, and live conversation into a usable user-profile artifact. Output lives under `<workdir>/profile/` and follows a 3-layer pipeline that is deterministic, delta-native, and resumable under rate limits.

**Authoritative pipeline spec**: `PIPELINE.md` in this folder. This skill file tells you *when* and *how* to invoke the pipeline; PIPELINE.md tells you *what each layer does*. If they disagree, PIPELINE.md wins.

## When to activate

- User asks: "build my profile", "analyze who I am", "summarize what I care about", "make a USER.md for openclaw"
- `/memex-profile` is invoked
- `/memex-profile resume` — user wants to continue a paused pipeline run (after rate limit / quota exhaustion)
- After a large sync, if the user wants the profile refreshed

For heavy work, delegate to the `memex-profile-builder` agent (isolates the long pipeline run from the main conversation).

## Pipeline at a glance

```
Layer 1 (haiku, sync-time)     per-convo summary  → memory/summaries/...json
Layer 2 (sonnet, build-time)   10-convo batches   → profile/extracts/batch-NNNN.json
Layer 2.5 (script, no LLM)     dedupe + stats     → profile/aggregate.json
Layer 3 (opus, 1 call)         synthesis + prose  → profile/USER.md
```

- Layer 1 runs during `memex sync` and is cached forever per convo.
- Layer 2 runs during profile build; each batch is cached per input-hash.
- Layer 2.5 is a deterministic rollup (no LLM).
- Layer 3 is a single opus call on the aggregate.

See `PIPELINE.md` for full schemas, prompts, scoring, trajectory rules.

## Profile directory layout

```
<workdir>/profile/
├── USER.md                          # the artifact — what openclaw and agents read
├── state.json                       # source versions + delta pointers
├── aggregate.json                   # Layer 2.5 output (inspectable)
├── extracts/
│   └── batch-NNNN.json              # Layer 2 per-batch extracts
├── logs/
│   ├── build-YYYYMMDD-HHMMSS.md    # human-readable build report
│   ├── pipeline-YYYYMMDD-HHMMSS.log.jsonl  # per-unit progress log
│   └── errors-YYYYMMDD-HHMMSS.jsonl        # per-unit errors
└── backups/
    └── USER.md.YYYYMMDD-HHMMSS
```

Why a dedicated folder (instead of `wiki/`):
- Profile is a *derived artifact* with its own build semantics (delta, state, backups, resumability).
- Intentionally excluded from qmd index — prevents USER.md from dominating semantic search.
- Keeps extracts, aggregate, logs co-located with the artifact they describe.

## Sources & precedence

Profile is built from three sources. When evidence conflicts, trust in this order:

1. **Current conversation** — what the user just stated in this session. Cite as `(stated in session YYYY-MM-DD)`.
2. **Wiki** (`<workdir>/wiki/`) — pre-curated notes. Cite as `wiki:<path>`.
3. **Memory base** (`<workdir>/memory/` + `memory/summaries/`) — source of aggregate patterns. Cite as conversation id links.

**Never source from `profile/` itself or `profile/backups/`** — creates a feedback loop.

Memory is consumed via Layer 1 summaries (not raw .md) for efficiency, but USER.md citations link to the raw .md files (human-browsable).

## The build process

### 1. Freshness check

```bash
memex status
```

If last sync >7d old, ask the user whether to sync first. `memex sync` will auto-run Layer 1 summarization on any new conversations (see PIPELINE.md §Layer 1).

### 2. Delta detection (before doing any expensive work)

```bash
WORKDIR="$(memex config get workdir)"
PROFILE="$WORKDIR/profile"
mkdir -p "$PROFILE/logs" "$PROFILE/backups" "$PROFILE/extracts"

NEW_CONVOS=0
MODE="full"

if [ -f "$PROFILE/state.json" ]; then
  LAST_MAX=$(jq -r '.sources.memory.max_created_at' "$PROFILE/state.json")
  LAST_WIKI_DIGEST=$(jq -r '.sources.wiki.digest' "$PROFILE/state.json")

  NEW_CONVOS=$(jq -r --arg d "$LAST_MAX" 'select(.created_at > $d) | .id' \
    "$WORKDIR/memory/catalog.jsonl" | wc -l | tr -d ' ')

  CURR_WIKI_DIGEST=$(find "$WORKDIR/wiki" -type f -name '*.md' -print0 \
    | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $1}')

  if [ "$NEW_CONVOS" -eq 0 ] && [ "$CURR_WIKI_DIGEST" = "$LAST_WIKI_DIGEST" ]; then
    MODE="skip"
  elif [ "$NEW_CONVOS" -lt 500 ]; then
    MODE="delta"
  fi
fi
```

**Decision rules**:

| Condition | Mode |
|---|---|
| No `state.json` (first run) | **full** |
| User explicitly asks for rebuild | **full** |
| `NEW_CONVOS >= 500` | **full** (re-aggregate, theme decay matters at scale) |
| Nothing changed AND no new session context | **skip** — tell user profile is current |
| Otherwise | **delta** |

### 3. Backfill Layer 1 if needed

Check how many conversations in `memory/` have a matching summary in `memory/summaries/`. If any are missing (e.g. first time using the summarize feature, or sync ran without `--summarize`):

```bash
# Count missing summaries
memex summarize --dry-run    # reports how many convos would be summarized
```

If significant (>50), ask user whether to backfill now. Backfilling 3000 convos ≈ $3, ~10 minutes — tell them the cost up front.

```bash
memex summarize              # runs Layer 1 on everything missing
memex summarize --since 2026-04-01    # only recent
```

### 4. Layer 2 — batch extraction

Orchestrator delegates to the extract script. The script reads summaries, buckets chronologically, runs sonnet on un-cached batches, writes per-batch JSONs.

```bash
# Invoked via the orchestrator agent — see memex-profile-builder.md
# Full mode: extract all batches (cache-respecting, won't redo completed ones)
# Delta mode: only trailing batches containing new summaries
```

On rate limit: script pauses gracefully, writes progress to `pipeline-*.log.jsonl`, exits with code 75. User resumes with `/memex-profile resume`.

### 5. Layer 2.5 — deterministic rollup

No LLM. Pure data transform on all batch JSONs → `aggregate.json`.

Always run (cheap, milliseconds). Logs dedupe decisions to `profile/logs/aggregate-*.log` for debuggability.

### 6. Layer 3 — opus synthesis

Single opus call with `aggregate.json` + wiki content + current session context. Produces USER.md + state.json.

Before writing: backup existing USER.md to `profile/backups/USER.md.$TS`.

### 7. Wire into openclaw (optional)

If `~/.openclaw/workspace/` exists and the user wants it synced:

```bash
# Option A: symlink (live-updates as memex re-runs)
ln -sfn "$PROFILE/USER.md" ~/.openclaw/workspace/USER.md

# Option B: copy (snapshot)
cp "$PROFILE/USER.md" ~/.openclaw/workspace/USER.md
```

**Ask which** — symlink means openclaw sees updates automatically, but if the user manually edits in openclaw they lose the edit on next rebuild. Default: ask.

## Resumability — user-facing

If the pipeline pauses (rate limit, quota, process interruption):
- All completed Layer 1 summaries persist in `memory/summaries/`.
- All completed Layer 2 batches persist in `profile/extracts/`.
- The progress log `profile/logs/pipeline-*.log.jsonl` records exact stop point.

To resume: `/memex-profile resume` (or rerun `/memex-profile`). The orchestrator:
1. Reads the latest pipeline log, finds `RESUMABLE_STOP` marker.
2. Reruns the pipeline from the beginning — Layer 1 skips done convos (content-hash match), Layer 2 skips done batches (input-hash match), picks up at first un-done unit.
3. No unit is ever redone.

## Session context — always read

Regardless of mode (full/delta/skip), always consume facts from the **current conversation**. If the user just said "I switched from X to Y", that belongs in USER.md even if memory hasn't caught up. Session context flows into Layer 3 as a side input (not through Layer 1/2).

Conflicts with memory aggregate → `Recently changed` section with both claims + dates.

## Artifact — USER.md shape

```markdown
---
generated_at: 2026-04-20T12:00:00Z
generated_from: memex (memory + wiki + current session)
source_conversations: 3193
mode: delta                       # or "full"
workdir: /Users/apple/Desktop/memex-workdir
pipeline_version: 1
---

# USER.md - About Your Human

- **Name:** ...
- **What to call them:** ...
- **Pronouns:** ...
- **Timezone:** ... (inferred from activity hours)
- **Languages:** ... (ordered by frequency)

## Context
<1-2 paragraphs>

## Currently active
<signals with trajectory=active_recent; phrasing like "Currently working on...">

## Interests & recurring themes
<signals with trajectory=active or recurring>
- **<theme>** — <gloss>. Evidence: [...](../memory/...), [wiki:notes/x.md](../wiki/notes/x.md)

## Working style
<extracted from self_statements + questions_asked patterns>

## Projects / active work
<projects signals with status=active>

## What annoys them / what to avoid
<frustrations signals>

## What makes them laugh / delight signals
<delights signals>

## Domains they know deeply
<questions_asked with level=expert + self_statements + tool depth>

## Domains they're learning
<questions_asked with level=basic; topics with recency but low volume>

## Tools & stack
<tools signals, grouped by category>

## Historical interests
<signals with trajectory=declining or dormant — only if the user explicitly asked for history, else omit>

## Recently changed
<conflicts: session context contradicted memory aggregate, with both statements and dates>

## Open questions
<low-confidence signals that didn't meet thresholds; things to explore next build>
```

Evidence links use `../memory/...` paths (USER.md is under `profile/`, one level below `memory/`).

## Boundaries — what NOT to include

- **Secrets**: API keys, credentials, financial account numbers, health specifics. Layer 1 prompt must also be told to redact these from summaries.
- **Judgments**: "This person is disorganized" — no. Describe observed behavior.
- **Speculation**: signals below threshold → `Open questions`, not main sections.
- **Third parties**: anonymize unless the name is essential ("a coworker on the scraper project").
- **Profile self-reference**: never read `profile/` or `profile/backups/` as a source.

## Reference — openclaw shape

```
~/.openclaw/workspace/
├── USER.md        # THIS is what we produce
├── SOUL.md        # agent identity (leave alone)
├── IDENTITY.md    # agent identity (leave alone)
├── AGENTS.md      # behavioral rules (leave alone)
├── BOOTSTRAP.md
├── TOOLS.md
├── HEARTBEAT.md
└── state/, tmp/
```

memex owns `USER.md` only.
