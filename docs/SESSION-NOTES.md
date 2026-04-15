# MEMEX — Session Notes

> Tài liệu ghi lại những gì đã làm, quyết định thiết kế, và trạng thái hiện tại.
> Đọc file này trước khi bắt đầu session tiếp theo.

---

## Trạng thái hiện tại (2026-04-14)

### Đã làm xong

- **Toàn bộ codebase** tại `/Users/apple/Desktop/personal_data/memex/`
- **Profile `~/.memex/`** đã khởi tạo và có dữ liệu thật
- **3,010 conversations đã sync** từ 4 platforms:
  - ChatGPT: 2,479 conversations
  - Gemini: 327 conversations
  - Claude Web: 187 conversations
  - Claude Code: 17 sessions
- **Browser scripts tích hợp vào memex** (`src/browser-scripts/`):
  - Scripts từ Migration-Kit đã copy vào + thêm incremental sync qua `SINCE_DATE`
  - ChatGPT & Claude.ai: stop pagination sớm khi gặp conversations cũ hơn SINCE_DATE
  - Gemini: vẫn fetch all (DOM scraper, không có timestamps)
- **`memex sync-script <source>`**: generate snippet đã điền SINCE_DATE từ sync.db

### Chưa làm

- `memex watch` daemon
- Attachment handling thực sự
- `memex ingest` command
- MCP server

---

## Kiến trúc đã chốt

### Nguyên tắc cốt lõi

1. **Chỉ 2 thứ cần code**: sync (crawl từ platform) + convert (normalize sang .md)
2. **Immutable memory, mutable wiki**: `memory/` chỉ memex ghi, `wiki/` agent + user ghi
3. **Tách searchable khỏi non-searchable**: `memory/` và `wiki/` chỉ chứa `.md` — qmd index an toàn. Raw JSON → `raw/`, binary → `attachments/`, tham khảo thô → `references/`
4. **qmd chỉ nhận .md**: format markdown với `##` heading per message tối ưu cho qmd chunking
5. **Incremental + idempotent**: sync.db track hash, re-run safe

### Quyết định kỹ thuật

| Quyết định | Lựa chọn | Lý do |
|------------|----------|-------|
| Runtime | Bun | Nhanh, native TypeScript |
| SQLite | `bun:sqlite` | better-sqlite3 không hỗ trợ Bun |
| Timestamps không có | Empty string `''` | Tránh `new Date()` non-deterministic → hash thay đổi mỗi lần |
| Tool output | Truncate ở 2000 chars | Tránh file quá lớn |
| Gemini timestamps | Thường là 0 | Platform scrape, không có real timestamp |

---

## Cấu trúc file quan trọng

```
memex/
├── README.md                        ← hướng dẫn đầy đủ cho user
├── SESSION-NOTES.md                 ← file này
├── src/
│   ├── cli/
│   │   ├── main.ts                  ← entry: parse argv, route command
│   │   ├── init.ts                  ← tạo ~/.memex/ dirs
│   │   ├── sync.ts                  ← orchestrator: chạy adapters, ghi .md, cập nhật db
│   │   ├── status.ts                ← query sync.db, in bảng
│   │   └── sync-script.ts           ← generate browser snippet với SINCE_DATE
│   ├── browser-scripts/
│   │   ├── chatgpt.js               ← export ChatGPT (incremental, stop early khi gặp cũ)
│   │   ├── claude.js                ← export Claude.ai (incremental)
│   │   └── gemini.js                ← export Gemini (DOM scrape, full)
│   ├── adapters/
│   │   ├── base.ts                  ← interface Adapter { source; sync(): AsyncIterable<Conversation> }
│   │   ├── claude_code.ts           ← đọc ~/.claude/projects/**/*.jsonl
│   │   ├── chatgpt.ts               ← đọc _original/*.json (Migration-Kit format)
│   │   ├── claude_web.ts            ← đọc _original/*.json (Migration-Kit format)
│   │   └── gemini.ts                ← đọc _original/*.json (Migration-Kit format)
│   ├── normalize/
│   │   ├── schema.ts                ← Conversation | Message | ContentBlock types
│   │   └── markdown.ts              ← conversationToMarkdown() → string
│   └── profile/
│       ├── paths.ts                 ← paths.root, paths.syncDb, paths.conversationFile()...
│       └── state.ts                 ← checkSync() | recordSync() | getStats() | closeDb()
└── package.json
```

---

## Data sources — chi tiết kỹ thuật

### Claude Code (`src/adapters/claude_code.ts`)
- **Path**: `~/.claude/projects/<encoded-dir>/<session-id>.jsonl`
- **Format**: JSONL — mỗi dòng 1 JSON event
- **Event types quan trọng**: `user`, `assistant`, `ai-title`
- **Skip**: `isSidechain: true`, `isMeta: true`, event type `tool_result` từ user
- **Title**: lấy từ event `ai-title.aiTitle`, fallback về sessionId
- **Tool use**: content block `type: "tool_use"` với `name` và `input` (object → stringify)
- **Thinking**: content block `type: "thinking"`

