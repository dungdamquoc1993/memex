import { getVersion } from './version.ts';

const MAIN_HELP = `memex — personal memory base

Usage:
  memex <command> [args] [--workdir <path>]

Commands:
  init          Create profile (state in ~/.memex, content in <workdir>)
  sync          Sync chat history from a source (chatgpt, claude, claude_code, ...)
  search        List and search conversations
  status        Show sync stats and disk usage
  sync-script   Save browser export script to file + copy to clipboard
  export        Backup profile + workdir to .tar.gz
  verify        Validate a profile backup without restoring
  import        Restore a profile backup
  config        Manage ~/.memex/config.json
  doctor        Run environment and profile health checks

Global options:
  --workdir <path>    Override workdir (priority: flag > MEMEX_WORKDIR > config.json > ~/.memex)
  -h, --help          Show help (use "memex <command> --help" for command-specific help)
  -v, --version       Print installed version
      --debug         Print full stack traces on error (also MEMEX_DEBUG=1)

Run "memex <command> --help" for details on a specific command.
`;

const COMMAND_HELP: Record<string, string> = {
  init: `memex init — Initialize a profile

Usage:
  memex init [--workdir <path>]

Creates the profile directory at ~/.memex (state, logs, config.json) and the
workdir (memory, wiki, scripts). Workdir defaults to ~/.memex but can be set
to any path; the choice is persisted to config.json.
`,

  sync: `memex sync — Sync chat history

Usage:
  memex sync [source] [--dry-run] [--no-index] [--rebuild-index] [--force]

Arguments:
  source              One of: chatgpt, claude (alias claude_web), claude_code,
                      gemini, codex, openclaw, grok, deepseek. Omit to sync all.

Options:
  --dry-run           Show what would change without writing files
  --no-index          Skip indexing (catalog + conversations table) during sync
  --rebuild-index     Rebuild index from all existing .md files
  --force             Re-process all conversations even if the source is unchanged
`,

  search: `memex search — List and search conversations

Usage:
  memex search [--source X[,Y,...]] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
               [--model X] [--project X] [--search text]
               [--limit N] [--all] [--json]

Options:
  --source X[,Y,...]  Filter by one or more sources; repeatable, accepts "claude" alias
  --since DATE        Only conversations on or after this date
  --until DATE        Only conversations on or before this date
  --model X           Filter by model name
  --project X         Filter by project name
  --search TEXT       Title substring match
  --limit N           Max results (default: 20)
  --all               Return all matches (overrides --limit)
  --json              Output as JSON instead of a table

Results are sorted by most recent update first.
`,

  status: `memex status — Show profile status

Usage:
  memex status

Prints sync counts per source, profile/workdir paths, and disk usage.
`,

  'sync-script': `memex sync-script — Generate browser export snippet

Usage:
  memex sync-script <source> [path] [--full]

Arguments:
  source              Platform name (chatgpt, claude, gemini, grok, ...)
  path                Optional output path (default: <workdir>/scripts/<source>.js)

Options:
  --full              Ignore sync history, fetch all conversations

The script is also copied to the clipboard for paste-into-devtools usage.
`,

  export: `memex export — Backup profile + workdir

Usage:
  memex export [file]

Writes a .tar.gz archive containing profile state and workdir contents.
Defaults to ./memex-backup-<timestamp>.tar.gz if no path is given.
`,

  verify: `memex verify — Validate a backup archive

Usage:
  memex verify <file>

Checks integrity of a .tar.gz produced by "memex export" without restoring.
`,

  import: `memex import — Restore a backup

Usage:
  memex import <file> [--replace] [--workdir <path>]

Options:
  --replace           Overwrite existing profile/workdir (otherwise merges)
  --workdir <path>    Restore workdir to a specific path
`,

  config: `memex config — Manage ~/.memex/config.json

Usage:
  memex config get <key>
  memex config set <key> <value>
  memex config list
  memex config path

Common keys:
  workdir             Absolute path to the workdir
`,

  doctor: `memex doctor — Environment and profile health check

Usage:
  memex doctor

Checks:
  - Bun runtime version vs required (engines.bun)
  - Profile root, workdir, state, logs directories
  - sync.db readability
  - config.json validity
  - Installed memex version vs latest on npm

Exits with code 0 if healthy, 1 if any issue is found.
`,
};

export function printMainHelp(): void {
  process.stdout.write(MAIN_HELP);
}

export function printCommandHelp(command: string): boolean {
  const text = COMMAND_HELP[command];
  if (!text) return false;
  process.stdout.write(text);
  return true;
}

export function printVersion(): void {
  process.stdout.write(`memex ${getVersion()}\n`);
}
