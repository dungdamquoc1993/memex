# Plan: Refactor memex-profile to a pure-agent pipeline (text-only phase)

## Context

User is designing a 3-layer pipeline that builds `USER.md` from the memex memory base, replacing the old qmd-driven one-shot approach:

- **Layer 1** (haiku): per-conversation summary with structural metadata (modality, language, tenor, entities)
- **Layer 2** (sonnet): extract signals from batches of summaries into a strict schema (topics / tools / projects / frustrations / delights / questions_asked / self_statements), with evidence carrying its own metadata
- **Layer 2.5** (deterministic): rollup — dedupe + recency/volume/persistence scoring + trajectory classification (active_recent / declining / dormant / recurring / one_off)
- **Layer 3** (opus): synthesize USER.md + state.json from the aggregate

Earlier iteration sketched Layer 1 as a `memex summarize` CLI command (adding Anthropic SDK to memex core). **User rejected that direction**: memex CLI stays out of scope; use Claude Code's existing agent system instead. Reasons: memex CLI changes are "much more complex" and separating concerns (CLI = sync/storage; plugin = profile orchestration) is cleaner.

This phase is **text-only**: new/modified markdown files (skills, agents, reference docs). No TypeScript. No memex CLI touches. No script files yet. All machinery lives in agent system prompts and the skill playbook.

## Approach

### Topology — Claude Code orchestrates 3 specialized agents

```
User → Claude Code (main, orchestrator) reads SKILL.md
          │
          ├─ spawn batches → memex-summarizer   (Layer 1, haiku-like role)
          ├─ spawn batches → memex-extractor    (Layer 2, sonnet-like role)
          ├─ run inline jq/bash rollup          (Layer 2.5, no LLM)
          └─ spawn once    → memex-profile-builder (Layer 3, opus-like role)
```

Claude Code (main) handles: freshness/delta detection, mode decision (full/delta/skip/resume), batch planning, spawn scheduling, checkpoint verification between layers, rate-limit / error surfaces, reporting back to user.

Each specialized agent handles: its own schema-constrained LLM work over a batch of units, writes atomic per-unit or per-batch output files, skips any unit whose output already exists (idempotency is baked into the agent itself — defense in depth).

### Batch sizes (initial, tunable)

User confirmed: "spawn agent nên cho nó 1 batch lớn ngay cả với layer2" — big batches to amortize agent overhead.

- **Layer 1**: 30 raw `.md` files per `memex-summarizer` spawn. 3000 convos → ~100 spawns. Context: ~30 × 5k tokens = ~150k input + ~30 × 300 tokens out.
- **Layer 2**: 50 summaries per `memex-extractor` spawn, producing 1 batch-extract JSON per spawn covering 50 convs. 3000 summaries → ~60 spawns. Context: ~50 × 500 tokens = ~25k in + ~5k out.
- **Layer 3**: 1 `memex-profile-builder` spawn total. Input: aggregate.json + wiki text + session context.

### Layer 2.5 — inline, no agent, no script file (yet)

Claude Code runs `jq` + bash commands inline during a build to do the aggregation. Algorithm lives in PIPELINE.md as reference, but concrete invocations live in SKILL.md. A standalone script at `plugin/skills/memex-profile/scripts/rollup.sh` (or .py) is a **later phase** if jq proves too painful — not in this plan.

v1 dedupe: synonym table (maintained as inline YAML in PIPELINE.md) + exact-match grouping. Fuzzy Levenshtein deferred.

### Resumability — unchanged from prior design

- Layer 1: summary file per convo. Skip if file exists AND `content_hash` matches current `.md`.
- Layer 2: batch JSON per batch. Skip if file exists AND hash of sorted input summary content_hashes matches stored value.
- Layer 2.5: always rerun (cheap, deterministic).
- Layer 3: always rerun if aggregate.json changed since last state.json.
- Rate limit / quota: agents signal back via exit sentinel; Claude Code writes `RESUMABLE_STOP` to `profile/logs/pipeline-*.log.jsonl` and tells user to `/memex-profile resume`.

