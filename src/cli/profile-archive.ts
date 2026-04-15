import { existsSync, statSync } from 'fs';
import { mkdtemp, rename, rm, writeFile } from 'fs/promises';
import { basename, dirname, join, resolve, sep } from 'path';
import { tmpdir } from 'os';
import pkg from '../../package.json';
import { paths } from '../profile/paths.ts';

const MANIFEST_NAME = 'memex-backup.json';
const REQUIRED_PROFILE_DIRS = ['memory', 'wiki', 'scripts', 'state', 'logs'];

interface BackupManifest {
  app: 'memex';
  format_version: 1;
  created_at: string;
  source_profile_path: string;
  memex_version: string;
}

interface ValidatedArchive {
  archivePath: string;
  entries: string[];
  manifest: BackupManifest;
}

function timestamp(): string {
  return new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function runTar(args: string[], action: string): string {
  const proc = Bun.spawnSync(['tar', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = decode(proc.stdout);
  const stderr = decode(proc.stderr);
  if (proc.exitCode !== 0) {
    const detail = stderr || stdout || `tar exited with code ${proc.exitCode}`;
    throw new Error(`${action} failed: ${detail}`);
  }
  return stdout;
}

function archiveEntries(file: string): string[] {
  return runTar(['-tzf', file], 'Archive validation')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function readManifest(file: string): BackupManifest {
  const raw = runTar(['-xOf', file, MANIFEST_NAME], 'Manifest read');
  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${MANIFEST_NAME} is not valid JSON.`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${MANIFEST_NAME} must be a JSON object.`);
  }

  const manifest = data as Record<string, unknown>;
  if (manifest.app !== 'memex') {
    throw new Error(`${MANIFEST_NAME} is not a memex backup manifest.`);
  }
  if (manifest.format_version !== 1) {
    throw new Error(`Unsupported memex backup format version: ${String(manifest.format_version)}`);
  }
  if (typeof manifest.created_at !== 'string' || Number.isNaN(Date.parse(manifest.created_at))) {
    throw new Error(`${MANIFEST_NAME} has an invalid created_at timestamp.`);
  }
  if (typeof manifest.source_profile_path !== 'string' || manifest.source_profile_path.length === 0) {
    throw new Error(`${MANIFEST_NAME} is missing source_profile_path.`);
  }
  if (typeof manifest.memex_version !== 'string' || manifest.memex_version.length === 0) {
    throw new Error(`${MANIFEST_NAME} is missing memex_version.`);
  }

  return {
    app: 'memex',
    format_version: 1,
    created_at: manifest.created_at,
    source_profile_path: manifest.source_profile_path,
    memex_version: manifest.memex_version,
  };
}

function hasProfileDir(entries: string[], dir: string): boolean {
  const path = `.memex/${dir}`;
  return entries.some(entry => entry === path || entry === `${path}/` || entry.startsWith(`${path}/`));
}

function validateArchiveEntries(entries: string[]): void {
  const hasProfile = entries.some(entry => entry === '.memex' || entry === '.memex/' || entry.startsWith('.memex/'));
  const hasManifest = entries.includes(MANIFEST_NAME);

  if (!hasProfile) {
    throw new Error('Archive does not contain a top-level .memex/ profile.');
  }
  if (!hasManifest) {
    throw new Error(`Archive does not contain ${MANIFEST_NAME}.`);
  }

  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    const allowedTopLevel = normalized === MANIFEST_NAME || normalized === '.memex' || normalized === '.memex/' || normalized.startsWith('.memex/');

    if (normalized.startsWith('/') || parts.includes('..') || !allowedTopLevel) {
      throw new Error(`Archive contains an unsafe or unsupported entry: ${entry}`);
    }
  }

  for (const dir of REQUIRED_PROFILE_DIRS) {
    if (!hasProfileDir(entries, dir)) {
      throw new Error(`Archive is missing required profile directory: .memex/${dir}/`);
    }
  }
}

function validateProfileArchive(archiveFile: string | undefined, usage = 'memex import <file> [--replace]'): ValidatedArchive {
  if (!archiveFile) {
    throw new Error(`Missing archive file. Usage: ${usage}`);
  }

  const inputFile = resolve(archiveFile);
  if (!existsSync(inputFile) || !statSync(inputFile).isFile()) {
    throw new Error(`Archive file not found: ${inputFile}`);
  }

  const entries = archiveEntries(inputFile);
  validateArchiveEntries(entries);
  const manifest = readManifest(inputFile);

  return { archivePath: inputFile, entries, manifest };
}

function defaultExportPath(): string {
  return resolve(process.cwd(), `memex-profile-${timestamp()}.tar.gz`);
}

function resolveOutputPath(outputFile?: string): string {
  return outputFile ? resolve(outputFile) : defaultExportPath();
}

function uniqueBackupPath(): string {
  const base = `${paths.root}.backup-${timestamp()}`;
  let candidate = base;
  let suffix = 2;

  while (existsSync(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  return candidate;
}

async function removeTempDir(dir: string | undefined): Promise<void> {
  if (!dir) return;
  await rm(dir, { recursive: true, force: true });
}

export async function exportProfile(outputFile?: string): Promise<void> {
  if (!existsSync(paths.root) || !statSync(paths.root).isDirectory()) {
    throw new Error(`No memex profile found at ${paths.root}. Run: memex init`);
  }

  const outFile = resolveOutputPath(outputFile);
  if (existsSync(outFile)) {
    throw new Error(`Output file already exists: ${outFile}`);
  }

  const outDir = dirname(outFile);
  if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
    throw new Error(`Output directory does not exist: ${outDir}`);
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'memex-export-'));
  try {
    const manifest: BackupManifest = {
      app: 'memex',
      format_version: 1,
      created_at: new Date().toISOString(),
      source_profile_path: paths.root,
      memex_version: pkg.version,
    };

    await writeFile(join(tempDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    runTar([
      '-czf',
      outFile,
      '-C',
      dirname(paths.root),
      basename(paths.root),
      '-C',
      tempDir,
      MANIFEST_NAME,
    ], 'Profile export');

    console.log(`Exported memex profile to ${outFile}`);
  } finally {
    await removeTempDir(tempDir);
  }
}

export async function verifyProfile(archiveFile: string | undefined): Promise<void> {
  try {
    const archive = validateProfileArchive(archiveFile, 'memex verify <file>');
    console.log('Backup verification: PASS');
    console.log(`  Archive:        ${archive.archivePath}`);
    console.log(`  Created:        ${archive.manifest.created_at}`);
    console.log(`  Memex version:  ${archive.manifest.memex_version}`);
    console.log(`  Source profile: ${archive.manifest.source_profile_path}`);
    console.log(`  Entries:        ${archive.entries.length}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Backup verification: FAIL\nReason: ${reason}`);
  }
}

export async function importProfile(archiveFile: string | undefined, replace = false): Promise<void> {
  const archive = validateProfileArchive(archiveFile);

  const profileParent = dirname(paths.root);
  const tempDir = await mkdtemp(join(profileParent, '.memex-import-'));
  let backupPath: string | null = null;
  let restoreComplete = false;

  try {
    runTar(['-xzf', archive.archivePath, '-C', tempDir], 'Archive extraction');

    const extractedProfile = join(tempDir, '.memex');
    if (!existsSync(extractedProfile) || !statSync(extractedProfile).isDirectory()) {
      throw new Error('Archive extraction did not produce a .memex/ directory.');
    }

    if (existsSync(paths.root)) {
      if (!replace) {
        throw new Error(`Profile already exists at ${paths.root}. Re-run with --replace to move it aside and restore this backup.`);
      }

      const nextBackupPath = uniqueBackupPath();
      await rename(paths.root, nextBackupPath);
      backupPath = nextBackupPath;
    }

    await rename(extractedProfile, paths.root);
    restoreComplete = true;

    console.log(`Imported memex profile from ${archive.archivePath}`);
    if (backupPath) {
      console.log(`Previous profile moved to ${backupPath}`);
    }
  } catch (error) {
    if (backupPath && !restoreComplete) {
      console.error(`Previous profile is preserved at ${backupPath}`);
      console.error(`Extracted archive remains at ${tempDir}${sep}.memex`);
      throw error;
    }
    throw error;
  } finally {
    if (!backupPath || restoreComplete) {
      await removeTempDir(tempDir);
    }
  }
}
