import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { paths } from '../profile/paths.ts';
import { getVersion, getPackageName } from './version.ts';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per 24h
const CACHE_FILENAME = 'update-check.json';

interface CacheShape {
  checkedAt: number;
  latest: string | null;
}

function cachePath(): string {
  return join(paths.state, CACHE_FILENAME);
}

function readCache(): CacheShape | null {
  const p = cachePath();
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    if (data && typeof data.checkedAt === 'number') return data as CacheShape;
  } catch {}
  return null;
}

function writeCache(data: CacheShape): void {
  try {
    mkdirSync(paths.state, { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(data));
  } catch {}
}

/**
 * Fetch latest version from npm registry. Returns null on any failure.
 * Used by doctor (no cache) and by background check (with cache).
 */
export async function fetchLatestVersion(pkg: string, timeoutMs = 2000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json() as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Print a one-line notice if a newer version is available on npm.
 * Runs at most once per 24h (cached). Silent on any failure.
 * Skips entirely when stdout is not a TTY (so scripts/pipes stay clean).
 */
export async function maybeNotifyUpdate(): Promise<void> {
  if (!process.stdout.isTTY) return;
  if (process.env.MEMEX_NO_UPDATE_CHECK === '1') return;
  if (!existsSync(paths.profileRoot)) return; // pre-init; skip

  const current = getVersion();
  const pkg = getPackageName();
  const cache = readCache();
  const now = Date.now();

  let latest: string | null = cache?.latest ?? null;

  if (!cache || now - cache.checkedAt > CHECK_INTERVAL_MS) {
    latest = await fetchLatestVersion(pkg);
    writeCache({ checkedAt: now, latest });
  }

  if (!latest) return;
  if (compareSemver(current, latest) >= 0) return;

  process.stderr.write(
    `\n  memex ${latest} available (current ${current}) — bun install -g ${pkg}@latest\n`,
  );
}
