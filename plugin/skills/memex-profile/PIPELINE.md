# PIPELINE — memex-profile build architecture

Canonical architecture + schema reference for the 3-layer profile pipeline. This document is the source of truth; if `SKILL.md` or any helper agent file disagrees, this file wins.

**Host compatibility note**: this document is intentionally host-agnostic. The same artifacts can be produced by Claude Code using bundled helper agents, by Codex directly from `SKILL.md`, or by optional repo-local custom agents in `/.codex/agents/`. When sections below mention Claude Code or a named helper agent, read that as one possible executor, not a mandatory runtime dependency.

**No code in here.** Everything below is schema, algorithm, and contract. Actual execution happens in the orchestration playbook (`SKILL.md`) plus any optional helper-agent instructions the host chooses to use.

## Design intent

- **Deterministic coverage**: every conversation contributes — no qmd-style top-K retrieval that can miss themes.
- **Pay-once, reuse-forever**: per-conversation summary is computed once and cached forever.
- **Structural skeleton, not just content**: recency, source, volume, modality, trajectory propagate through every layer. Layer 3 writes with temporal awareness ("currently active" vs "historically explored") because every upstream layer preserved the metadata.
- **Delta-native**: after +N new conversations, pipeline re-summarizes N, re-extracts ~N/50 batches, re-runs aggregate, re-writes USER.md. Not 3000 again.
- **Resumable under rate limit**: file-based checkpoints at every layer. If Layer 1 stops at 1000/3193, the next run resumes at 1001.
- **No qmd in this pipeline.** qmd stays for general memex search; profile build has its own exhaustive, deterministic path.
- **Host-agent topology.** No CLI changes to memex. No required Anthropic or OpenAI SDK installs for the pipeline itself. The host agent may execute phases directly or delegate them to optional helpers; a deterministic inline rollup glues Layer 2 → Layer 3.

## Architecture overview

```
┌────────────────────────────────────────────────────────────────┐
│  Host agent (Codex or Claude Code) — orchestrator              │
│                                                                │
│  Reads SKILL.md. Decides mode (full/delta/skip/resume).        │
│  Plans batches. Spawns agents. Verifies checkpoints.           │
│  Handles rate-limit pauses. Reports back to user.              │
└────────────────┬───────────────────────────────────────────────┘
                 │
   ┌─────────────┼─────────────┬─────────────────┐
   ▼             ▼             ▼                 ▼
┌─────────┐ ┌─────────┐  ┌──────────────┐  ┌────────────┐
│ LAYER 1 │ │ LAYER 2 │  │ LAYER 2.5    │  │ LAYER 3    │
│         │ │         │  │              │  │            │
│ memex-  │ │ memex-  │  │ inline       │  │ memex-     │
│ summar- │ │ extrac- │  │ jq/bash      │  │ profile-   │
│ izer    │ │ tor     │  │ rollup       │  │ builder    │
│ agent   │ │ agent   │  │ (no LLM,     │  │ agent      │
│         │ │         │  │  no script   │  │            │
│ 30      │ │ 50      │  │  file yet)   │  │ 1 spawn    │
│ convs   │ │ summar- │  │              │  │ total      │
│ /spawn  │ │ ies     │  │              │  │            │
│         │ │ /spawn  │  │              │  │            │
│ haiku-  │ │ sonnet- │  │              │  │ opus-class │
│ class   │ │ class   │  │              │  │ judgment + │
│ schema  │ │ signals │  │              │  │ prose      │
│ extract │ │ extract │  │              │  │            │
└────┬────┘ └────┬────┘  └──────┬───────┘  └─────┬──────┘
     ▼           ▼              ▼                ▼
memory/     profile/       profile/         profile/
summaries/  extracts/      aggregate.json   USER.md
<s>/<y>/   batch-         (one file,       state.json
<m>/       NNNN.json      overwritten)     logs/build-*.md
<id>.json
```

## Layer 1 — Per-conversation summary

**Agent**: `memex-summarizer` (see `plugin/agents/memex-summarizer.md` for system prompt).
**Model role**: haiku-class (fast, structured extraction, cheap).
**Batch size**: 30 conversations per agent invocation. 3000 convos → ~100 spawns.
**Where outputs land**: `<workdir>/memory/summaries/<source>/<year>/<month>/<id>.json` (sibling to the raw `.md`).