### Plugin-distribution note

Claude Code plugins are directory-based — when a user installs the plugin, the whole `plugin/` folder copies to their local plugins directory. Sibling files to SKILL.md (PIPELINE.md, any scripts/) travel with it; they just aren't auto-loaded as skills. SKILL.md references them by relative path and Reads them lazily. **Flagged as a verification item** during/after this phase (confirm in Claude Code plugin docs or by installing the plugin and inspecting the installed directory).

## Critical file changes

### New files

| Path | Purpose |
|---|---|
| `plugin/agents/memex-summarizer.md` | Layer 1 agent. System prompt defines: role, Layer 1 JSON schema, batch handling (30 convs per invocation), idempotency (skip if summary file exists + content_hash matches), error behavior (log + continue per-unit), rate-limit signal. |
| `plugin/agents/memex-extractor.md` | Layer 2 agent. System prompt defines: role, Layer 2 BatchExtract schema, batch handling (50 summaries per invocation → 1 batch file), idempotency (skip if batch file exists + input-hash matches), signal-type definitions, weight scale, evidence format. |

### Files to rewrite

| Path | New role |
|---|---|
| [`plugin/agents/memex-profile-builder.md`](memex/plugin/agents/memex-profile-builder.md) | **Becomes Layer 3 synthesizer** (not orchestrator). Takes aggregate.json + session context + wiki as input; emits USER.md + state.json + build log. System prompt: USER.md shape, threshold rules (`composite_score ≥ 0.3` + `conv_count ≥ 3`), trajectory-aware phrasing, conflict handling (Recently changed section), evidence link format. |
| [`plugin/skills/memex-profile/SKILL.md`](memex/plugin/skills/memex-profile/SKILL.md) | **Claude Code's orchestration playbook**. Replaces the "delegate to builder agent" framing — Claude Code itself is the orchestrator. Describes: trigger conditions (`/memex-profile`, resume), freshness check, mode detection (full/delta/skip/resume), batch-plan computation, per-layer spawn rules with the right agent, checkpoint verification between layers, Layer 2.5 inline jq commands, rate-limit handling, optional openclaw wiring. |
| [`plugin/skills/memex-profile/PIPELINE.md`](memex/plugin/skills/memex-profile/PIPELINE.md) | **Canonical architecture + schema reference**. Strip all TypeScript interfaces and CLI shapes — reframe as pure-agent architecture. Keep: architecture diagram, JSON schemas (Layer 1, Layer 2, aggregate.json, state.json) as inline examples, scoring algorithm (recency half-life 90d, volume log saturation, persistence bucket), trajectory classification rules, dedupe synonym table, directory layout, resumability mechanism, batch-size rationale, plugin-distribution note. |

### Files to delete

| Path | Reason |
|---|---|
| [`plugin/skills/memex-profile/IMPLEMENTATION.md`](memex/plugin/skills/memex-profile/IMPLEMENTATION.md) | M1-M8 milestones all assumed CLI-based Layer 1 with TypeScript / Anthropic SDK / memex core changes. Obsolete under pure-agent architecture. Nothing worth salvaging survives the refactor — agent files are the new "implementation", not a separate doc. |

## Agent system-prompt essentials (for the new agents)

Both new agents share these traits (will be spelled out in each file):

- Input format: Claude Code passes a JSON work list as the user message (e.g., `{"convs": [{"id": "...", "md_path": "..."}, ...]}`) plus workdir path.
- Output: agent uses Write tool to emit per-unit / per-batch files; uses Bash to verify writes; returns structured status `{"processed": N, "skipped": M, "errors": [...], "rate_limited": bool}` to Claude Code.
- Never source from `profile/` or `profile/backups/` (no feedback loop).
- Never emit secrets (credentials, financial specifics, health) — even if present in input, scrub.
- Strict JSON schema validation before writing.

### memex-summarizer specifics

- Model role: haiku-class (fast, schema extraction).
- Per convo: parse frontmatter + body from .md, compute content_hash, check summary file, build prompt, emit summary JSON.
- 30 convos per invocation.

