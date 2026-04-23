---
name: memex-profile
description: Build or refresh the user's USER.md profile from memex data via a resumable 3-layer pipeline that works in either Codex or Claude Code. Layer 1 summarizes conversations into cached JSON files. Layer 2 extracts signals from summary batches. Layer 2.5 runs a deterministic jq and bash rollup. Layer 3 synthesizes `profile/USER.md`, `state.json`, and a build log. Output lives in `<workdir>/profile/`. Canonical schemas and scoring rules are in `PIPELINE.md`.
allowed-tools: Bash(memex:*), Bash(jq:*), Bash(wc:*), Bash(cp:*), Bash(ls:*), Bash(ln:*), Bash(date:*), Bash(mkdir:*), Bash(shasum:*), Bash(find:*), Bash(stat:*), Bash(sort:*), Bash(xargs:*), Bash(awk:*), Bash(tr:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(grep:*), Read, Write, Grep, Glob, Agent
---

# memex-profile

You are the pipeline orchestrator. When the repo-local Codex agents are available, prefer the same four-agent split used by Claude Code: `memex-summarizer`, `memex-extractor`, `memex-profile-builder`, and `memex-memory-navigator` for any recall subtask. If those agents are unavailable, execute the same logic directly in the current session rather than blocking.

**Authoritative schemas and scoring rules**: `PIPELINE.md` in this folder.

## When to activate

- "build my profile"
- "refresh my profile"
- "analyze who I am from my chats"
- "xây dựng profile"
- "phân tích tôi qua memex"
- "tạo USER.md"
- "generate user profile for openclaw"
- "resume the memex profile build"

## Core principles

- Treat the pipeline as four phases: summaries → extracts → deterministic rollup → final synthesis.
- Reuse cached artifacts whenever possible.
- Never write inside `memory/` except the cached `memory/summaries/` outputs that belong to this pipeline.
- Do not update `profile/state.json` unless the full build succeeds.
- Prefer the four-agent topology when the repo-local Codex agents are available; otherwise fall back to direct execution.

## Outputs

Write only under `<workdir>/profile/`:

- `profile/USER.md`
- `profile/state.json`
- `profile/logs/build-YYYYMMDD-HHMMSS.md`
- `profile/logs/pipeline-YYYYMMDD-HHMMSS.log.jsonl`
- `profile/extracts/batch-NNNN.json`

Layer 1 cache lives under:

- `memory/summaries/<source>/<year>/<month>/<id>.json`

## Phase 0 — setup

```bash
WORKDIR="$(memex config get workdir)"
PROFILE="$WORKDIR/profile"
mkdir -p "$PROFILE/logs" "$PROFILE/backups" "$PROFILE/extracts"
memex status
```

If sync is obviously stale, surface that to the user before spending tokens. Do not force a sync; let the user decide.

## Phase 1 — detect mode

Mode choices:

- `full`: no prior state, user requested rebuild, or too many new conversations
- `delta`: prior state exists and the new work is bounded
- `skip`: nothing changed except maybe session context
- `resume`: a previous run paused after writing resumable checkpoints

Suggested detection flow:

```bash
LAST_LOG=$(ls -1t "$PROFILE/logs/pipeline-"*.log.jsonl 2>/dev/null | head -1)
```

If the latest pipeline log ends with `RESUMABLE_STOP`, resume from cached artifacts instead of recomputing finished work.

If `profile/state.json` exists:

1. Read `sources.memory.max_created_at`
2. Read `sources.wiki.digest`
3. Compare against current `catalog.jsonl` and current wiki digest
4. Use `delta` when changes are small; otherwise `full`

If nothing changed but the current session adds new first-person facts, you may skip Layers 1 and 2 and still rerun the final synthesis step.

## Phase 2 — capture session context

Extract concise current-session facts:

- explicit self-statements
- current projects
- preference changes
- contradictions against existing memory

Pass these forward as structured session context. Session facts outrank stale aggregate signals but must still be cited as current-session statements.

## Phase 3 — Layer 1 summaries

Purpose: convert each conversation into one cached summary JSON.

### Scope

- `full`: default to the last 12 months unless the user asked for a different window
- `delta`: conversations with `created_at > state.json.sources.memory.max_created_at`

### Work planning

Use `catalog.jsonl` to enumerate candidates. For each candidate, decide whether the summary is missing or stale.

Batch size default: 30 conversations.

### Execution

For each conversation in scope:

1. Read the Markdown file.
2. Parse frontmatter and body.
3. Ignore tool payload noise.
4. Produce the Layer 1 JSON schema described in `PIPELINE.md`.
5. Write to `memory/summaries/<source>/<year>/<month>/<id>.json`.

If `memex-summarizer` is available, delegate one batch at a time to it. Otherwise execute inline in the main session. After each batch, verify the expected summary files exist before moving on.

## Phase 4 — Layer 2 extracts

Purpose: turn cached summaries into batch-level signal extraction files.

### Batch planning

1. Enumerate summary JSON files in scope.
2. Sort by `(created_at ASC, id)` for deterministic batching.
3. Bucket into groups of 50 summaries.
4. Assign deterministic ids `batch-NNNN`.

### Idempotency

For each batch:

1. Compute `input_hash = sha256(join(sort(content_hashes)))`
2. If `profile/extracts/batch-NNNN.json` exists with the same `input_hash`, skip it
3. Otherwise read the 50 summaries, extract signals, and write the batch JSON

The signal families stay the same as the canonical pipeline:

- topics
- tools
- projects
- frustrations
- delights
- questions_asked
- self_statements

If `memex-extractor` is available, let it own each batch. Otherwise execute the extraction directly in the main session.

## Phase 5 — Layer 2.5 deterministic rollup

No LLM is required here. Use `jq` and shell directly.

Tasks:

1. Flatten all batch extract files.
2. Group signals by normalized key.
3. Merge and dedupe evidence by `conv_id`.
4. Compute aggregate stats:
   - `conv_count`
   - `total_msgs`
   - `first_seen`
   - `last_seen`
   - `persistence_months`
   - `recency_score`
   - `volume_score`
   - `persistence_score`
   - `composite_score`
   - `trajectory`
5. Compute `metadata_inferred`.
6. Write `profile/aggregate.json`.

Use the normalization, synonym, and scoring rules from `PIPELINE.md`. Keep the rollup deterministic and reproducible.

## Phase 6 — Layer 3 synthesis

Inputs:

- `profile/aggregate.json`
- selected wiki files
- session context
- optional previous `profile/USER.md`

Outputs:

- `profile/USER.md`
- `profile/state.json`
- `profile/logs/build-*.md`

Before writing `USER.md`, back up any existing version to `profile/backups/`.

If `memex-profile-builder` is available, use it for this synthesis step. Otherwise perform the synthesis directly here following the same output contract.

Synthesis rules:

- Prefer concrete evidence links over vague claims.
- Weave high-confidence themes into prose.
- Keep contradictions visible in `Recently changed`.
- Drop one-off noise.
- Only include historical sections when the user asked for history or the evidence is strong enough to matter.

## Phase 7 — state and build log

Write `profile/state.json` only after the synthesis step succeeds.

Populate at least:

- memory conversation count
- memory max conversation timestamp
- memory catalog sha256
- wiki file count
- wiki digest
- whether session context was included
- theme count
- citation count
- backup path if any

Also write a human-readable build log that summarizes what was added, reinforced, dropped, or changed.

## Resumability and rate limits

Create `profile/logs/pipeline-YYYYMMDD-HHMMSS.log.jsonl` and append one line per batch or major phase transition.

If you hit a hard rate limit or cannot continue safely:

1. Write a `RESUMABLE_STOP` event to the pipeline log.
2. Stop cleanly without updating `profile/state.json`.
3. Tell the user how far the pipeline got and that rerunning should resume from checkpoints.

## Validation

Before reporting success:

- confirm `profile/USER.md` exists
- confirm `profile/state.json` exists and parses
- confirm `profile/aggregate.json` exists
- spot-check at least one evidence link path

## Guardrails

- Prefer the mirrored Codex helper agents when available, but do not fail if they are absent.
- Do not re-read the entire archive once summaries and extracts already provide the needed layer.
- Do not rewrite `memory/*.md` conversations.
- Prefer deterministic shell work over free-form model reasoning whenever the task is mechanical.
