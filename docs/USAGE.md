# Hướng dẫn sử dụng: memex + qmd

## Tổng quan

```
AI platforms  ──►  memex sync  ──►  ~/.memex/memory/  ──►  qmd index  ──►  search
```

Hai phase tách biệt:
- **Phase 1 — memex**: thu thập và normalize conversations từ các AI platforms
- **Phase 2 — qmd**: index và search những file đó

---

## Setup tạm (chưa install qmd global)

Thêm alias vào shell — chạy 1 lần mỗi session, hoặc thêm vào `~/.zshrc` để dùng lâu dài:

```sh
alias qmd="npx tsx /Users/apple/Desktop/personal_data/qmd/src/cli/qmd.ts"
```

Sau đó tất cả lệnh `qmd ...` trong file này đều chạy được bình thường.

---

## Phase 1 — memex

### Setup lần đầu

```sh
cd ~/Desktop/personal_data/memex
bun install
bun link            # cài global command `memex`

memex init          # tạo ~/.memex/ structure
```

### Sync Claude Code (tự động hoàn toàn)

```sh
memex sync claude_code
```

Chạy bất kỳ lúc nào — đọc trực tiếp từ `~/.claude/projects/**/*.jsonl`.

---

### Sync ChatGPT (semi-manual)

**Bước 1** — Lấy browser snippet:
```sh
memex sync-script chatgpt
```

**Bước 2** — Mở [chatgpt.com](https://chatgpt.com) → DevTools (`F12`) → Console → paste → Enter → chờ download.

**Bước 3** — Move file và sync:
```sh
mv ~/Downloads/chatgpt_*.json ~/.memex/memory/raw/chatgpt/
memex sync chatgpt
```

---

### Sync Claude.ai (semi-manual)

```sh
memex sync-script claude
# → paste vào claude.ai Console
mv ~/Downloads/claude_*.json ~/.memex/memory/raw/claude_web/
memex sync claude
```

---

### Sync Gemini (semi-manual)

```sh
memex sync-script gemini
# → paste vào gemini.google.com Console
mv ~/Downloads/gemini_*.json ~/.memex/memory/raw/gemini/
memex sync gemini
```

---

### Sync Grok (semi-manual)

```sh
memex sync-script grok
# → paste vào grok.com Console
mv ~/Downloads/grok_*.json ~/.memex/memory/raw/grok/
memex sync grok
```

Grok script chạy trong tab đang đăng nhập và dùng browser cookies qua `credentials: include`. File download có timestamp dạng `grok_YYYYMMDD_HHMMSSZ.json`.

---

### Sync DeepSeek (semi-manual)

```sh
memex sync-script deepseek
# → paste vào chat.deepseek.com Console
mv ~/Downloads/deepseek_*.json ~/.memex/memory/raw/deepseek/
memex sync deepseek
```

DeepSeek script lấy `userToken` runtime từ `localStorage`/`sessionStorage` của `chat.deepseek.com`, sau đó gọi API session list và `history_messages`. Không hardcode token/cookie từ HAR và không ghi token vào file export.

Nếu gặp `Missing Token`, refresh DeepSeek rồi kiểm tra Application → Local Storage có key `userToken`. Khi debug chỉ gửi tên key, không gửi giá trị token.

---

### Browser script security

Các script trong `src/browser-scripts/` được thiết kế để chạy stateless theo tab/account hiện tại:

- Không chứa cookie, bearer token, API key, hoặc token copy từ HAR.
- Auth được lấy runtime từ browser đang đăng nhập.
- File export chỉ chứa conversation data, không chứa browser cookie/token.
- `memex sync-script` chỉ inject `SINCE_DATE` và `KNOWN_IDS` từ local sync state để incremental sync; đây không phải secret.

---

### Sync tất cả / kiểm tra trạng thái

```sh
memex sync           # sync tất cả sources
memex sync --dry-run # preview, không ghi file
memex status         # xem số conversations đã sync theo source
```

---

## Backup / restore profile

```sh
memex export                         # tạo ./memex-profile-YYYYMMDD-HHMMSS.tar.gz
memex export ~/backup/memex.tar.gz   # ghi ra file cụ thể

memex verify ~/backup/memex.tar.gz   # kiểm tra backup trước khi restore
memex import ~/backup/memex.tar.gz
memex import ~/backup/memex.tar.gz --replace
```

- `memex export` backup toàn bộ `~/.memex/`: memory, wiki, scripts, state, logs.
- Backup có top-level `.memex/` và manifest strict `memex-backup.json`.
- `memex verify` kiểm tra tar, manifest, và profile folders mà không mutate `~/.memex/`.
- `memex import` sẽ fail nếu `~/.memex/` đã tồn tại.
- `--replace` không xoá profile cũ; nó move profile hiện tại sang `~/.memex.backup-YYYYMMDD-HHMMSS` trước khi restore.

---

## Phase 2 — qmd

### Setup lần đầu (chỉ chạy 1 lần)

```sh
# Đăng ký collections
qmd collection add ~/.memex/memory --name memex-memory
qmd collection add ~/.memex/wiki --name memex-wiki

# Thêm context để LLM hiểu từng collection
qmd context add qmd://memex-memory "Personal AI chat history: ChatGPT, Claude, Gemini, Grok, DeepSeek, Claude Code, Codex, OpenClaw conversations"
qmd context add qmd://memex-wiki "Curated personal wiki, domain notes, profile"

# Index files (nhanh, chỉ scan .md)
qmd update

# Generate embeddings (chậm lần đầu — tải models ~2GB, chạy background được)
qmd embed
```

> **Lưu ý**: `qmd embed` tải models về `~/.cache/qmd/models/` lần đầu (~2GB). Các lần sau nhanh hơn nhiều.

---

### Update index sau mỗi memex sync

```sh
memex sync && qmd update
# embed chỉ cần chạy lại nếu có nhiều file mới
qmd embed
```

---

### Search commands

#### `qmd search` — BM25 keyword search (nhanh, không cần LLM)

```sh
qmd search "sourdough hydration"
qmd search "react hooks" -c memex-memory        # chỉ trong chat history
qmd search "screenwriting" -c memex-wiki        # chỉ trong wiki
qmd search "docker" -n 10                       # lấy 10 kết quả
qmd search "auth" --all --min-score 0.3         # tất cả kết quả trên ngưỡng
```

#### `qmd vsearch` — Vector semantic search (cần embed, không cần LLM reranker)

```sh
qmd vsearch "cách ngủ ngon hơn"
qmd vsearch "lý do tại sao code chậm"
```

#### `qmd query` — Hybrid search (tốt nhất, dùng LLM expansion + reranking)

```sh
qmd query "tôi hay bàn gì về sleep"
qmd query "các vấn đề với authentication flow"
qmd query "câu hỏi về LLM context window" -c memex-memory
qmd query "kỹ thuật viết kịch bản" -n 10 --min-score 0.4
```

> `qmd query` = chất lượng cao nhất nhưng chậm hơn (chạy LLM). Dùng `qmd search` khi cần nhanh.

---

### Lấy nội dung document

```sh
# Lấy file theo path (relative trong collection)
qmd get "chatgpt/2026/04/chatgpt_abc123.md"

# Lấy theo docid (hiện trong search results dạng #abc123)
qmd get "#abc123"
qmd get "#abc123" --full          # toàn bộ file, không cắt
qmd get "#abc123" --line-numbers  # kèm số dòng

# Lấy từ dòng cụ thể
qmd get "chatgpt/2026/04/chatgpt_abc123.md:50" -l 100   # từ dòng 50, tối đa 100 dòng

# Lấy nhiều files cùng lúc
qmd multi-get "chatgpt/2026/04/*.md"
qmd multi-get "#abc123, #def456, #ghi789"
qmd multi-get "chatgpt/2026/04/*.md" --max-bytes 20480   # bỏ qua file > 20KB
```

---

### Output formats (cho agent/scripting)

```sh
qmd search "auth" --json          # JSON với snippets
qmd search "auth" --files         # docid,score,filepath,context (1 dòng/kết quả)
qmd search "auth" --md            # Markdown
qmd query "auth" --json -n 10     # JSON, 10 kết quả
qmd multi-get "*.md" --json       # batch retrieve dạng JSON
```

---

### Kiểm tra trạng thái index

```sh
qmd status                        # tổng quan: số docs, collections, model status
qmd collection list               # danh sách collections với số docs
qmd ls memex-memory               # liệt kê files trong collection
qmd ls memex-memory/chatgpt/2026  # liệt kê files trong subfolder
qmd context list                  # xem toàn bộ contexts đã set
```

---

### Quản lý collections

```sh
qmd collection list
qmd collection remove memex-memory    # xoá collection (không xoá files)
qmd collection rename memex-memory memex-chat  # đổi tên

qmd context rm qmd://memex-memory     # xoá context
qmd context add qmd://memex-memory "..." # set lại context

qmd cleanup                           # dọn cache và orphaned data
```

---

### MCP Server (cho Claude Code / Claude Desktop)

```sh
# Chạy foreground
qmd mcp

# Chạy background daemon (HTTP transport — share model giữa nhiều clients)
qmd mcp --http --daemon    # start, port mặc định 8181
qmd mcp stop               # stop daemon

# Kiểm tra daemon đang chạy không
qmd status                 # hiện "MCP: running (PID ...)" nếu đang chạy
```

Config Claude Code (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "qmd": {
      "command": "qmd",
      "args": ["mcp"]
    }
  }
}
```

---

## Workflow hàng ngày

```sh
# Claude Code sync tự động — chạy sau mỗi session
memex sync claude_code

