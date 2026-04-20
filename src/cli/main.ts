import { initPaths } from '../profile/paths.ts';
import { parseGlobalFlags } from './args.ts';
import { printMainHelp, printCommandHelp, printVersion } from './help.ts';
import { maybeNotifyUpdate } from './update-check.ts';

import { init } from './init.ts';
import { sync } from './sync.ts';
import { status } from './status.ts';
import { syncScript } from './sync-script.ts';
import { exportProfile, importProfile, verifyProfile } from './profile-archive.ts';
import { configCommand } from './config.ts';
import { search } from './search.ts';
import { doctor } from './doctor.ts';

const flags = parseGlobalFlags(process.argv.slice(2));

// Version short-circuits every other concern.
if (flags.version) {
  printVersion();
  process.exit(0);
}

initPaths({ workdirFlag: flags.workdirFlag });

const [command, ...args] = flags.rest;

// "memex" and "memex --help" → main help (exit 0).
// "memex <unknown>" → stderr + main help + exit 2.
// "memex <cmd> --help" → per-command help.
if (!command) {
  printMainHelp();
  process.exit(0);
}

if (flags.help) {
  if (printCommandHelp(command)) process.exit(0);
  printMainHelp();
  process.exit(0);
}

type Handler = () => Promise<void> | void;

const handlers: Record<string, Handler> = {
  init: () => init({ workdirFlag: flags.workdirFlag }),
  sync: () => {
    const sourceArg = args.find(a => !a.startsWith('--'));
    const dryRun = args.includes('--dry-run');
    const noIndex = args.includes('--no-index');
    const rebuildIndex = args.includes('--rebuild-index');
    const force = args.includes('--force');
    return sync(sourceArg, dryRun, { noIndex, rebuildIndex, force });
  },
  search: () => search(args),
  status: () => status(),
  'sync-script': () => {
    const full = args.includes('--full');
    const scriptArgs = args.filter(a => a !== '--full');
    return syncScript(scriptArgs[0], scriptArgs[1], { full });
  },
  export: () => exportProfile(args[0]),
  verify: () => verifyProfile(args[0]),
  import: () => {
    const archiveFile = args.find(a => !a.startsWith('--'));
    const replace = args.includes('--replace');
    return importProfile(archiveFile, replace, { workdirFlag: flags.workdirFlag });
  },
  config: () => configCommand(args),
  doctor: () => doctor(),
};

async function main() {
  const handler = handlers[command];
  if (!handler) {
    process.stderr.write(`memex: unknown command "${command}"\n\n`);
    printMainHelp();
    process.exit(2);
  }
  await handler();

  // Fire-and-forget update notifier; don't block exit on network.
  // Doctor command does its own version check, so skip there.
  if (command !== 'doctor') {
    await maybeNotifyUpdate().catch(() => {});
  }
}

main().catch(e => {
  if (flags.debug) {
    console.error(e);
  } else {
    console.error(e instanceof Error ? e.message : String(e));
    console.error('(run with --debug or MEMEX_DEBUG=1 for stack trace)');
  }
  process.exit(1);
});
