import { existsSync, statSync, constants as fsConstants } from 'fs';
import { access, cp, mkdtemp, rename, rm, writeFile, mkdir } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import { tmpdir } from 'os';
import pkg from '../../package.json';
import { paths, resolveWorkdir } from '../profile/paths.ts';
import { saveConfig } from './config.ts';

const MANIFEST_NAME = 'memex-backup.json';
const REQUIRED_PROFILE_DIRS = ['state', 'logs'];
const REQUIRED_WORKDIR_DIRS = ['memory', 'wiki', 'scripts'];

// v1: legacy — single ".memex/" tree. v2: "profile/" + "workdir/" split.
type FormatVersion = 1 | 2;

interface BackupManifest {
  app: 'memex';
  format_version: FormatVersion;
  created_at: string;
  source_profile_path: string;
  source_workdir_path?: string;
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

let tarChecked = false;
function ensureTarAvailable(): void {
  if (tarChecked) return;
  try {
    const probe = Bun.spawnSync(['tar', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    if (probe.exitCode !== 0) throw new Error('tar probe non-zero');
  } catch {
    throw new Error(
      `The 'tar' command was not found on PATH.\n` +
      `memex export/import/verify require a tar binary.\n` +
      `  - macOS/Linux: pre-installed.\n` +
      `  - Windows 10 (1803+): bundled as System32\\tar.exe — ensure System32 is on PATH.\n` +
      `  - Older Windows: install via 'winget install GnuWin32.Tar' or WSL.`,
    );
  }
  tarChecked = true;
}

function runTar(args: string[], action: string): string {
  ensureTarAvailable();
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

/**
 * Move a directory atomically when possible; fall back to copy + remove when
 * source and target are on different filesystems/drives (rename throws EXDEV
 * on POSIX, or similar on Windows cross-volume).
 */
async function moveDir(src: string, dst: string): Promise<void> {
  try {
    await rename(src, dst);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP') {
      await cp(src, dst, { recursive: true, errorOnExist: true, force: false });
      await rm(src, { recursive: true, force: true });
      return;
    }
    throw err;
  }
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
  } catch {
    throw new Error(`${MANIFEST_NAME} is not valid JSON.`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${MANIFEST_NAME} must be a JSON object.`);
  }

  const manifest = data as Record<string, unknown>;
  if (manifest.app !== 'memex') {
    throw new Error(`${MANIFEST_NAME} is not a memex backup manifest.`);
  }
  if (manifest.format_version !== 1 && manifest.format_version !== 2) {
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
    format_version: manifest.format_version as FormatVersion,
    created_at: manifest.created_at,
    source_profile_path: manifest.source_profile_path,
    source_workdir_path: typeof manifest.source_workdir_path === 'string' ? manifest.source_workdir_path : undefined,
    memex_version: manifest.memex_version,
  };
}

function hasDir(entries: string[], top: string, dir: string): boolean {
  const path = `${top}/${dir}`;
  return entries.some(e => e === path || e === `${path}/` || e.startsWith(`${path}/`));
}

function validateArchiveEntries(entries: string[], version: FormatVersion): void {
  if (!entries.includes(MANIFEST_NAME)) {
    throw new Error(`Archive does not contain ${MANIFEST_NAME}.`);
  }

  const topLevels = version === 2 ? ['profile', 'workdir'] : ['.memex'];

  for (const top of topLevels) {
    const present = entries.some(e => e === top || e === `${top}/` || e.startsWith(`${top}/`));
    if (!present) {
      throw new Error(`Archive does not contain a top-level ${top}/ directory.`);
    }
  }

  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    const allowed =
      normalized === MANIFEST_NAME ||
      topLevels.some(t => normalized === t || normalized === `${t}/` || normalized.startsWith(`${t}/`));

    if (normalized.startsWith('/') || parts.includes('..') || !allowed) {
      throw new Error(`Archive contains an unsafe or unsupported entry: ${entry}`);
    }
  }

  if (version === 2) {
    for (const dir of REQUIRED_PROFILE_DIRS) {
      if (!hasDir(entries, 'profile', dir)) {
        throw new Error(`Archive is missing required profile directory: profile/${dir}/`);
      }
    }
    for (const dir of REQUIRED_WORKDIR_DIRS) {
      if (!hasDir(entries, 'workdir', dir)) {
        throw new Error(`Archive is missing required workdir directory: workdir/${dir}/`);
      }
    }
  } else {
    // v1 legacy: everything under .memex/
    for (const dir of [...REQUIRED_PROFILE_DIRS, ...REQUIRED_WORKDIR_DIRS]) {
      if (!hasDir(entries, '.memex', dir)) {
        throw new Error(`Archive is missing required directory: .memex/${dir}/`);
      }
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
  const manifest = readManifest(inputFile);
  validateArchiveEntries(entries, manifest.format_version);

  return { archivePath: inputFile, entries, manifest };
}

function defaultExportPath(): string {
  return resolve(process.cwd(), `memex-profile-${timestamp()}.tar.gz`);
}

function resolveOutputPath(outputFile?: string): string {
  return outputFile ? resolve(outputFile) : defaultExportPath();
}

function uniqueBackupPath(base: string): string {
  const core = `${base}.backup-${timestamp()}`;
  let candidate = core;
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = `${core}-${suffix}`;
    suffix++;
  }
  return candidate;
}

async function removeTempDir(dir: string | undefined): Promise<void> {
  if (!dir) return;
  await rm(dir, { recursive: true, force: true });
}

export async function exportProfile(outputFile?: string): Promise<void> {
  if (!existsSync(paths.profileRoot) || !statSync(paths.profileRoot).isDirectory()) {
    throw new Error(`No memex profile found at ${paths.profileRoot}. Run: memex init`);
  }
  if (!existsSync(paths.workdir) || !statSync(paths.workdir).isDirectory()) {
    throw new Error(`Workdir not found at ${paths.workdir}. Run: memex init`);
  }

  const outFile = resolveOutputPath(outputFile);
  if (existsSync(outFile)) {
    throw new Error(`Output file already exists: ${outFile}`);
  }

  const outDir = dirname(outFile);
  if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
    throw new Error(`Output directory does not exist: ${outDir}`);
  }

  // Stage profile/ and workdir/ into a temp dir so they can be archived with
  // normalized top-level names regardless of their on-disk location.
  const stageDir = await mkdtemp(join(tmpdir(), 'memex-export-'));
  try {
    const profileStage = join(stageDir, 'profile');
    // fs.cp is cross-platform (macOS/Linux/Windows) — avoids shelling out to `cp`.
    await cp(paths.profileRoot, profileStage, { recursive: true });

    // workdir/ always contains memory/wiki/scripts regardless of whether workdir
    // equals profileRoot (legacy) or is a separate path.
    const workdirStage = join(stageDir, 'workdir');
    await mkdir(workdirStage, { recursive: true });
    for (const d of REQUIRED_WORKDIR_DIRS) {
      const src = join(paths.workdir, d);
      if (existsSync(src)) {
        await cp(src, join(workdirStage, d), { recursive: true });
      }
    }
    // If workdir == profileRoot, strip memory/wiki/scripts from the profile stage
    // to avoid duplication in the archive.
    if (paths.workdir === paths.profileRoot) {
      for (const d of REQUIRED_WORKDIR_DIRS) {
        await rm(join(profileStage, d), { recursive: true, force: true });
      }
    }

    const manifest: BackupManifest = {
      app: 'memex',
      format_version: 2,
      created_at: new Date().toISOString(),
      source_profile_path: paths.profileRoot,
      source_workdir_path: paths.workdir,
      memex_version: pkg.version,
    };

    await writeFile(join(stageDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

    runTar([
      '-czf', outFile,
      '-C', stageDir,
      'profile', 'workdir', MANIFEST_NAME,
    ], 'Profile export');

    console.log(`Exported memex profile to ${outFile}`);
    console.log(`  Profile: ${paths.profileRoot}`);
    console.log(`  Workdir: ${paths.workdir}`);
  } finally {
    await removeTempDir(stageDir);
  }
}

export async function verifyProfile(archiveFile: string | undefined): Promise<void> {
  try {
    const archive = validateProfileArchive(archiveFile, 'memex verify <file>');
    console.log('Backup verification: PASS');
    console.log(`  Archive:        ${archive.archivePath}`);
    console.log(`  Format version: ${archive.manifest.format_version}`);
    console.log(`  Created:        ${archive.manifest.created_at}`);
    console.log(`  Memex version:  ${archive.manifest.memex_version}`);
    console.log(`  Source profile: ${archive.manifest.source_profile_path}`);
    if (archive.manifest.source_workdir_path) {
      console.log(`  Source workdir: ${archive.manifest.source_workdir_path}`);
    }
    console.log(`  Entries:        ${archive.entries.length}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Backup verification: FAIL\nReason: ${reason}`);
  }
}

async function ensureParentWritable(target: string, label: string, hint: string): Promise<void> {
  const parent = dirname(target);
  if (!existsSync(parent)) {
    try {
      await mkdir(parent, { recursive: true });
    } catch (err) {
      throw new Error(
        `Cannot create parent directory for ${label} (${parent}): ${err instanceof Error ? err.message : String(err)}\n${hint}`,
      );
    }
  }
  try {
    await access(parent, fsConstants.W_OK);
  } catch {
    throw new Error(
      `${label} parent directory is not writable: ${parent}\n${hint}`,
    );
  }
}

export async function importProfile(
  archiveFile: string | undefined,
  replace = false,
  opts: { workdirFlag?: string } = {},
): Promise<void> {
  const archive = validateProfileArchive(archiveFile);

  // Target workdir resolution (priority: flag > env > manifest > profile root for v1).
  // For v2 archives with a source_workdir_path that's non-writable on this machine,
  // we fail fast — do NOT silently fall back to ~/.memex (would split data across
  // two locations once the user later sets up their intended workdir).
  let workdirSource: 'flag' | 'env' | 'manifest' | 'default';
  let targetWorkdir: string;
  if (opts.workdirFlag) {
    targetWorkdir = resolveWorkdir(opts.workdirFlag);
    workdirSource = 'flag';
  } else if (process.env.MEMEX_WORKDIR) {
    targetWorkdir = resolveWorkdir();
    workdirSource = 'env';
  } else if (archive.manifest.source_workdir_path) {
    targetWorkdir = archive.manifest.source_workdir_path;
    workdirSource = 'manifest';
  } else {
    targetWorkdir = paths.profileRoot;
    workdirSource = 'default';
  }

  // Pre-flight writable check. Fail fast with an actionable message before
  // extracting anything. Only check workdir parent if it differs from profile
  // root (profile root parent is always user's home, which is writable).
  const hint =
    `Re-run with an explicit --workdir:\n` +
    `  memex import <file> --workdir ~/memex-data     (new location)\n` +
    `  memex import <file> --workdir ~/.memex         (merge into profile root)`;

  await ensureParentWritable(paths.profileRoot, 'Profile', hint);
  if (targetWorkdir !== paths.profileRoot) {
    await ensureParentWritable(targetWorkdir, 'Workdir', hint);
  }

  // Warn on cross-machine restore: archive's original workdir differs from
  // where we're restoring it (and user didn't explicitly ask for the original).
  if (
    workdirSource === 'manifest' &&
    archive.manifest.source_profile_path !== paths.profileRoot
  ) {
    console.log(
      `Note: archive was created on a different machine (profile: ${archive.manifest.source_profile_path}).`,
    );
    console.log(`      Restoring workdir to manifest path: ${targetWorkdir}`);
    console.log(`      Pass --workdir to override if that path is not where you want data.`);
  } else if (
    archive.manifest.source_workdir_path &&
    archive.manifest.source_workdir_path !== targetWorkdir &&
    workdirSource !== 'manifest'
  ) {
    console.log(
      `Note: archive's original workdir was ${archive.manifest.source_workdir_path};`,
    );
    console.log(`      restoring to ${targetWorkdir} instead (from --${workdirSource === 'flag' ? 'workdir flag' : workdirSource}).`);
  }

  const profileParent = dirname(paths.profileRoot);
  const tempDir = await mkdtemp(join(profileParent, '.memex-import-'));
  const backups: string[] = [];
  let restoreComplete = false;

  try {
    runTar(['-xzf', archive.archivePath, '-C', tempDir], 'Archive extraction');

    let extractedProfile: string;
    let extractedWorkdir: string;

    if (archive.manifest.format_version === 2) {
      extractedProfile = join(tempDir, 'profile');
      extractedWorkdir = join(tempDir, 'workdir');
    } else {
      // v1 legacy: single .memex/ tree — use it for both, then split on restore.
      extractedProfile = join(tempDir, '.memex');
      extractedWorkdir = join(tempDir, '.memex');
    }

    if (!existsSync(extractedProfile) || !statSync(extractedProfile).isDirectory()) {
      throw new Error('Archive extraction did not produce expected directories.');
    }

    // Move existing roots aside if --replace.
    const moveAside = async (path: string) => {
      if (!existsSync(path)) return;
      if (!replace) {
        throw new Error(`Target already exists at ${path}. Re-run with --replace to move it aside.`);
      }
      const backup = uniqueBackupPath(path);
      await moveDir(path, backup);
      backups.push(backup);
    };

    await moveAside(paths.profileRoot);
    if (targetWorkdir !== paths.profileRoot) {
      await moveAside(targetWorkdir);
    }

    // Restore profile root.
    await mkdir(dirname(paths.profileRoot), { recursive: true });
    await moveDir(extractedProfile, paths.profileRoot);

    // Restore workdir.
    if (targetWorkdir === paths.profileRoot) {
      // Workdir content must live alongside state/logs in profile root.
      if (archive.manifest.format_version === 2) {
        for (const d of REQUIRED_WORKDIR_DIRS) {
          const src = join(extractedWorkdir, d);
          if (existsSync(src)) {
            await moveDir(src, join(paths.profileRoot, d));
          }
        }
      }
      // v1: already merged (profile root IS the old .memex).
    } else {
      await mkdir(dirname(targetWorkdir), { recursive: true });
      if (archive.manifest.format_version === 2) {
        await moveDir(extractedWorkdir, targetWorkdir);
      } else {
        // v1: carve memory/wiki/scripts from profile root into the new workdir.
        await mkdir(targetWorkdir, { recursive: true });
        for (const d of REQUIRED_WORKDIR_DIRS) {
          const src = join(paths.profileRoot, d);
          if (existsSync(src)) {
            await moveDir(src, join(targetWorkdir, d));
          }
        }
      }
    }

    // Persist workdir to config.json so subsequent commands find it.
    await saveConfig({ workdir: targetWorkdir });

    restoreComplete = true;

    console.log(`Imported memex profile from ${archive.archivePath}`);
    console.log(`  Profile restored to: ${paths.profileRoot}`);
    console.log(`  Workdir restored to: ${targetWorkdir}`);
    for (const b of backups) {
      console.log(`  Previous data moved to: ${b}`);
    }
  } catch (error) {
    if (backups.length > 0 && !restoreComplete) {
      for (const b of backups) {
        console.error(`Previous data preserved at ${b}`);
      }
      console.error(`Extracted archive remains at ${tempDir}${sep}`);
      throw error;
    }
    throw error;
  } finally {
    if (backups.length === 0 || restoreComplete) {
      await removeTempDir(tempDir);
    }
  }
}
