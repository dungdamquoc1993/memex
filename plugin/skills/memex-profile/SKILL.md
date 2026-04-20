---
name: memex-profile
description: Build or refresh the user's USER.md profile from memex data via a 3-layer agent pipeline orchestrated by Claude Code. Layer 1 summarizes each conversation (memex-summarizer agent, haiku-class, batch 30). Layer 2 extracts signals from summary batches (memex-extractor agent, sonnet-class, batch 50). Layer 2.5 runs inline jq/bash rollup (deterministic, no LLM). Layer 3 synthesizes USER.md (memex-profile-builder agent, opus-class, single invocation). Output lives in `<workdir>/profile/` with file-based checkpoints for full resumability under rate limits. Compatible with openclaw-style harnesses. Load when the user asks to "build my profile", "analyze my memory", "figure out who I am from my chats", "xây dựng profile", "phân tích tôi qua memex", "tạo USER.md", "generate user profile for openclaw", "/memex-profile", or "/memex-profile resume". Canonical schemas and algorithms are in `PIPELINE.md` in this folder.
allowed-tools: Bash(memex:*), Bash(jq:*), Bash(wc:*), Bash(cp:*), Bash(ls:*), Bash(ln:*), Bash(date:*), Bash(mkdir:*), Bash(shasum:*), Bash(find:*), Bash(stat:*), Bash(sort:*), Bash(xargs:*), Bash(awk:*), Bash(tr:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(grep:*), Read, Write, Grep, Glob, Agent
---

# memex-profile

You (Claude Code) are the **pipeline orchestrator**. This skill is your playbook: when the user asks to build or refresh their profile, follow the steps below. You spawn three specialized agents in sequence, run an inline deterministic rollup between them, verify checkpoints, and handle rate-limit pauses.

**Authoritative architecture & schemas**: `PIPELINE.md` in this folder. Read it when you need specifics about an agent's schema or the rollup algorithm.

## When to activate

- User says: "build my profile", "refresh my profile", "analyze who I am", "summarize what I care about", "make a USER.md for openclaw", or Vietnamese equivalents ("xây dựng profile", "phân tích tôi", "tạo USER.md")
- User invokes `/memex-profile`
- User invokes `/memex-profile resume` — continue a paused pipeline run after rate limit / quota / interruption

## The three agents you spawn

| Layer | Agent | Role | Batch | Output |
|---|---|---|---|---|
| 1 | `memex-summarizer` | per-conv summary (metadata + content) | 30 convs/spawn | `memory/summaries/<source>/<y>/<m>/<id>.json` |
| 2 | `memex-extractor` | signal extraction from summary batches | 50 summaries/spawn | `profile/extracts/batch-NNNN.json` |
| 2.5 | (YOU — inline) | deterministic rollup (dedupe + stats + trajectory) | — | `profile/aggregate.json` |
| 3 | `memex-profile-builder` | USER.md synthesis | single invocation | `profile/USER.md` + `state.json` + build log |

Use the `Agent` tool with `subagent_type` set to the agent name above. Pass the JSON work input as the prompt.

## Orchestration playbook — step by step

### Phase 0 — Setup and freshness

```bash
WORKDIR="$(memex config get workdir)"
PROFILE="$WORKDIR/profile"
mkdir -p "$PROFILE/logs" "$PROFILE/backups" "$PROFILE/extracts"

memex status
```

If last sync >7d, surface to user: "Last sync was N days ago. Sync first? (/memex-sync ... or skip)." Don't force; user decides.

### Phase 1 — Check for paused run

```bash
LAST_LOG=$(ls -1t "$PROFILE/logs/pipeline-"*.log.jsonl 2>/dev/null | head -1)
if [ -n "$LAST_LOG" ] && tail -5 "$LAST_LOG" | grep -q RESUMABLE_STOP; then
  MODE=resume
fi
```

If resume: tell the user "Previous pipeline was paused — resuming." Skip Phase 2, proceed directly to Phase 3 (all agents' idempotency means re-running from start is safe — completed units skip via content-hash / input-hash checks).

### Phase 2 — Mode detection

```bash
NEW_CONVOS=0
MODE=full

if [ -f "$PROFILE/state.json" ]; then
  LAST_MAX=$(jq -r '.sources.memory.max_created_at' "$PROFILE/state.json")
  LAST_WIKI_DIGEST=$(jq -r '.sources.wiki.digest' "$PROFILE/state.json")

  NEW_CONVOS=$(jq -r --arg d "$LAST_MAX" 'select(.created_at > $d) | .id' \
    "$WORKDIR/memory/catalog.jsonl" | wc -l | tr -d ' ')

  CURR_WIKI_DIGEST=$(find "$WORKDIR/wiki" -type f -name '*.md' -print0 \
    | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $1}')

  if [ "$NEW_CONVOS" -eq 0 ] && [ "$CURR_WIKI_DIGEST" = "$LAST_WIKI_DIGEST" ]; then
    MODE=skip
  elif [ "$NEW_CONVOS" -lt 500 ]; then
    MODE=delta
  fi
fi
```

| Condition | Mode |
|---|---|
| No state.json | **full** |
| User explicitly asked for rebuild | **full** |
| `NEW_CONVOS >= 500` | **full** (theme decay matters at this scale) |
| Nothing changed, no new session context | **skip** — tell user "profile is current" |
| Otherwise | **delta** |

In **skip** mode *with* new session context: still run Layer 3 with empty new-work at Layers 1/2 and fresh session input. Output is a minimal update (Recently changed + state.json bump).

### Phase 3 — Extract session context (always)

Regardless of mode, pull notable facts from the current conversation. Look for:
- First-person statements about preferences, habits, work
- Mentions of current projects / tools
- Anything that contradicts what memory might show

Format as a list that Layer 3 will consume:

```json
[
  {"kind": "self_statement", "text": "I switched from neovim to helix last month"},
  {"kind": "project", "text": "working on memex profile pipeline"},
  {"kind": "preference", "text": "prefers Vietnamese for notes, English for code"}
]
```

Keep this list in your working context — you'll pass it into Layer 3.

### Phase 4 — Layer 1: summarize missing conversations

Open a pipeline log file:

```bash
TS=$(date +%Y%m%d-%H%M%S)
PIPELINE_LOG="$PROFILE/logs/pipeline-$TS.log.jsonl"
touch "$PIPELINE_LOG"
```

#### 4a. Enumerate missing summaries

Scope by mode:
- **full**: all convs in `memory/` from the time window (default: last 12 months). Use `jq` on `catalog.jsonl` to filter.
- **delta**: convs with `created_at > LAST_MAX`.

For each conv in scope, check if `memory/summaries/<source>/<y>/<m>/<id>.json` exists. If yes, skip (Layer 1 agent would skip anyway, but filtering early avoids spawn overhead). If missing or stale (content_hash mismatch), add to work list.

```bash
# Example: list missing summaries for delta mode
jq -r --arg d "$LAST_MAX" 'select(.created_at > $d) | [.id, .source, .created_at, .relpath] | @tsv' \
  "$WORKDIR/memory/catalog.jsonl" > /tmp/work_list.tsv
# Then filter by checking summary file existence
```

#### 4b. Bucket into batches of 30, spawn agents sequentially

```
work_list (N convs) → ceil(N / 30) batches of 30 (last may be partial)
```

For each batch, spawn `memex-summarizer` with the batch as input (see agent's schema for exact shape). Wait for return. Parse its return JSON.

Rules:
- Start sequential. Do NOT launch many spawns in parallel until you have confidence in rate-limit behavior. Once stable, you may run up to 2-3 in parallel (`run_in_background: true`) to speed up; back off at first 429.
- After each spawn, verify expected summary files exist on disk. If any expected file is missing, log to `errors-<TS>.jsonl`.
- Append a line to `$PIPELINE_LOG` per spawn:
  ```jsonl
  {"ts": "<ISO>", "layer": 1, "batch_index": 3, "processed": 28, "skipped": 2, "errors": 0}
  ```

#### 4c. Rate-limit / error handling

If an agent returns `rate_limited: true`:
1. Write to pipeline log:
   ```jsonl
   {"ts": "<ISO>", "layer": 1, "status": "RESUMABLE_STOP", "processed_so_far": <N>, "total": <M>}
   ```
2. Report to user:
   > "Pipeline paused at Layer 1 (~N/M conversations summarized). Run `/memex-profile resume` in a few minutes when rate limits reset."
3. STOP the pipeline — do not proceed to Layer 2. state.json stays untouched.

### Phase 5 — Layer 2: extract signals from summary batches

#### 5a. Plan batches

```bash
# Enumerate summaries in time window, sorted chronologically
find "$WORKDIR/memory/summaries" -name '*.json' -type f \
  | xargs -I{} jq -r --arg id "{}" '[.created_at, .id, $id] | @tsv' {} \
  | sort \
  > /tmp/summaries_sorted.tsv
```

Bucket into 50-summary batches, each assigned `batch-NNNN` (zero-padded by chronological index).

#### 5b. Check idempotency before spawning

For each batch:

1. Read the 50 summaries' `content_hash` values.
2. Sort them ascending, join with newlines.
3. Compute `input_hash = shasum -a 256` of that.
4. If `profile/extracts/batch-NNNN.json` exists AND its stored `input_hash` matches → skip (don't spawn).
5. Otherwise spawn `memex-extractor` with the batch input.

In **delta** mode: typically only 1-3 trailing batches need re-extraction. In **full** mode: potentially all batches (but cached ones skip fast).

#### 5c. Spawn memex-extractor

For each un-skipped batch, spawn sequentially (or small parallel). Agent writes one `profile/extracts/batch-NNNN.json` and returns a status JSON.

Log each spawn to `$PIPELINE_LOG`. On `rate_limited: true`, same pause protocol as Phase 4c but at Layer 2.

### Phase 6 — Layer 2.5: inline rollup (no agent, no LLM)

Use `jq` + bash directly. Algorithm is specified in `PIPELINE.md` §Layer 2.5; here's the execution outline:

#### 6a. Collect all signals across batches

```bash
# Flatten signals from all batches — one signal entry per line
jq -c '.signals | to_entries[] | {type: .key, entries: .value}' \
  "$PROFILE/extracts/"batch-*.json > /tmp/all_signals.jsonl
```

#### 6b. Group by normalized key, merge evidence

Write a small jq pipeline (or generate a bash loop) that:
- Normalizes each signal's key (topic/tool/project/about/claim/domain)
- Applies the synonym table (from PIPELINE.md — keep inline in this skill's execution, or read from a small YAML if you split it out)
- Groups by normalized key
- Unions evidence across batches, deduping by `conv_id`

#### 6c. Compute stats per signal

For each grouped signal, compute:
- `conv_count`, `total_msgs`, `first_seen`, `last_seen`, `peak_period`, `persistence_months`
- `sources`, `modalities` distributions
- `recency_score`, `volume_score`, `persistence_score`, `composite_score` (formulas in PIPELINE.md)
- `trajectory` classification (rules in PIPELINE.md)
- `co_occurs_with` (top 5 other signals sharing ≥2 conv_ids)
- `evidence_top` (3-5 best evidence entries — most recent or highest msg_count)

#### 6d. Compute metadata_inferred

Aggregate across all summaries (not extracts):

```bash
# Timezone guess via histogram of created_at hours
find "$WORKDIR/memory/summaries" -name '*.json' \
  | xargs jq -r '.created_at[11:13]' \
  | sort | uniq -c | sort -rn
# Pick active_hours; infer timezone from quiet-hours trough

# Language distribution
find "$WORKDIR/memory/summaries" -name '*.json' \
  | xargs jq -r '.primary_language' \
  | sort | uniq -c | sort -rn

# Source distribution from catalog
jq -r '.source' "$WORKDIR/memory/catalog.jsonl" | sort | uniq -c | sort -rn
```

#### 6e. Write aggregate.json

Assemble the final `aggregate.json` per schema in PIPELINE.md §Layer 2.5. Write via Write tool.

Write dedupe decisions to `$PROFILE/logs/aggregate-$TS.log` for debuggability.

#### Implementation note for rollup

If inline jq pipelines get too gnarly (and they might, given the scoring math), you are allowed to write a one-shot bash/jq/awk script to `/tmp/rollup-$TS.sh` and execute it. The script is ephemeral — no permanent file at `plugin/skills/memex-profile/scripts/` in this phase. If we find ourselves doing this every build, that's the signal to promote it to a permanent script — but not yet.

### Phase 7 — Gather wiki content

```bash
# Full mode: all wiki .md files
find "$WORKDIR/wiki" -type f -name '*.md'

# Delta mode: only files newer than state.json
find "$WORKDIR/wiki" -type f -name '*.md' -newer "$PROFILE/state.json"
```

Read each file, assemble a list of `{path, content}` objects. Cap total size at ~30KB — if the wiki is bigger, truncate the largest files first and note the truncation in the build log.

### Phase 8 — Layer 3: synthesize USER.md

#### 8a. Backup existing USER.md

```bash
TS_BACKUP=$(date +%Y%m%d-%H%M%S)
[ -f "$PROFILE/USER.md" ] && cp "$PROFILE/USER.md" "$PROFILE/backups/USER.md.$TS_BACKUP"
```

#### 8b. Spawn memex-profile-builder (single invocation)

Input to the agent:

```json
{
  "workdir": "<workdir>",
  "mode": "<full|delta|skip>",
  "aggregate_path": "profile/aggregate.json",
  "wiki_files": [{"path": "...", "content": "..."}, ...],
  "session_context": [<from Phase 3>],
  "previous_user_md": "<content only if delta mode>"
}
```

Wait for return. Agent writes `USER.md`, `state.json`, and `logs/build-*.md`.

#### 8c. Verify outputs

```bash
[ -f "$PROFILE/USER.md" ] || echo "ERROR: USER.md missing"
[ -f "$PROFILE/state.json" ] || echo "ERROR: state.json missing"
jq -e . "$PROFILE/state.json" >/dev/null || echo "ERROR: state.json malformed"
```

If any verify fails, surface to user with agent's raw output for debugging.

### Phase 9 — Offer openclaw wiring (optional)

Only prompt if this is the first successful build OR the user asked, AND `~/.openclaw/workspace/` exists:

```bash
ls ~/.openclaw/workspace/ 2>/dev/null
```

Ask user:
- **symlink**: `ln -sfn "$PROFILE/USER.md" ~/.openclaw/workspace/USER.md` — openclaw sees live updates
- **copy**: `cp "$PROFILE/USER.md" ~/.openclaw/workspace/USER.md` — snapshot, user can edit in openclaw independently
- **neither**: skip

Default: ask, don't auto-link.

### Phase 10 — Report to user

Summarize the run:

```
USER.md <built|updated> at: <path>
Mode: <full|delta|skip|resume>
Conversations: <total> (new this run: <N>)
Layer 1 summaries: <done> (+<newly_summarized>)
Layer 2 batches: <done> (+<newly_extracted>)
Themes: added <a>, reinforced <r>, unchanged <u>
Evidence citations: <n>
Duration: <seconds>s
Backup: <path or "none — first run">
Log: <build log path>
```

If paused (rate-limited) at any phase:

```
Pipeline PAUSED
Stopped at: Layer <n>, <progress>
Progress preserved on disk:
  - Layer 1: <n> summaries
  - Layer 2: <n> batches
Resume: /memex-profile resume (when rate limits reset or billing restores)
Log: <pipeline log path>
```

## Conventions and guardrails

- **Work directly.** You ARE the orchestrator; don't spin up another sub-orchestrator agent. Call `memex-summarizer` / `memex-extractor` / `memex-profile-builder` directly via the Agent tool.
- **Sequential by default.** Spawn one batch agent at a time. Only parallelize after a full pipeline has succeeded once at the current data scale.
- **Verify every spawn.** After an agent returns, check the expected output files exist on disk and are well-formed (jq validates).
- **Never skip the pipeline log.** Every spawn, skip, error, and pause writes a line.
- **Session context is first-class.** Always extract and pass it into Layer 3, even in skip mode if the user said something meaningful.
- **Ask before openclaw wiring** — never auto-symlink.
- **Never write to `memory/`.** Layer 1 writes only to `memory/summaries/` which the summarizer agent owns; you don't write there directly.
- **Never source from `profile/`.** You read it to check state, but no agent's input should include prior USER.md or aggregate content as "source" — only `previous_user_md` for Layer 3 continuity.

## Quick reference — directory layout

```
<workdir>/
├── memory/
│   ├── <source>/YYYY/MM/<id>.md           # raw
│   └── summaries/<source>/YYYY/MM/<id>.json  # Layer 1
└── profile/
    ├── USER.md                             # Layer 3 artifact
    ├── state.json                          # source snapshot
    ├── aggregate.json                      # Layer 2.5 output
    ├── extracts/batch-NNNN.json            # Layer 2 artifacts
    ├── logs/
    │   ├── build-*.md                      # human build report
    │   ├── pipeline-*.log.jsonl            # progress log
    │   ├── aggregate-*.log                 # rollup dedupe log
    │   └── errors-*.jsonl                  # per-unit errors
    └── backups/USER.md.*
```
