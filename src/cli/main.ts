import { initPaths } from '../profile/paths.ts';
import { init } from './init.ts';
import { sync } from './sync.ts';
import { status } from './status.ts';
import { syncScript } from './sync-script.ts';
import { exportProfile, importProfile, verifyProfile } from './profile-archive.ts';
import { configCommand } from './config.ts';

const argv = process.argv.slice(2);

// Extract --workdir=<path> (also supports --workdir <path>) globally.
let workdirFlag: string | undefined;
const filtered: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--workdir=')) {
    workdirFlag = a.slice('--workdir='.length);
  } else if (a === '--workdir') {
    workdirFlag = argv[i + 1];
    i++;
  } else {
    filtered.push(a);
  }
}

// Re-resolve paths now that we know the flag (env/config fallback handled inside).
initPaths({ workdirFlag });

const [command, ...args] = filtered;

async function main() {
  switch (command) {
    case 'init':
      await init({ workdirFlag });
      break;
    case 'sync': {
      const sourceArg = args.find(a => !a.startsWith('--'));
      const dryRun = args.includes('--dry-run');
      await sync(sourceArg, dryRun);
      break;
    }
    case 'status':
      await status();
      break;
    case 'sync-script':
      await syncScript(args[0], args[1]);
      break;
    case 'export':
      await exportProfile(args[0]);
      break;
    case 'verify':
      await verifyProfile(args[0]);
      break;
    case 'import': {
      const archiveFile = args.find(a => !a.startsWith('--'));
      const replace = args.includes('--replace');
      await importProfile(archiveFile, replace, { workdirFlag });
      break;
    }
    case 'config':
      await configCommand(args);
      break;
    default:
      console.log(`memex — personal memory base

Usage:
  memex init [--workdir <path>]       Create profile (state in ~/.memex, content in <workdir>)
  memex sync [source] [--dry-run]     Sync chat history (chatgpt, claude, claude_code, gemini, codex, openclaw, grok, deepseek)
  memex status                        Show sync stats
  memex sync-script <source> [path]   Save browser export script to file + copy to clipboard
  memex export [file]                 Backup profile + workdir to .tar.gz
  memex verify <file>                 Validate a profile backup without restoring
  memex import <file> [--replace] [--workdir <path>]
                                      Restore a profile backup
  memex config <get|set|list|path> [key] [value]
                                      Manage ~/.memex/config.json (e.g. workdir)

Global options:
  --workdir <path>                    Override workdir for this invocation
                                      (priority: flag > MEMEX_WORKDIR env > config.json > ~/.memex)
`);
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