**Input to the agent** (passed by the host orchestrator as the user message):

```json
{
  "workdir": "/Users/apple/Desktop/memex-workdir",
  "convs": [
    {"id": "chatgpt_abc123", "md_path": "memory/chatgpt/2026/04/chatgpt_abc123.md"},
    {"id": "chatgpt_def456", "md_path": "memory/chatgpt/2026/04/chatgpt_def456.md"}
  ]
}
```

**What the agent does per conversation**:

1. Read the `.md` file at `<workdir>/<md_path>`.
2. Parse frontmatter + body. Strip tool-use payloads from body (they're not content-signal for profile purposes).
3. Compute `content_hash = sha256(raw .md bytes)`.
4. Check if `summaries/.../`<id>.json` exists AND its `content_hash` matches → skip (emit `{status: "skipped"}` for that unit).
5. Summarize into the Layer 1 schema. Scrub any secrets (API keys, credentials, financial/health specifics).
6. Write summary JSON atomically to the summary path.

**Layer 1 output schema**:

```json
{
  "schema_version": 1,
  "id": "chatgpt_abc123",
  "source": "chatgpt",
  "title": "RL with sparse rewards",
  "created_at": "2026-04-12T09:11:00Z",
  "updated_at": "2026-04-12T11:24:00Z",
  "msg_count": 47,
  "duration_minutes": 133,
  "content_hash": "<sha256 of source .md>",
  "summary": "User is exploring reinforcement learning for a robotics side project. Focused on sparse-reward shaping and PPO vs SAC. Asks why TD error diverges in their setup; gets debugging advice about value bootstrapping and entropy tuning. Writes in English with occasional Vietnamese glossary questions.",
  "primary_modality": "deep_dive",
  "primary_language": "en",
  "emotional_tenor": "neutral",
  "key_entities": ["reinforcement learning", "PPO", "SAC", "sparse rewards", "robotics"]
}
```

| Field | Notes |
|---|---|
| `schema_version` | bump only on breaking change (rare; triggers backfill) |
| `id`, `source`, `title`, `created_at`, `updated_at` | passed through from frontmatter |
| `msg_count` | `messages.length` in source |
| `duration_minutes` | derived: `last_msg_ts − first_msg_ts` in minutes, rounded |
| `content_hash` | sha256 hex of raw `.md` — identity check for resync detection |
| `summary` | 2-4 sentences, ≤400 chars |
| `primary_modality` | `deep_dive` \| `passing` \| `question` \| `tutorial` \| `complaint` |
| `primary_language` | `en` \| `vn` \| `mixed` |
| `emotional_tenor` | `neutral` \| `frustrated` \| `excited` \| `confused` |
| `key_entities` | 3-10 noun phrases (topics, tools, projects). NOT sentences. |

**Agent return value** (for the host orchestrator):

```json
{
  "layer": 1,
  "processed": 28,
  "skipped": 2,
  "errors": [{"id": "chatgpt_xyz", "reason": "malformed frontmatter"}],
  "rate_limited": false
}
```

If `rate_limited: true`, the agent stopped mid-batch; the remaining items in its input batch are unprocessed and safe to re-queue.

## Layer 2 — Batch signal extraction

**Agent**: `memex-extractor` (see `plugin/agents/memex-extractor.md`).
**Model role**: sonnet-class (reasoning + structured output).
**Batch size**: 50 summaries per agent invocation → 1 batch-extract JSON. 3000 summaries → ~60 spawns.
**Where outputs land**: `<workdir>/profile/extracts/batch-NNNN.json`.

**Batching rule** (the host orchestrator decides, then hands the agent its batch):

- Enumerate all Layer 1 summaries in the configured `time_window` (default last 12 months).
- Sort by `(created_at ASC, id)` for determinism.
- Bucket into fixed-size 50-summary groups. Last bucket may be partial.
- Batch ID = `batch-NNNN`, zero-padded 4 digits.

Why chronological fixed-size buckets:
- Deterministic: reruns produce identical batches.
- Delta-friendly: new summaries land in trailing buckets, leaving old buckets cached.
- Context-coherent: 50 convs in a ~3-week slice share context better than random.
- Cheap to hash for idempotency.

**Input to the agent**:

```json
{
  "workdir": "/Users/apple/Desktop/memex-workdir",
  "batch_id": "batch-0042",
  "summaries": [
    { /* full Layer 1 summary JSON */ },
    { /* ... */ }
  ]
}
```

Summaries are passed INLINE (not as paths) because the agent needs all their content. 50 × ~500 tokens = ~25k input tokens, manageable.

**What the agent does**:

1. Compute `input_hash = sha256(join(sort(summaries[].content_hash)))`.
2. If `profile/extracts/batch-NNNN.json` exists AND its stored `input_hash` matches → emit `{status: "skipped"}`.
3. Extract signals across all 7 types (topics / tools / projects / frustrations / delights / questions_asked / self_statements). Every signal entry carries full evidence with per-conv metadata.
4. Validate output against schema.
5. Write batch JSON atomically.

**Layer 2 output schema**:

```json
{
  "schema_version": 1,
  "batch_id": "batch-0042",
  "batch_generated_at": "2026-04-20T12:05:10Z",
  "input_hash": "<sha256 of sorted input content_hashes>",
  "batch_meta": {
    "conversation_count": 50,
    "date_range": {"from": "2026-03-01", "to": "2026-03-21"},
    "sources": {"chatgpt": 30, "claude_code": 15, "claude": 5},
    "total_msgs": 1437,
    "languages": {"en": 35, "vn": 5, "mixed": 10}
  },
  "signals": {
    "topics": [
      {
        "topic": "reinforcement learning",
        "weight_in_batch": "heavy",
        "evidence": [
          {"conv_id": "chatgpt_abc123", "source": "chatgpt", "date": "2026-03-17", "msg_count": 47, "modality": "deep_dive"},
          {"conv_id": "claude_code_def456", "source": "claude_code", "date": "2026-03-19", "msg_count": 12, "modality": "question"}
        ]
      }
    ],
    "tools": [
      {
        "tool": "PyTorch",
        "context": "used for PPO implementation",
        "evidence": [{"conv_id": "chatgpt_abc123", "source": "chatgpt", "date": "2026-03-17", "msg_count": 47, "modality": "deep_dive"}]
      }
    ],
    "projects": [
      {"project": "robotics sim", "status": "active", "evidence": [/* ... */]}
    ],
    "frustrations": [
      {"about": "TD error divergence in training", "evidence": [/* ... */]}
    ],
    "delights": [
      {"about": "finally understood entropy bonus", "evidence": [/* ... */]}
    ],
    "questions_asked": [
      {"domain": "reinforcement learning", "level": "intermediate", "evidence": [/* ... */]}
    ],
    "self_statements": [
      {"claim": "I prefer writing in English for technical work, Vietnamese for notes", "evidence": [/* ... */]}
    ]
  }
}
```

**Signal types & definitions**:

| Type | Captures | Example |
|---|---|---|
| `topics` | Subject matter — things they discuss, read about, think about | "reinforcement learning", "distributed systems" |
| `tools` | Concrete tools they use or evaluate | "PyTorch", "neovim", "ripgrep" |
| `projects` | Named ongoing work (`status: active \| past \| discussed`) | "memex CLI", "thesis writing" |
| `frustrations` | Things they complain about, get stuck on | "Go generics ergonomics", "slow CI" |
| `delights` | Things that excite them, they're proud of | "finally got the types right", "Rust error messages" |
| `questions_asked` | Knowledge-seeking behavior — proxies for learning. Include `level`. | domain="type theory", level="basic" |
| `self_statements` | Explicit claims they make about themselves (HIGH value) | "I hate Python typing", "I work best at night" |

**Weight scale** (`weight_in_batch`):
- `heavy`: multiple messages across multiple convos in the batch
- `moderate`: dedicated convo section or repeated mention
- `mentioned`: passing reference

**Evidence object** (attached to every signal entry):

```json
{"conv_id": "...", "source": "...", "date": "YYYY-MM-DD", "msg_count": 47, "modality": "deep_dive"}
```

Full metadata travels with every signal. Layer 2.5 needs all of it to compute aggregate stats.

**Agent return value**:

```json
{
  "layer": 2,
  "batch_id": "batch-0042",
  "status": "ok" | "skipped",
  "signals_counts": {"topics": 12, "tools": 7, "projects": 3, "frustrations": 4, "delights": 2, "questions_asked": 8, "self_statements": 3},
  "rate_limited": false
}
```

## Layer 2.5 — Deterministic rollup (inline, no LLM)

**Who runs it**: the host orchestrator directly, via `jq` and bash commands inline. No helper is required. No script file (yet).

**Input**: all `profile/extracts/batch-*.json` files.
**Output**: `<workdir>/profile/aggregate.json` + `<workdir>/profile/logs/aggregate-YYYYMMDD-HHMMSS.log` (dedupe merge log).

**Algorithm** — for each signal type (7 total):

1. **Collect**: read all signal entries of this type from all batch JSONs.
2. **Normalize key**: lowercase, trim whitespace, strip leading/trailing punctuation.
3. **Apply synonym table** (see below) to canonicalize.
4. **Group by normalized key**: merge entries sharing the same key.
5. **Accumulate evidence**: union of all evidence entries for that key (dedupe by `conv_id`).
6. **Compute stats**:
    - `conv_count` = unique `conv_id` count
    - `total_msgs` = sum of `msg_count` across evidence
    - `first_seen` = min(date)
    - `last_seen` = max(date)
    - `peak_period` = YYYY-MM bucket with most evidence entries
    - `sources` = {source: count} distribution
    - `modalities` = {modality: count} distribution
    - `persistence_months` = number of distinct YYYY-MM buckets with activity
7. **Compute scores**:
    - `recency_score = 0.5 ^ (days_since(last_seen) / 90)` — half-life 90 days
    - `volume_score = min(1.0, log10(total_msgs + 1) / 3)` — saturates near ~1000 msgs
    - `persistence_score = min(1.0, persistence_months / 6)` — saturates at 6 months of activity
    - `composite_score = 0.5 * recency_score + 0.3 * volume_score + 0.2 * persistence_score`
8. **Classify trajectory**:
    - `active_recent`: `last_seen` within 30 days AND activity in last 30d ≥ activity in prior 30d
    - `declining`: was heavy (composite > 0.5) but `last_seen` > 60 days ago
    - `dormant`: `last_seen` > 90 days ago
    - `recurring`: activity in ≥3 distinct months with gaps ≥ 30 days between bursts
    - `one_off`: `conv_count` ≤ 2 and spans < 14 days
    - `active`: default if recent but doesn't fit `active_recent` pattern
9. **Co-occurrence**: for each signal, list top 5 other signals (any type) sharing ≥2 `conv_id`s.
10. **Sort** by `composite_score` DESC.
11. **Truncate** to top-K per type: K=50 for topics, 30 for tools/projects, 20 for others.
12. **Keep `evidence_top`** per signal: 3-5 most-recent or highest-`msg_count` evidence entries (for Layer 3 to cite). Drop the rest.

### Synonym table (v1, inline; grows over time)

Maintained as an inline YAML block that the host orchestrator loads before rollup. v1 is minimal; new entries get added as false-merges surface in aggregate logs.

```yaml
# Canonical key → list of variants that collapse to it
python: [py]
typescript: [ts, type script]
javascript: [js]
reinforcement learning: [rl, reinforcement-learning]
neovim: [nvim]
kubernetes: [k8s]
postgres: [postgresql, pg]
```

v1 dedupe is **synonym-table + exact-match only**. Fuzzy Levenshtein is deferred — adds complexity and can mis-merge. Add later if real false-negatives justify it.

### aggregate.json schema

```json
{
  "schema_version": 1,
  "generated_at": "2026-04-20T12:08:30Z",
  "period_analyzed": {"from": "2025-04-20", "to": "2026-04-20"},
  "total_conversations": 3193,
  "total_batches": 64,
  "signals_by_type": {
    "topics": [
      {
        "signal": "reinforcement learning",
        "type": "topic",
        "stats": {
          "conv_count": 23,
          "total_msgs": 478,
          "first_seen": "2025-08-01",
          "last_seen": "2026-04-15",
          "peak_period": "2026-02",
          "persistence_months": 8,
          "recency_score": 0.87,
          "volume_score": 0.88,
          "persistence_score": 1.0,
          "composite_score": 0.89
        },
        "sources": {"chatgpt": 12, "claude_code": 8, "claude": 3},
        "modalities": {"deep_dive": 8, "question": 10, "tutorial": 5},
        "trajectory": "active_recent",
        "co_occurs_with": ["python", "numpy", "robotics", "PPO"],
        "evidence_top": [
          {"conv_id": "chatgpt_abc123", "date": "2026-04-15", "msg_count": 47},
          {"conv_id": "claude_code_def456", "date": "2026-04-10", "msg_count": 32}
        ]
      }
    ],
    "tools": [ /* same shape */ ],
    "projects": [ /* same shape */ ],
    "frustrations": [ /* same shape */ ],
    "delights": [ /* same shape */ ],
    "questions_asked": [ /* same shape */ ],
    "self_statements": [ /* same shape */ ]
  },
  "metadata_inferred": {
    "timezone_guess": "Asia/Ho_Chi_Minh",
    "primary_languages": ["vn", "en"],
    "platform_distribution": {"chatgpt": 1450, "claude_code": 980, "claude": 763},
    "active_hours_utc": [1, 2, 3, 14, 15, 16]
  }
}
```

**Metadata inference** (also done at Layer 2.5, mechanically):
- `timezone_guess`: histogram of conversation `created_at` hours over all summaries; pick the timezone whose 22:00-06:00 window has the deepest activity trough.
- `primary_languages`: aggregate `primary_language` field from summaries (ordered by count).
- `platform_distribution`: count summaries per source.
- `active_hours_utc`: top-6 UTC hours by activity volume.

## Layer 3 — Synthesis

**Agent**: `memex-profile-builder` (see `plugin/agents/memex-profile-builder.md`).
**Model role**: opus-class (judgment, prose, conflict handling).
**Invocations**: exactly 1 per build.
**Output**: `<workdir>/profile/USER.md` + `<workdir>/profile/state.json` + `<workdir>/profile/logs/build-YYYYMMDD-HHMMSS.md`.

**Input to the agent** (passed by the host orchestrator):

```json
{
  "workdir": "/Users/apple/Desktop/memex-workdir",
  "mode": "full" | "delta" | "skip",
  "aggregate_path": "profile/aggregate.json",
  "wiki_files": [
    {"path": "wiki/notes/tooling.md", "content": "..."},
    {"path": "wiki/projects/memex.md", "content": "..."}
  ],
  "session_context": [
    {"kind": "self_statement", "text": "I switched from neovim to helix last month"},
    {"kind": "project", "text": "working on memex profile pipeline"},
    {"kind": "preference", "text": "prefers Vietnamese for notes, English for code"}
  ],
  "previous_user_md": "..."   // only in delta mode, for continuity
}
```

In delta mode, `wiki_files` contains only files whose digest changed since last build. Full mode passes all wiki content (bounded to a reasonable prompt budget; truncate largest files if overflow).

### Agent responsibilities

1. **Apply thresholds** (from aggregate):
    - Memory-derived signal enters a main section if `composite_score ≥ 0.3` AND `conv_count ≥ 3`.
    - Wiki/session facts bypass the 3-conv threshold (pre-curated).
    - Below-threshold signals go to `Open questions`.

2. **Trajectory-aware phrasing**:
    - `active_recent` → "Currently active" section OR "Projects / active work"
    - `active`, `recurring` → "Interests & recurring themes"
    - `declining` → "Recently changed" or omit
    - `dormant` → "Historical interests" subsection (or drop if low-value)
    - `one_off` → drop (noise)

3. **Conflict handling**: if session context contradicts aggregate (session says "I quit X" but aggregate shows X as `active_recent`), move X to `Recently changed` with both statements and their dates. Do NOT silently overwrite.

4. **Prose, not bullet dumps**: each claim has 1-3 evidence links. No lists of 10 citations.

5. **Emit strict YAML frontmatter** matching state.json's sources snapshot.

### USER.md shape (the artifact)

```markdown
---
generated_at: 2026-04-20T12:00:00Z
generated_from: memex (memory + wiki + current session)
source_conversations: 3193
mode: delta
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
<trajectory=active_recent signals; phrasing like "Currently working on...">

## Interests & recurring themes
<trajectory=active or recurring>
- **<theme>** — <gloss>. Evidence: [...](../memory/...), [wiki:notes/x.md](../wiki/notes/x.md)

## Working style
<from self_statements + questions_asked patterns + modality distribution>

## Projects / active work
<projects with status=active>

## What annoys them / what to avoid
<frustrations>

## What makes them laugh / delight signals
<delights>

## Domains they know deeply
<questions_asked level=expert + self_statements + tool depth>

## Domains they're learning
<questions_asked level=basic; topics with recency but low volume>

## Tools & stack
<tools, grouped by category>

## Historical interests
<declining or dormant — omit unless user asked for history>

## Recently changed
<conflicts: session vs aggregate, with both statements and dates>

## Open questions
<low-confidence signals, things to explore next build>
```

### Evidence link format

Evidence links in USER.md use relative paths from `profile/`:

```markdown
Evidence: [chatgpt 2026-04-15](../memory/chatgpt/2026/04/chatgpt_abc123.md)
```

Links point to raw `.md` files (human-browsable), NOT summary JSONs.

- Wiki citation: `[wiki:notes/tooling.md](../wiki/notes/tooling.md)`
- Session citation: `(stated in this session 2026-04-20)` — no link

### state.json schema

Written alongside USER.md after every successful Layer 3:

```json
{
  "schema_version": 1,
  "generated_at": "2026-04-20T12:00:00Z",
  "generator": "memex-profile-builder",
  "mode": "full" | "delta",
  "pipeline_version": 1,
  "sources": {
    "memory": {
      "conversation_count": 3193,
      "max_created_at": "2026-04-20T08:23:00Z",
      "catalog_sha256": "<sha256 of catalog.jsonl at build time>"
    },
    "wiki": {
      "file_count": 42,
      "digest": "<sha256 of sha256s of all wiki .md files>"
    },
    "conversation_context": {
      "included": true
    }
  },
  "stats": {
    "themes": 12,
    "evidence_citations": 67,
    "backup_path": "profile/backups/USER.md.20260420-120000"
  }
}
```

### Build log (human-readable)

`profile/logs/build-YYYYMMDD-HHMMSS.md` summary of what happened:

```markdown
# Build — 2026-04-20 12:00:00

- Mode: delta
- Duration: 45s
- Memory: +87 new conversations since 2026-04-12T09:11:00Z (total 3193)
- Wiki: 3 files changed
- Layer 2 batches re-extracted: 2

## Themes
- Added: <theme> — evidence: [id1](...), [id2](...)
- Reinforced: <theme> (+3 new citations)
- Unchanged: <N>

## Conversation context consumed
- (stated 2026-04-20): <fact>

## Conflicts resolved
- <theme>: session says X, aggregate says Y → moved to Recently changed

## Sources snapshot
- memory.max_created_at: 2026-04-20T08:23:00Z
- wiki.digest: a3f2...
```

Logs accumulate — never auto-prune. They're the only explanation of *why* a given USER.md looks the way it does.

## Resumability & rate-limit handling

### Per-layer idempotency

| Layer | Skip condition | Artifact granularity |
|---|---|---|
| 1 | summary file exists AND `content_hash` matches current `.md` | one file per convo |
| 2 | batch file exists AND `input_hash` matches current sorted-summary-hash | one file per batch |
| 2.5 | always rerun (deterministic, cheap) | one aggregate.json, overwritten |
| 3 | always rerun if aggregate.json changed OR session context present | one USER.md, backed up before overwrite |

### Rate-limit flow

1. Agent detects rate limit from its LLM call (e.g., 429 or SDK error).
2. Agent returns `{"rate_limited": true, "processed": N, ...}` to the host orchestrator.
3. The host orchestrator writes a `RESUMABLE_STOP` entry to `profile/logs/pipeline-*.log.jsonl`, tells the user:

   > "Pipeline paused at Layer 1, ~1847/3193 conversations summarized. Resume later from the saved checkpoints."

4. The host orchestrator does NOT update `state.json` on paused runs — state.json only updates after Layer 3 succeeds.

### Quota / billing flow

Similar, but message is:

> "Pipeline paused: model quota exhausted. Resume once billing or rate limits restore."

### Per-unit errors (non-rate-limit)

If a single Layer 1 summarize fails (malformed input, model refusal), agent logs to `profile/logs/errors-*.jsonl` with `{conv_id, layer, reason, timestamp}` and continues with the next unit in the batch. Don't fail the whole batch on one bad unit.

### Progress log — JSONL

`profile/logs/pipeline-YYYYMMDD-HHMMSS.log.jsonl` — one line per completed unit:

```jsonl
{"ts": "2026-04-20T12:00:03Z", "layer": 1, "unit": "chatgpt_abc123", "status": "ok"}
{"ts": "2026-04-20T12:00:04Z", "layer": 1, "unit": "chatgpt_def456", "status": "skipped"}
{"ts": "2026-04-20T12:00:05Z", "layer": 1, "unit": "chatgpt_ghi789", "status": "error", "reason": "malformed_frontmatter"}
{"ts": "2026-04-20T12:05:10Z", "layer": 2, "unit": "batch-0042", "status": "ok"}
{"ts": "2026-04-20T12:45:00Z", "layer": 1, "status": "RESUMABLE_STOP", "processed_so_far": 1847, "total": 3193}
```

Tail-readable; survives process death. Resume logic scans for the most recent `RESUMABLE_STOP` and picks up from there.

## Directory layout

```
<workdir>/
├── memory/
│   ├── chatgpt/YYYY/MM/<id>.md                  # raw (unchanged)
│   ├── claude/YYYY/MM/<id>.md
│   ├── summaries/                                # NEW — Layer 1 artifacts
│   │   ├── chatgpt/YYYY/MM/<id>.json
│   │   └── ...
│   ├── catalog.jsonl
│   └── raw/, attachments/
├── wiki/
└── profile/                                      # NEW dedicated folder
    ├── USER.md                                   # the artifact
    ├── state.json                                # source snapshot
    ├── aggregate.json                            # Layer 2.5 output
    ├── extracts/
    │   └── batch-NNNN.json                       # Layer 2 artifacts
    ├── logs/
    │   ├── build-YYYYMMDD-HHMMSS.md
    │   ├── pipeline-YYYYMMDD-HHMMSS.log.jsonl
    │   ├── aggregate-YYYYMMDD-HHMMSS.log         # Layer 2.5 dedupe merges
    │   └── errors-YYYYMMDD-HHMMSS.jsonl
    └── backups/
        └── USER.md.YYYYMMDD-HHMMSS
```

`profile/` is intentionally excluded from qmd indexing (qmd indexes only `memory/` and `wiki/`). Prevents USER.md from dominating semantic search.

## Delta behavior — end to end

Given `N` new conversations since last build:

1. The host orchestrator detects them via `state.json.sources.memory.max_created_at` vs current `catalog.jsonl` max.
2. **Layer 1**: `N` convs need summaries. `ceil(N / 30)` summarizer-agent spawns. Existing summaries skip via content-hash check. Cost: ~$0.001 × N.
3. **Layer 2**: new summaries land in trailing batches. 1-3 batches re-extracted; all prior batches cached. Cost: ~$0.02-0.06.
4. **Layer 2.5**: always rerun. Reads all extracts, rebuilds aggregate.json. No LLM cost.
5. **Layer 3**: 1 opus call on updated aggregate. Cost: ~$0.50.
6. state.json + backup + log written.

Total delta cost: **~$0.55 + $0.001 × N**. Total delta time: **~30-90 seconds for small N**; scales roughly linearly with Layer 1 spawn count.

## Plugin distribution note

Plugin installs are directory-based. When a user installs this plugin, the entire `plugin/` folder copies to the local plugin store. That means sibling files to `SKILL.md` (this `PIPELINE.md`, any future `scripts/`) travel with it — they're just not auto-loaded as skills. `SKILL.md` references them by relative path and reads them lazily when needed.

**Verify**: after plugin installation, confirm the installed plugin copy still contains `skills/memex-profile/PIPELINE.md` and that the skill runtime can read it. Flagged as an open verification item.

## Scope boundaries

This architecture deliberately excludes:

- **qmd integration** — qmd stays for general memex search. Profile build has its own exhaustive path.
- **memex CLI changes** — no TypeScript edits, no Anthropic SDK installs in memex core.
- **Rollup as a script file** — inline jq/bash until complexity justifies extraction to `scripts/rollup.sh`.
- **Fuzzy-match dedupe** — synonym table + exact match is v1. Levenshtein deferred.
- **Multi-user support** — one human per workdir.
