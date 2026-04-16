import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';

// Profile root: internal state (sync.db, logs, config.json). Always ~/.memex.
const PROFILE_ROOT = join(homedir(), '.memex');
const CONFIG_FILE = join(PROFILE_ROOT, 'config.json');

export interface MemexConfig {
  version: number;
  workdir?: string;
  [key: string]: unknown;
}

export function readConfig(): MemexConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data as MemexConfig;
  } catch {}
  return null;
}

function expandHome(p: string): string {
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return p;
}

/**
 * Resolve workdir. Priority: flag > MEMEX_WORKDIR env > config.json > default (profile root).
 */
export function resolveWorkdir(flag?: string): string {
  if (flag) return expandHome(flag);
  const env = process.env.MEMEX_WORKDIR;
  if (env) return expandHome(env);
  const cfg = readConfig();
  if (cfg?.workdir) return expandHome(cfg.workdir);
  return PROFILE_ROOT;
}

function build(workdir: string) {
  return {
    // Profile root (internal, fixed)
    profileRoot: PROFILE_ROOT,
    root: PROFILE_ROOT, // back-compat alias
    state: join(PROFILE_ROOT, 'state'),
    logs: join(PROFILE_ROOT, 'logs'),
    syncDb: join(PROFILE_ROOT, 'state', 'sync.db'),
    syncLog: join(PROFILE_ROOT, 'logs', 'sync.log'),
    configFile: CONFIG_FILE,

    // Workdir (user-facing, configurable)
    workdir,
    memory: join(workdir, 'memory'),
    wiki: join(workdir, 'wiki'),
    raw: join(workdir, 'memory', 'raw'),
    attachments: join(workdir, 'memory', 'attachments'),
    wikiDomains: join(workdir, 'wiki', 'domains'),
    references: join(workdir, 'wiki', 'references'),
    scripts: join(workdir, 'scripts'),
    index: join(workdir, 'memory', 'index.md'),

    memorySource(source: string) {
      return join(workdir, 'memory', source);
    },
    rawSource(source: string) {
      return join(workdir, 'memory', 'raw', source);
    },
    attachmentsSource(source: string) {
      return join(workdir, 'memory', 'attachments', source);
    },
    conversationFile(source: string, year: string, month: string, id: string) {
      return join(workdir, 'memory', source, year, month, `${id}.md`);
    },
    scriptFile(source: string) {
      return join(workdir, 'scripts', `${source}.js`);
    },
  };
}

// Mutable paths object. Populated at module load with default (config/env aware);
// initPaths() can reassign fields if a CLI flag is provided.
export const paths = build(resolveWorkdir());

export function initPaths(opts: { workdirFlag?: string } = {}): void {
  const workdir = resolveWorkdir(opts.workdirFlag);
  Object.assign(paths, build(workdir));
}
