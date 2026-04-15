import { getStats, closeDb } from '../profile/state.ts';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { paths } from '../profile/paths.ts';

const SOURCES = ['chatgpt', 'claude_web', 'gemini', 'claude_code', 'codex', 'openclaw', 'grok', 'deepseek'];

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        total += dirSize(full);
      } else {
        try { total += statSync(full).size; } catch {}
      }
    }
  } catch {}
  return total;
}

function fileCount(dir: string, ext?: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += fileCount(full, ext);
      } else if (!ext || entry.name.endsWith(ext)) {
        count++;
      }
    }
  } catch {}
  return count;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch { return []; }
}

function pathStatus(path: string): string {
  if (!existsSync(path)) return ' (missing)';
  try {
    const stats = statSync(path);
    const size = stats.isDirectory() ? dirSize(path) : stats.size;
    return ` (${formatBytes(size)})`;
  } catch {
    return '';
  }
}

export async function status() {
  if (!existsSync(paths.root)) {
    console.log('No memex profile found. Run: memex init');
    return;
  }

  const stats = getStats();

  // ── Sync stats ──
  console.log('memex status\n');

  if (stats.length === 0) {
    console.log('No data synced yet. Run: memex sync\n');
  } else {
    console.log('Source          | Conversations | Last Sync');
    console.log('----------------|---------------|--------------------');
    for (const row of stats) {
      const src = row.source.padEnd(16);
      const count = String(row.count).padStart(13);
      console.log(`${src}|${count} | ${row.last_sync}`);
    }
    console.log('');
  }

  // ── Profile paths ──
  console.log('Profile folders');
  console.log(`  ${'Root'.padEnd(12)} ${paths.root}${pathStatus(paths.root)}`);
  console.log(`  ${'Memory'.padEnd(12)} ${paths.memory}${pathStatus(paths.memory)}`);
  console.log(`  ${'Raw'.padEnd(12)} ${paths.raw}${pathStatus(paths.raw)}`);
  console.log(`  ${'Attachments'.padEnd(12)} ${paths.attachments}${pathStatus(paths.attachments)}`);
  console.log(`  ${'Wiki'.padEnd(12)} ${paths.wiki}${pathStatus(paths.wiki)}`);
  console.log(`  ${'References'.padEnd(12)} ${paths.references}${pathStatus(paths.references)}`);
  console.log(`  ${'Scripts'.padEnd(12)} ${paths.scripts}${pathStatus(paths.scripts)}`);
  console.log(`  ${'State'.padEnd(12)} ${paths.state}${pathStatus(paths.state)}`);
  console.log(`  ${'Logs'.padEnd(12)} ${paths.logs}${pathStatus(paths.logs)}`);
  console.log(`  ${'State DB'.padEnd(12)} ${paths.syncDb}` + (existsSync(paths.syncDb) ? ` (${formatBytes(statSync(paths.syncDb).size)})` : ' (not created)'));
  console.log(`  ${'Sync log'.padEnd(12)} ${paths.syncLog}` + (existsSync(paths.syncLog) ? ` (${formatBytes(statSync(paths.syncLog).size)})` : ' (not created)'));
  console.log('');

  // ── Conversations (converted markdown) ──
  const activeSources: { name: string; dir: string; files: number; size: number }[] = [];

  for (const src of SOURCES) {
    const dir = paths.memorySource(src);
    if (existsSync(dir)) {
      const files = fileCount(dir, '.md');
      const size = dirSize(dir);
      if (files > 0) {
        activeSources.push({ name: src, dir, files, size });
      }
    }
  }

  // Also check for any extra source dirs we might not know about
  for (const d of subdirs(paths.memory)) {
    if (d === 'raw' || d === 'attachments' || SOURCES.includes(d)) continue;
    const dir = join(paths.memory, d);
    activeSources.push({
      name: d,
      dir,
      files: fileCount(dir, '.md'),
      size: dirSize(dir),
    });
  }

  if (activeSources.length > 0) {
    console.log('Conversations (markdown)');
    for (const src of activeSources) {
      console.log(`  ${src.name.padEnd(16)} ${String(src.files).padStart(5)} files  ${formatBytes(src.size).padStart(9)}  ${src.dir}`);
    }
    const totalFiles = activeSources.reduce((s, x) => s + x.files, 0);
    const totalSize = activeSources.reduce((s, x) => s + x.size, 0);
    if (activeSources.length > 1) {
      console.log(`  ${'total'.padEnd(16)} ${String(totalFiles).padStart(5)} files  ${formatBytes(totalSize).padStart(9)}`);
    }
    console.log('');
  }

  // ── Raw data ──
  const rawSources: { name: string; dir: string; files: number; size: number }[] = [];
  for (const d of subdirs(paths.raw)) {
    const dir = join(paths.raw, d);
    const files = fileCount(dir);
    const size = dirSize(dir);
    if (files > 0) {
      rawSources.push({ name: d, dir, files, size });
    }
  }

  if (rawSources.length > 0) {
    console.log('Raw exports');
    for (const src of rawSources) {
      console.log(`  ${src.name.padEnd(16)} ${String(src.files).padStart(5)} files  ${formatBytes(src.size).padStart(9)}  ${src.dir}`);
    }
    const totalFiles = rawSources.reduce((s, x) => s + x.files, 0);
    const totalSize = rawSources.reduce((s, x) => s + x.size, 0);
    if (rawSources.length > 1) {
      console.log(`  ${'total'.padEnd(16)} ${String(totalFiles).padStart(5)} files  ${formatBytes(totalSize).padStart(9)}`);
    }
    console.log('');
  }

  // ── Attachments ──
  const attSources: { name: string; dir: string; files: number; size: number }[] = [];
  for (const d of subdirs(paths.attachments)) {
    const dir = join(paths.attachments, d);
    const files = fileCount(dir);
    if (files > 0) {
      attSources.push({ name: d, dir, files, size: dirSize(dir) });
    }
  }

  if (attSources.length > 0) {
    console.log('Attachments');
    for (const src of attSources) {
      console.log(`  ${src.name.padEnd(16)} ${String(src.files).padStart(5)} files  ${formatBytes(src.size).padStart(9)}  ${src.dir}`);
    }
    console.log('');
  }

  // ── Total disk usage ──
  const totalDisk = dirSize(paths.root);
  console.log(`Total disk usage: ${formatBytes(totalDisk)}`);

  closeDb();
}
