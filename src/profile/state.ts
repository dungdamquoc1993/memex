import { Database } from 'bun:sqlite';
import { writeFile } from 'fs/promises';
import { paths } from './paths.ts';
import { createHash } from 'crypto';

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    db = new Database(paths.syncDb);
    db.run('PRAGMA journal_mode = WAL');
    db.run(`
      CREATE TABLE IF NOT EXISTS sync_state (
        source TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (source, conversation_id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        model TEXT,
        project TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        word_count INTEGER NOT NULL,
        original_url TEXT,
        file_path TEXT NOT NULL
      )
    `);
  }
  return db;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export type SyncAction = 'skip' | 'insert' | 'update';

export function checkSync(source: string, conversationId: string, contentHash: string): SyncAction {
  const row = getDb().prepare(
    'SELECT content_hash FROM sync_state WHERE source = ? AND conversation_id = ?'
  ).get(source, conversationId) as { content_hash: string } | undefined;

  if (!row) return 'insert';
  if (row.content_hash === contentHash) return 'skip';
  return 'update';
}

export function recordSync(source: string, conversationId: string, contentHash: string): void {
  getDb().prepare(`
    INSERT INTO sync_state (source, conversation_id, content_hash, last_synced_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(source, conversation_id) DO UPDATE SET
      content_hash = excluded.content_hash,
      last_synced_at = excluded.last_synced_at
  `).run(source, conversationId, contentHash);
}

export function getStats(source?: string): { source: string; count: number; last_sync: string }[] {
  const query = source
    ? `SELECT source, COUNT(*) as count, MAX(last_synced_at) as last_sync FROM sync_state WHERE source = ? GROUP BY source`
    : `SELECT source, COUNT(*) as count, MAX(last_synced_at) as last_sync FROM sync_state GROUP BY source`;
  return (source
    ? getDb().prepare(query).all(source)
    : getDb().prepare(query).all()
  ) as { source: string; count: number; last_sync: string }[];
}

export function getSyncedIds(source: string): string[] {
  return (getDb()
    .prepare('SELECT conversation_id FROM sync_state WHERE source = ?')
    .all(source) as { conversation_id: string }[])
    .map(r => r.conversation_id);
}

export interface ConversationRow {
  id: string;
  source: string;
  title: string;
  model: string | null;
  project: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  word_count: number;
  original_url: string | null;
  file_path: string;
}

export function upsertConversation(
  id: string, source: string, title: string, model: string | null,
  project: string | null, createdAt: string, updatedAt: string,
  messageCount: number, wordCount: number, originalUrl: string | undefined,
  filePath: string,
): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO conversations
      (id, source, title, model, project, created_at, updated_at, message_count, word_count, original_url, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, source, title, model, project, createdAt, updatedAt, messageCount, wordCount, originalUrl ?? null, filePath);
}

export interface QueryOpts {
  source?: string;
  sources?: string[];
  since?: string;
  until?: string;
  model?: string;
  project?: string;
  search?: string;
  limit?: number;
  orderBy?: string;
}

export function queryConversations(opts: QueryOpts = {}): ConversationRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.sources && opts.sources.length > 0) {
    const placeholders = opts.sources.map(() => '?').join(', ');
    conditions.push(`source IN (${placeholders})`);
    params.push(...opts.sources);
  } else if (opts.source) {
    conditions.push('source = ?');
    params.push(opts.source);
  }
  if (opts.since) { conditions.push('created_at >= ?'); params.push(opts.since); }
  if (opts.until) { conditions.push('created_at <= ?'); params.push(opts.until); }
  if (opts.model) { conditions.push('model = ?'); params.push(opts.model); }
  if (opts.project) { conditions.push('project LIKE ?'); params.push(`%${opts.project}%`); }
  if (opts.search) { conditions.push('title LIKE ?'); params.push(`%${opts.search}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const order = opts.orderBy ?? 'created_at DESC';
  const limit = opts.limit ? `LIMIT ${opts.limit}` : '';

  return getDb().prepare(`SELECT * FROM conversations ${where} ORDER BY ${order} ${limit}`).all(...params) as ConversationRow[];
}

export function allConversations(): ConversationRow[] {
  return getDb().prepare('SELECT * FROM conversations ORDER BY created_at DESC').all() as ConversationRow[];
}

export function conversationCount(): number {
  return (getDb().prepare('SELECT COUNT(*) as cnt FROM conversations').get() as { cnt: number }).cnt;
}

export function clearConversations(): void {
  getDb().run('DELETE FROM conversations');
}

export async function exportIndex(): Promise<void> {
  const rows = allConversations(); // sorted by created_at DESC

  // Group: source → "YYYY/MM" → rows
  const tree = new Map<string, Map<string, ConversationRow[]>>();
  for (const r of rows) {
    const ym = r.created_at.slice(0, 7).replace('-', '/'); // "2026/04"
    if (!tree.has(r.source)) tree.set(r.source, new Map());
    const byYM = tree.get(r.source)!;
    if (!byYM.has(ym)) byYM.set(ym, []);
    byYM.get(ym)!.push(r);
  }

  // Source order: most conversations first
  const sourceOrder = [...tree.keys()].sort(
    (a, b) => (tree.get(b)!.size === 0 ? 0 : [...tree.get(b)!.values()].flat().length)
            - (tree.get(a)!.size === 0 ? 0 : [...tree.get(a)!.values()].flat().length)
  );

  const updated = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `# Memory Index`,
    ``,
    `<!-- ${rows.length} conversations | updated ${updated} -->`,
  ];

  for (const source of sourceOrder) {
    const byYM = tree.get(source)!;
    const total = [...byYM.values()].flat().length;
    lines.push(``, `## ${source} (${total})`);

    // Sort year/month descending
    const ymKeys = [...byYM.keys()].sort((a, b) => b.localeCompare(a));
    for (const ym of ymKeys) {
      const convs = byYM.get(ym)!;
      lines.push(``, `### ${ym}`);
      for (const r of convs) {
        const shortId = r.id.slice(0, r.source.length + 1 + 8); // source_ + 8 chars
        lines.push(`- \`${shortId}\` — ${r.title}`);
      }
    }
  }

  lines.push('');
  await writeFile(paths.index, lines.join('\n'), 'utf-8');
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
