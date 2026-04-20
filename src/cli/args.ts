export interface GlobalFlags {
  workdirFlag?: string;
  help: boolean;
  version: boolean;
  debug: boolean;
  rest: string[];
}

/**
 * Parse global flags shared across all commands. Returns the consumed flags
 * plus the remaining argv (command + command-specific args).
 *
 * Handles:
 *   --workdir <path> | --workdir=<path>
 *   --help  | -h
 *   --version | -v | -V
 *   --debug (also respects MEMEX_DEBUG=1)
 */
export function parseGlobalFlags(argv: string[]): GlobalFlags {
  let workdirFlag: string | undefined;
  let help = false;
  let version = false;
  let debug = process.env.MEMEX_DEBUG === '1';
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--workdir=')) {
      workdirFlag = a.slice('--workdir='.length);
    } else if (a === '--workdir') {
      workdirFlag = argv[i + 1];
      i++;
    } else if (a === '--help' || a === '-h') {
      help = true;
    } else if (a === '--version' || a === '-v' || a === '-V') {
      version = true;
    } else if (a === '--debug') {
      debug = true;
    } else {
      rest.push(a);
    }
  }

  return { workdirFlag, help, version, debug, rest };
}
