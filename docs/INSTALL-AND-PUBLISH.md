# Cài đặt & Publish memex

## Nguồn gốc của memex

Package tên là `@dungdq3/memex`, published trên npm registry dưới scoped package của tác giả.

- **npm**: https://www.npmjs.com/package/@dungdq3/memex
- **GitHub**: https://github.com/dungdamquoc1993/memex
- **Runtime yêu cầu**: Bun ≥ 1.3.0

Khi cài bằng bun, binary `memex` được symlink tại:

```
~/.bun/bin/memex → ~/.bun/install/global/node_modules/@dungdq3/memex/bin/memex
```

Để kiểm tra memex đang đến từ đâu:

```bash
which memex
# → /Users/<user>/.bun/bin/memex

ls -la $(which memex)
# → symlink trỏ về ~/.bun/install/global/node_modules/@dungdq3/memex/bin/memex

memex --version   # in version đang cài
memex doctor      # full env + profile health check
```

---

## Cài đặt

### 1. Cài từ npm registry (khuyến nghị — dùng bun)

```bash
bun install -g @dungdq3/memex
```

Sau khi cài, lệnh `memex` có sẵn trong terminal.

### 2. Cài từ npm registry — dùng npm

```bash
npm install -g @dungdq3/memex
```

> Lưu ý: package yêu cầu Bun làm runtime, nên dù cài qua npm thì vẫn cần Bun được cài trên máy.

### 3. Cài từ source (local development)

```bash
# Clone repo
git clone https://github.com/dungdamquoc1993/memex.git
cd memex

# Cài dependencies
bun install

# Chạy trực tiếp từ source (không cần build)
bun src/cli/main.ts

# Hoặc link global để dùng lệnh memex ở bất kỳ đâu
bun link             # tạo link trong dự án
bun link @dungdq3/memex  # dùng ở terminal
```

---

## Update version

### Kiểm tra version hiện tại

```bash
# Version đang cài
memex --version          # hoặc memex -v

# Version mới nhất trên npm
npm view @dungdq3/memex version

# Kiểm tra toàn diện (bun, paths, db, version so với npm)
memex doctor
```

### Update lên version mới nhất

```bash
# Dùng bun (khuyến nghị)
bun install -g @dungdq3/memex@latest

# Dùng npm
npm update -g @dungdq3/memex
```

### Update lên version cụ thể

```bash
bun install -g @dungdq3/memex@0.5.0
```

---

## Publish lên npm

### Yêu cầu trước khi publish

1. Đã login npm:

```bash
npm login
# Hoặc kiểm tra đang login chưa:
npm whoami
```

2. Đang ở trong thư mục project (`memex/`)

### Quy trình publish

Package có sẵn các script release trong `package.json`:

```bash
# Bump patch version (0.4.1 → 0.4.2) rồi publish
npm run release:patch

# Bump minor version (0.4.1 → 0.5.0) rồi publish
npm run release:minor

# Bump major version (0.4.1 → 1.0.0) rồi publish
npm run release:major
```

Mỗi script trên sẽ:
1. Chạy `npm version <type>` — tự động cập nhật `version` trong `package.json` và tạo git tag
2. Chạy `npm publish` — upload lên npm registry

### Publish thủ công (kiểm soát hơn)

```bash
# Bước 1: Sửa version trong package.json thủ công, hoặc dùng npm version
npm version patch          # patch: bug fix
npm version minor          # minor: tính năng mới, backward compatible
npm version major          # major: breaking changes

# Bước 2: Dry-run để kiểm tra trước (xem file nào sẽ được upload)
npm run release:dry
# hoặc
npm publish --dry-run

# Bước 3: Publish thật
npm run release
# hoặc
npm publish
```

### Kiểm tra sau khi publish

```bash
# Xem version mới trên registry
npm view @dungdq3/memex

# Cài lại để test
bun install -g @dungdq3/memex@latest
memex --version
```

---

## Quy ước đặt version (Semantic Versioning)

| Loại thay đổi | Ví dụ | Command |
|---|---|---|
| Bug fix, hotfix | `0.4.1 → 0.4.2` | `npm run release:patch` |
| Tính năng mới, không phá vỡ API | `0.4.1 → 0.5.0` | `npm run release:minor` |
| Breaking change (thay đổi CLI args, bỏ lệnh cũ) | `0.4.1 → 1.0.0` | `npm run release:major` |

---

## Files được publish lên npm

Chỉ các file/folder trong trường `files` của `package.json` được upload:

```json
"files": ["bin", "src", "README.md", "LICENSE"]
```

Source TypeScript (`src/`) được ship trực tiếp — Bun compile on-the-fly khi chạy, không cần pre-build.
