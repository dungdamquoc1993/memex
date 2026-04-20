# Ghi chú dự án QMD (tóm tắt cho Agent)

Tài liệu này tóm tắt các điểm chính đã làm rõ khi đọc repo QMD: mục tiêu dự án, vì sao có thư mục `finetune/`, QMD dùng các model nào, HyDE có vai trò gì, yêu cầu phần cứng, ingest dữ liệu ra sao, và cách tích hợp với agent (CLI/MCP/HTTP + skill).

## QMD là gì?

**QMD (Query Markup Documents)** là một **search engine chạy local** cho knowledge base (notes/docs/transcripts/code…). QMD kết hợp:

- **BM25 (SQLite FTS5)**: tìm kiếm theo từ khoá (nhanh, exact match tốt)
- **Vector search (sqlite-vec)**: tìm kiếm theo ngữ nghĩa (semantic)
- **LLM reranking**: chấm lại top ứng viên để sắp xếp kết quả tốt hơn
- **Query expansion (fine-tuned)**: mở rộng/viết lại query thành các “sub-queries” phục vụ từng backend

Index mặc định được lưu trong một file SQLite: `~/.cache/qmd/index.sqlite`.

## Vì sao repo có `finetune/` (Python)?

Thư mục `finetune/` tồn tại để **fine-tune model dùng cho bước Query Expansion** trong pipeline hybrid search của QMD.

- Base model: `Qwen/Qwen3-1.7B`
- Output mục tiêu: tạo các dòng có prefix **`hyde:`**, **`lex:`**, **`vec:`**
- Sau đó chuyển sang **GGUF** để chạy local bằng `node-llama-cpp`

Điểm quan trọng:

- `finetune/` là **tooling R&D/training**, không phải runtime chính của CLI.
- Khi dùng QMD “bình thường”, bạn **không cần tự train**: QMD tải model GGUF đã fine-tune về cache và chạy local.

## QMD dùng những model nào?

QMD dùng **3 loại model** (đều là local GGUF qua `node-llama-cpp`):

- **Embedding model**: tạo vector cho document chunks và query
- **Generate model**: dùng để query expansion (sinh `lex/vec/hyde`)
- **Reranker model**: rerank top ứng viên sau khi fusion

Trong `src/llm.ts` các default model là HuggingFace URIs dạng `hf:<org>/<repo>/<file.gguf>` (QMD sẽ tự tải về cache).

### Có đổi model được không?

Có. QMD hỗ trợ override bằng biến môi trường:

- `QMD_EMBED_MODEL`
- `QMD_GENERATE_MODEL`
- `QMD_RERANK_MODEL`

Bạn có thể trỏ tới:

- URI `hf:...` (tải từ HuggingFace)
- hoặc **đường dẫn local** tới file `.gguf`

### Có hỗ trợ API (OpenAI/Anthropic) hoặc “self-host qua HTTP” không?

Hiện tại, backend LLM của QMD là **`node-llama-cpp` + GGUF local**. Repo không có connector “API key / HTTP endpoint” cho OpenAI/Anthropic/Ollama/vLLM theo kiểu plug-and-play.

Kiến trúc có interface `LLM` (có thể mở rộng), nhưng **implementation hiện tại** là local GGUF.

## Prefix `lex/vec/hyde` để làm gì?

Prefix là “giao thức” để QMD **định tuyến** sub-query tới đúng nhánh retrieval.

- **`lex:`** → BM25 (FTS5)
  - Tối ưu exact match: tên hàm, option, error codes, cụm từ chính xác…
- **`vec:`** → vector search
  - Viết lại query thành câu tự nhiên/diễn giải để embedding hiệu quả hơn
- **`hyde:`** → HyDE route (vẫn là vector search)
  - Sinh một “đoạn tài liệu giả định” trông giống câu trả lời, rồi embed đoạn đó để truy hồi

### HyDE là “engine” hay “làm giàu query”?

HyDE đúng là **làm giàu query**, nhưng trong pipeline retrieval, HyDE tạo ra **một ranked list riêng** (vector search trên embedding của “hypothetical passage”), nên có thể coi như **một nhánh retrieval** (route) song song với `vec`.

## Yêu cầu GPU/CPU (máy không có GPU có dùng được không?)

**Không bắt buộc GPU.** QMD có thể chạy CPU-only, nhưng tốc độ sẽ phụ thuộc chế độ bạn dùng:

