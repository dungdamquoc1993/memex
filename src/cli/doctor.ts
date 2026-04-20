import { existsSync, readFileSync, statSync, accessSync, constants } from 'fs';
import { Database } from 'bun:sqlite';
import { paths } from '../profile/paths.ts';
import { getVersion, getPackageName } from './version.ts';
import { fetchLatestVersion } from './update-check.ts';

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  status: Status;
  detail: string;
}

function readBunEngineRequirement(): string | null {
  try {
    const here = new URL('.', import.meta.url).pathname;
    const pkgPath = `${here}../../package.json`;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { engines?: { bun?: string } };
    return pkg.engines?.bun ?? null;
  } catch {
    return null;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function checkBunVersion(): Check {
  const required = readBunEngineRequirement();
  const actual = typeof Bun !== 'undefined' ? Bun.version : 'unknown';
  if (actual === 'unknown') {
    return { name: 'Bun runtime', status: 'fail', detail: 'Bun not detected (are you running under node?)' };
  }
  if (!required) {
    return { name: 'Bun runtime', status: 'ok', detail: `v${actual}` };
  }
  const min = required.replace(/^[^\d]*/, '');
  const ok = compareSemver(actual, min) >= 0;
  return {
    name: 'Bun runtime',
    status: ok ? 'ok' : 'fail',
    detail: ok ? `v${actual} (required ${required})` : `v${actual} < required ${required}`,
  };
}

function checkDir(name: string, path: string, mustExist: boolean): Check {
  if (!existsSync(path)) {
    return {
      name,
      status: mustExist ? 'fail' : 'warn',
      detail: `${path} (missing)`,
    };
  }
  try {
    const stats = statSync(path);
    if (!stats.isDirectory()) {
      return { name, status: 'fail', detail: `${path} (not a directory)` };
    }
    accessSync(path, constants.R_OK | constants.W_OK);
    return { name, status: 'ok', detail: path };
  } catch (e) {
    return { name, status: 'fail', detail: `${path} (${(e as Error).message})` };
  }
}

function checkSyncDb(): Check {
  if (!existsSync(paths.syncDb)) {
    return { name: 'sync.db', status: 'warn', detail: `${paths.syncDb} (not created — run memex sync)` };
  }
  try {
    const db = new Database(paths.syncDb, { readonly: true });
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_state'").get();
    db.close();
    if (!row) {
      return { name: 'sync.db', status: 'fail', detail: 'missing sync_state table' };
    }
    return { name: 'sync.db', status: 'ok', detail: paths.syncDb };
  } catch (e) {
    return { name: 'sync.db', status: 'fail', detail: `cannot open (${(e as Error).message})` };
  }
}

function checkConfig(): Check {
  if (!existsSync(paths.configFile)) {
    return { name: 'config.json', status: 'warn', detail: `${paths.configFile} (not created)` };
  }
  try {
    const raw = readFileSync(paths.configFile, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      return { name: 'config.json', status: 'fail', detail: 'not a JSON object' };
    }
    return { name: 'config.json', status: 'ok', detail: paths.configFile };
  } catch (e) {
    return { name: 'config.json', status: 'fail', detail: `invalid JSON (${(e as Error).message})` };
  }
}

async function checkLatestVersion(): Promise<Check> {
  const current = getVersion();
  const pkg = getPackageName();
  try {
    const latest = await fetchLatestVersion(pkg, 3000);
    if (!latest) {
      return { name: 'npm version check', status: 'warn', detail: `current ${current} (could not reach npm)` };
    }
    if (compareSemver(current, latest) < 0) {
      return { name: 'npm version check', status: 'warn', detail: `current ${current}, latest ${latest} — run: bun install -g ${pkg}@latest` };
    }
    return { name: 'npm version check', status: 'ok', detail: `${current} (up to date)` };
  } catch {
    return { name: 'npm version check', status: 'warn', detail: `current ${current} (check failed)` };
  }
}

function symbolFor(s: Status): string {
  if (s === 'ok') return '✓';
  if (s === 'warn') return '!';
  return '✗';
}

export async function doctor(): Promise<void> {
  const checks: Check[] = [
    checkBunVersion(),
    checkDir('profile root', paths.profileRoot, false),
    checkDir('workdir', paths.workdir, false),
    checkDir('state dir', paths.state, false),
    checkDir('logs dir', paths.logs, false),
    checkSyncDb(),
    checkConfig(),
    await checkLatestVersion(),
  ];

  console.log(`memex doctor — v${getVersion()}\n`);
  const nameWidth = Math.max(...checks.map(c => c.name.length));
  for (const c of checks) {
    console.log(`  ${symbolFor(c.status)}  ${c.name.padEnd(nameWidth)}  ${c.detail}`);
  }

  const failed = checks.filter(c => c.status === 'fail').length;
  const warned = checks.filter(c => c.status === 'warn').length;
  console.log('');
  if (failed > 0) {
    console.log(`${failed} failed, ${warned} warnings`);
    process.exit(1);
  } else if (warned > 0) {
    console.log(`OK with ${warned} warnings`);
  } else {
    console.log('All checks passed');
  }
}
