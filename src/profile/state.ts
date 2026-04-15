import { Database } from 'bun:sqlite';
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

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