- **`qmd search` (BM25 only)**: nhẹ nhất, không cần model
- **`qmd vsearch` (vector)**: cần embedding (CPU được, nhưng chậm hơn)
- **`qmd query` (hybrid)**: có thể gọi expansion + rerank → nặng hơn trên CPU

CLI có tuỳ chọn **`--no-rerank`** để bỏ bước reranking LLM (nhẹ hơn đáng kể trên CPU).

## Vì sao phải “embed document”? QMD có phải chỉ là query engine không?

QMD là một hệ thống “store + index + query”:

- BM25 cần **FTS index**
- Vector search cần **vector index**

Vector index yêu cầu QMD:

1. chia tài liệu thành chunks
2. embed từng chunk
3. lưu vectors vào SQLite (sqlite-vec)

Đó là lý do có lệnh `qmd embed`. Nếu bạn không embed, bạn vẫn dùng được BM25 nhưng vector/hybrid sẽ hạn chế.

### Có thể tự ingest dữ liệu trước rồi “chỉ dùng QMD để query” không?

Có thể ở mức “đưa dữ liệu vào filesystem có tổ chức” rồi để QMD ingest/index theo đúng pipeline của nó.

**Không khuyến nghị** tự ghi trực tiếp vào SQLite của QMD (schema + FTS + vectors + docid/hash + cache keys… dễ lệch và khó debug).

## Input nên chuẩn bị thế nào?

QMD ingest theo **filesystem collections + glob pattern**. Thực tế tốt nhất:

- Chuẩn bị dữ liệu dạng **text files**: `.md`/`.txt`/code…
- Nếu dữ liệu gốc là JSON “nhiều record”, thường nên:
  - tách **mỗi record thành một file** (dễ `get`, dễ đặt title/context),
  - hoặc giữ `.json` như text nếu bạn chấp nhận trải nghiệm đọc/snippet kém hơn.

Gợi ý tổ chức:

- **Một record = một file**
- **Thư mục = ngữ cảnh** (kết hợp `qmd context add` để mô tả)
- Đặt tên file có ý nghĩa (ngày, id ticket, chủ đề…)

Lưu ý:

- **Docid** dựa trên content hash → sửa nội dung lớn có thể làm docid đổi
- Đổi embedding model → cần **re-embed** (`qmd embed -f`)

## Update/Embed có incremental không? Có tự “nghe filesystem” không?

### `qmd update` (re-index)

- **Có incremental theo nội dung**: mỗi lần chạy, QMD vẫn **scan danh sách file** trong collection theo glob, nhưng với từng file nó so **content hash**:
  - hash không đổi → `unchanged` (không ghi lại content)
  - hash đổi → `updated`
  - file mới → `indexed`
- **File bị xoá**: QMD sẽ **deactivate** document (không còn xuất hiện khi query). QMD cũng dọn **orphaned content** (text không còn doc active nào trỏ tới) trong lần update.

Lưu ý: embeddings/vectors “cũ” của các hash không còn active có thể vẫn nằm trong DB cho tới khi chạy cleanup/maintenance tương ứng, nhưng điều này thường **không làm sai kết quả** vì query chỉ lấy document active.

### `qmd embed` (vector)

- **Có incremental theo hash**: mặc định chỉ embed các hash/chunks còn thiếu vectors.
- Chỉ khi dùng `-f` (force) mới re-embed toàn bộ.

### Có tự động update khi bạn thêm file không?

Không có file watcher. Bạn cần **tự chạy** `qmd update` (và `qmd embed` nếu muốn cập nhật vector/hybrid), hoặc tự lên lịch/script để chạy định kỳ.

## Tích hợp với Agent: CLI vs MCP vs HTTP daemon + Skill

QMD có các cách để agent dùng:

- **CLI**: agent chạy `qmd ...` và parse output
  - Ưu: đơn giản
  - Nhược: mỗi lần chạy có overhead khởi tạo/model

- **MCP server (stdio)**: `qmd mcp`
  - Thường client MCP sẽ spawn subprocess (không nhất thiết bạn phải chạy daemon)

- **MCP qua HTTP / daemon**: `qmd mcp --http` và `qmd mcp --http --daemon`
  - Phù hợp chạy như **service** để **giữ model nóng** và giảm latency
  - Có endpoint `/mcp` và `/health`

- **Skill**: QMD có “embedded skill” để agent (Claude/Agents) biết cách gọi QMD đúng chuẩn.
  - Skill là lớp hướng dẫn/tích hợp; engine vẫn là QMD CLI/MCP.

