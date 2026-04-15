import { init } from './init.ts';
import { sync } from './sync.ts';
import { status } from './status.ts';
import { syncScript } from './sync-script.ts';
import { exportProfile, importProfile, verifyProfile } from './profile-archive.ts';

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case 'init':
      await init();
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
      await importProfile(archiveFile, replace);
      break;
    }
    default:
      console.log(`memex — personal memory base

Usage:
  memex init                          Create ~/.memex/ profile
  memex sync [source] [--dry-run]     Sync chat history (chatgpt, claude, claude_code, gemini, codex, openclaw, grok, deepseek)
  memex status                        Show sync stats
  memex sync-script <source> [path]   Save browser export script to file + copy to clipboard
  memex export [file]                 Backup ~/.memex/ profile to .tar.gz
  memex verify <file>                 Validate a profile backup without restoring
  memex import <file> [--replace]     Restore a profile backup
`);
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