### memex-extractor specifics

- Model role: sonnet-class (reasoning + structured output).
- Per batch: read 50 summaries, compute input-hash, check batch file, extract all 7 signal types with evidence+metadata per entry, emit one BatchExtract JSON.
- 50 summaries per invocation.

### memex-profile-builder (rewritten) specifics

- Model role: opus-class (judgment + prose).
- Single invocation per build. Input: `aggregate.json` + wiki content (full or changed-only) + session context facts (passed as JSON by Claude Code).
- Output: `profile/USER.md` + `profile/state.json` + `profile/logs/build-*.md`.
- Applies thresholds, trajectory-aware phrasing, conflict-resolution into Recently changed section.

## SKILL.md orchestration skeleton (what Claude Code does)

1. On `/memex-profile`: setup workdir vars, create `profile/` subdirs if missing.
2. Freshness check via `memex status`; offer to sync if stale.
3. Check for paused previous run (`RESUMABLE_STOP` in latest pipeline log) → mode=resume.
4. Else compute mode (full / delta / skip) from state.json + catalog + wiki digest.
5. Session-context extraction: pull user-stated facts from current conversation, hold in memory.
6. Layer 1 plan: enumerate convs missing summaries; bucket into 30-sized work lists; spawn memex-summarizer per bucket (sequentially or small parallel). After each, verify summary files exist, append to pipeline log.
7. Layer 2 plan: chronological buckets of 50 summaries; skip buckets whose batch file + input-hash matches; spawn memex-extractor per remaining bucket.
8. Layer 2.5 inline: jq pipeline over all batch JSONs → write aggregate.json. Log dedupe merges to `profile/logs/aggregate-*.log`.
9. Layer 3: spawn memex-profile-builder once with aggregate.json + wiki + session context → receive USER.md + state.json.
10. Backup prior USER.md to `profile/backups/` before overwrite.
11. Offer openclaw wiring (symlink vs copy) if `~/.openclaw/workspace/` exists.
12. Report to user: mode, counts, cost estimate, build log path.

On any agent returning `rate_limited: true` or exit sentinel: flush `RESUMABLE_STOP`, tell user how to resume, stop cleanly.

## Verification (after the text files are in place)

End-to-end smoke test on a small subset (no memex code changes required):

1. Pick ~30 conversations from `memory/chatgpt/2026/04/` as a test slice (manually identify their ids).
2. Invoke `/memex-profile` with user saying "build profile using only these 30 convs". Claude Code should:
   a. Detect no prior `state.json` → mode = full.
   b. Spawn memex-summarizer once with 30 convs → verify 30 summary JSONs appear under `memory/summaries/chatgpt/2026/04/`.
   c. Spawn memex-extractor once with those 30 summaries → verify 1 batch-extract JSON under `profile/extracts/`.
   d. Run inline rollup → verify `profile/aggregate.json` content is well-formed.
   e. Spawn memex-profile-builder once → verify `profile/USER.md`, `profile/state.json`, `profile/logs/build-*.md`.
3. Invoke `/memex-profile` again immediately → should detect nothing changed → mode = skip → tell user profile is current.
4. Add 5 more convs (copy .md files manually for now) → invoke `/memex-profile` → mode = delta; only 5 new units processed at Layer 1, only 1 batch re-extracted at Layer 2, rollup + synthesis re-run.
5. Citation validity: grep USER.md for evidence links; verify every cited conv_id has a corresponding .md file.

Once smoke test passes on 30 convs, scale up to the full memory base (3000+) in a later phase — at that point we may discover that inline jq is too slow and create a script file, or that batch sizes need tuning. Those are follow-on phases.

## Out of scope (this phase)

- memex CLI changes (any TypeScript work on the memex repo)
- Anthropic SDK installation anywhere
- Script files (rollup.sh, etc.) — algorithm documented, execution happens inline
- Full backfill of 3000 summaries — the plan is done when the 30-convo smoke test succeeds
- Prompt tuning loops (haiku/sonnet/opus prompts will need iteration after first real run; not part of this planning phase)
- Multi-user profile separation