# Web platforms — 1-2 lần/tuần
memex sync-script chatgpt   # lấy snippet, paste vào browser
mv ~/Downloads/chatgpt_*.json ~/.memex/memory/raw/chatgpt/
memex sync chatgpt

memex sync-script deepseek  # tương tự cho deepseek/grok/gemini/claude
mv ~/Downloads/deepseek_*.json ~/.memex/memory/raw/deepseek/
memex sync deepseek

# Cập nhật index
qmd update

# Search
qmd search "keyword nhanh"
qmd query "câu hỏi tự nhiên"
```

---

## Cấu trúc ~/.memex/

```
~/.memex/
├── memory/        ← .md conversations (qmd index)
│   ├── chatgpt/2026/04/*.md
│   ├── claude_web/
│   ├── claude_code/
│   ├── gemini/
│   ├── grok/
│   ├── deepseek/
│   ├── codex/
│   ├── openclaw/
│   ├── raw/           ← JSON exports gốc (không index)
│   │   ├── chatgpt/
│   │   ├── claude_web/
│   │   ├── gemini/
│   │   ├── grok/
│   │   └── deepseek/
│   └── attachments/   ← binary files (không index)
├── wiki/          ← curated notes (qmd index)
│   ├── domains/
│   └── references/    ← tham khảo thô (không index)
├── state/sync.db  ← dedup tracking
└── logs/
```

qmd index store riêng tại: `~/.cache/qmd/index.sqlite`