### ChatGPT (`src/adapters/chatgpt.ts`)
- **Path**: `~/.memex/memory/chatgpt/_original/*.json`
- **Format**: `{ conversations: [...] }` — Migration-Kit export
- **Timestamps**: `create_time`/`update_time` là ISO string, message `timestamp` là Unix number
- **Branches**: field `has_branches` — export đã flatten (selected branch) rồi, không cần xử lý

### Claude Web (`src/adapters/claude_web.ts`)
- **Path**: `~/.memex/memory/claude_web/_original/*.json`
- **Format**: tương tự ChatGPT nhưng timestamps là Unix number (không phải ISO)
- **Đơn giản hơn**: flat message list, không có branches

### Gemini (`src/adapters/gemini.ts`)
- **Path**: `~/.memex/memory/gemini/_original/*.json`
- **Format**: tương tự Claude Web
- **Vấn đề**: `timestamp = 0` rất phổ biến (scrape không lấy được) → convert về `''`
- **IDs**: dạng hex (`004465b04b58c75e`), không phải UUID

---

## Migration-Kit scripts

Nằm ở `/Users/apple/Desktop/personal_data/GPT2Claude-Migration-Kit/`:

| Script | Platform | Cách dùng |
|--------|----------|-----------|
| `migrate.js` | ChatGPT | Paste vào Console tại chatgpt.com |
| `migrate_claude.js` | Claude.ai | Paste vào Console tại claude.ai |
| `migrate_gemini.js` | Gemini | Paste vào Console tại gemini.google.com |

Output format đã được Migration-Kit chuẩn hoá — memex adapters chỉ cần đọc format này.

---

## Workflow sync thực tế

### Tự động (Claude Code)
```sh
memex sync claude_code   # chạy bất kỳ lúc nào
```

### Thủ công (web platforms) — 1-2 lần/tuần
```sh
# 1. Export từ browser (xem README.md để biết cách)
# 2. Move file vào đúng chỗ:
mv ~/Downloads/chatgpt_all_conversations.json \
   ~/.memex/raw/chatgpt/chatgpt_$(date +%Y%m%d).json

# 3. Sync (chỉ process phần mới)
memex sync chatgpt
```

### Toàn bộ
```sh
memex sync      # sync tất cả sources
memex status    # kiểm tra kết quả
```

---

## Tích hợp qmd

```sh
# Setup 1 lần
qmd collection add ~/.memex/memory --name memex-memory
qmd collection add ~/.memex/wiki --name memex-wiki
qmd context add qmd://memex-memory "Personal AI chat history: ChatGPT, Claude, Gemini, Claude Code conversations"
qmd context add qmd://memex-wiki "Curated personal wiki, domain notes, profile"
qmd update && qmd embed

# Dùng hàng ngày
qmd search "keyword"
qmd query "câu hỏi tự nhiên"
qmd search "topic" -c memex-memory   # chỉ search trong chat history
```

qmd index store tại `~/.cache/qmd/index.sqlite` — không nằm trong `~/.memex/`.

**Tại sao 2 collections**: `memory/` (raw chat history) và `wiki/` (curated notes) có tính chất khác nhau — tách collection giúp search có mục tiêu hơn.

---

## Những gì KHÔNG làm trong session này

1. **Attachment handling** — logic copy file đính kèm vào `memory/attachments/`, hiện chỉ có placeholder trong schema
2. **`memex watch`** — fswatch daemon để auto-sync Claude Code realtime
3. **`memex ingest <file>`** — manual ingest 1 file bất kỳ không cần drop vào `_original/`
4. **Wiki layer** — folder structure đã tạo nhưng không có tooling gì, dùng tay hoặc agent ghi trực tiếp

---

## Bugs đã gặp và fix

### `bun:sqlite` thay vì `better-sqlite3`
- **Vấn đề**: `better-sqlite3` không support Bun runtime
- **Fix**: import từ `bun:sqlite` thay vì `better-sqlite3`

### Gemini hash thay đổi mỗi lần sync
- **Vấn đề**: `timestamp = 0` → `new Date().toISOString()` trả về current time → hash khác mỗi run → infinite updates
- **Fix**: `toIso(0)` trả về `''` thay vì current time

---

## Để tiếp tục trong session khác

Đọc file này + README.md là đủ context.

Những việc có thể làm tiếp:
1. **`memex watch`**: dùng `fs.watch()` của Bun watch `~/.claude/projects/`, trigger `sync claude_code` khi có file mới/thay đổi
2. **Attachment**: trong `ClaudeCodeAdapter`, xử lý event type `attachment` thực sự (hiện đang bỏ qua)
3. **Wiki layer**: tạo convention + template cho `~/.memex/wiki/` — profile.md, CLAUDE.md instructions cho agent
