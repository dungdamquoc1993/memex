import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { getStats, getSyncedIds, closeDb } from '../profile/state.ts';
import { paths } from '../profile/paths.ts';

const SOURCE_ALIASES: Record<string, string> = {
  claude_web: 'claude',
};

const SOURCE_MAP: Record<string, { scriptFile: string; url: string; outputPattern: string; stateSource?: string; syncCommand?: string }> = {
  chatgpt: {
    scriptFile: 'chatgpt.js',
    url: 'chatgpt.com',
    outputPattern: 'chatgpt_*_YYYYMMDD_HHMMSSZ.json',
  },
  claude: {
    scriptFile: 'claude.js',
    url: 'claude.ai',
    outputPattern: 'claude_*_YYYYMMDD_HHMMSSZ.json',
    stateSource: 'claude_web',
    syncCommand: 'claude',
  },
  gemini: {
    scriptFile: 'gemini.js',
    url: 'gemini.google.com',
    outputPattern: 'gemini_YYYYMMDD.json',
  },
  grok: {
    scriptFile: 'grok.js',
    url: 'grok.com',
    outputPattern: 'grok_YYYYMMDD_HHMMSSZ.json',
  },
  deepseek: {
    scriptFile: 'deepseek.js',
    url: 'chat.deepseek.com',
    outputPattern: 'deepseek_YYYYMMDD_HHMMSSZ.json',
  },
};

const ID_PREFIX: Record<string, string> = {
  gemini: 'gemini_',
  grok: 'grok_',
  deepseek: 'deepseek_',
};

function getScriptsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), '..', 'browser-scripts');
}

function formatDate(isoStr: string): string {
  return isoStr.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
}

async function copyToClipboard(text: string): Promise<boolean> {
  // macOS
  try {
    const proc = Bun.spawn(['pbcopy'], { stdin: 'pipe' });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    if (proc.exitCode === 0) return true;
  } catch {}

  // Linux — xclip
  try {
    const proc = Bun.spawn(['xclip', '-selection', 'clipboard'], { stdin: 'pipe' });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    if (proc.exitCode === 0) return true;
  } catch {}

  // Linux — xsel
  try {
    const proc = Bun.spawn(['xsel', '--clipboard', '--input'], { stdin: 'pipe' });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    if (proc.exitCode === 0) return true;
  } catch {}

  return false;
}

export async function syncScript(source: string | undefined, outputDir?: string): Promise<void> {
  source = source ? (SOURCE_ALIASES[source] || source) : source;

  if (!source || !SOURCE_MAP[source]) {
    console.log(`Usage: memex sync-script <source> [path]

Available sources:
  chatgpt     → paste into chatgpt.com Console
  claude      → paste into claude.ai Console
  gemini      → paste into gemini.google.com Console
  grok        → paste into grok.com Console
  deepseek    → paste into chat.deepseek.com Console

Options:
  [path]      Directory to save the script (default: ~/.memex/scripts/)
`);
    return;
  }

  const cfg = SOURCE_MAP[source];
  const stateSource = cfg.stateSource || source;

  // Read last sync timestamp and known IDs
  let sinceDate: string | null = null;
  let knownRawIds: string[] = [];
  try {
    const stats = getStats(stateSource);
    if (stats.length > 0 && stats[0].last_sync) {
      const raw = stats[0].last_sync;
      sinceDate = raw.replace(' ', 'T') + 'Z';
    }
    if (ID_PREFIX[stateSource]) {
      const prefix = ID_PREFIX[stateSource];
      knownRawIds = getSyncedIds(stateSource)
        .map(id => id.startsWith(prefix) ? id.slice(prefix.length) : id);
    }
  } catch {
    // first-time sync
  } finally {
    closeDb();
  }

  // Read browser script
  const browserScriptPath = join(getScriptsDir(), cfg.scriptFile);
  let script: string;
  try {
    script = readFileSync(browserScriptPath, 'utf8');
  } catch {
    console.error(`Error: browser script not found at ${browserScriptPath}`);
    process.exit(1);
  }

  // Inject SINCE_DATE
  let injected = sinceDate
    ? script.replace(/var SINCE_DATE = null;/, `var SINCE_DATE = '${sinceDate}';`)
    : script;

  // Inject known raw IDs where supported. This avoids date-only incremental
  // filters hiding old conversations that were never imported successfully.
  if (knownRawIds.length > 0) {
    injected = injected.replace(
      /var KNOWN_IDS = new Set\(\);/,
      `var KNOWN_IDS = new Set(${JSON.stringify(knownRawIds)});`
    );
  }

  // Determine output path
  const targetDir = outputDir
    ? outputDir.replace('~', homedir())
    : paths.scripts;

  mkdirSync(targetDir, { recursive: true });
  const outFile = join(targetDir, `${source}.js`);
  writeFileSync(outFile, injected, 'utf8');

  // Copy to clipboard
  const copied = await copyToClipboard(injected);

  // Date string for output filename hint
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
  const outputFile = cfg.outputPattern
    .replace('YYYYMMDD', dateStr)
    .replace('HHMMSS', timeStr);
  const originalDir = paths.rawSource(stateSource);

  // Print instructions
  console.log('');
  if (sinceDate) {
    console.log(`Last sync: ${formatDate(sinceDate)} — script will fetch only new/updated conversations`);
  } else {
    console.log('No previous sync found — script will fetch all conversations');
  }
  console.log('');
  console.log(`Script saved to: ${outFile}`);
  if (copied) {
    console.log('✓ Copied to clipboard');
  } else {
    console.log('(Could not copy to clipboard — paste from the file above)');
  }
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Open ${cfg.url} → DevTools (F12) → Console → Paste & Enter`);
  console.log(`  2. After download, move the file:`);
  console.log(`       mv ~/Downloads/${outputFile} ${originalDir}/`);
  console.log(`  3. Run: memex sync ${cfg.syncCommand || stateSource}`);
  console.log('');
}
