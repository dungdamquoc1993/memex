import { existsSync, readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, isAbsolute, resolve } from 'path';
import { homedir } from 'os';
import { paths, readConfig, type MemexConfig } from '../profile/paths.ts';

const USAGE = `Usage:
  memex config get <key>        Print a value (e.g. workdir)
  memex config set <key> <val>  Set a value and persist to config.json
  memex config list             Print full config.json
  memex config path             Print path to config.json`;

function expandHome(p: string): string {
  if (p.startsWith('~')) return resolve(homedir(), p.slice(1).replace(/^\/+/, ''));
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

async function writeConfig(cfg: MemexConfig): Promise<void> {
  await mkdir(dirname(paths.configFile), { recursive: true });
  await writeFile(paths.configFile, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

export async function saveConfig(patch: Partial<MemexConfig>): Promise<MemexConfig> {
  const current = readConfig() ?? { version: 1 };
  const next: MemexConfig = { ...current, ...patch, version: 1 };
  await writeConfig(next);
  return next;
}

export async function configCommand(args: string[]): Promise<void> {
  const [sub, key, ...rest] = args;

  switch (sub) {
    case 'path':
      console.log(paths.configFile);
      return;

    case 'list': {
      if (!existsSync(paths.configFile)) {
        console.log('(no config.json yet — run `memex init` or `memex config set <key> <value>`)');
        return;
      }
      console.log(readFileSync(paths.configFile, 'utf-8').trimEnd());
      return;
    }

    case 'get': {
      if (!key) throw new Error(USAGE);
      const cfg = readConfig();
      if (!cfg || !(key in cfg)) {
        console.log('');
        return;
      }
      const val = cfg[key];
      console.log(typeof val === 'string' ? val : JSON.stringify(val));
      return;
    }

    case 'set': {
      if (!key || rest.length === 0) throw new Error(USAGE);
      const rawVal = rest.join(' ');
      let value: unknown = rawVal;

      if (key === 'workdir') {
        const abs = expandHome(rawVal);
        value = abs;
        const next = await saveConfig({ workdir: abs });
        console.log(`workdir = ${abs}`);
        console.log(`(config saved to ${paths.configFile})`);
        if (!existsSync(abs)) {
          console.log(`Note: ${abs} does not exist yet. Run 'memex init --workdir ${abs}' to populate it.`);
        } else {
          console.log('Note: existing content is not migrated — this only updates the pointer.');
        }
        void next;
        return;
      }

      await saveConfig({ [key]: value });
      console.log(`${key} = ${String(value)}`);
      console.log(`(config saved to ${paths.configFile})`);
      return;
    }

    default:
      console.log(USAGE);
  }
}
