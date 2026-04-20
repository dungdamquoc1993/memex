import { queryConversations, closeDb } from '../profile/state.ts';
import type { QueryOpts } from '../profile/state.ts';

function parseFlag(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      if (i + 1 >= args.length) return undefined;
      return args[i + 1];
    }
    if (arg.startsWith(flag + '=')) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

function parseFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      if (i + 1 < args.length) values.push(args[i + 1]);
      i++;
      continue;
    }
    if (arg.startsWith(flag + '=')) {
      values.push(arg.slice(flag.length + 1));
    }
  }

  return values;
}

function normalizeSource(source: string): string {
  return source === 'claude' ? 'claude_web' : source;
}

function parseSources(args: string[]): string[] {
  const raw = parseFlagValues(args, '--source');
  return [...new Set(
    raw
      .flatMap(value => value.split(','))
      .map(value => value.trim())
      .filter(Boolean)
      .map(normalizeSource)
  )];
}

export async function search(args: string[]) {
  const opts: QueryOpts = {};
  const sources = parseSources(args);
  if (sources.length === 1) opts.source = sources[0];
  else if (sources.length > 1) opts.sources = sources;
  opts.since = parseFlag(args, '--since');
  opts.until = parseFlag(args, '--until');
  opts.model = parseFlag(args, '--model');
  opts.project = parseFlag(args, '--project');
  opts.search = parseFlag(args, '--search');
  opts.orderBy = 'updated_at DESC, created_at DESC';
  const limitStr = parseFlag(args, '--limit');
  const allResults = args.includes('--all');
  if (limitStr) opts.limit = parseInt(limitStr);
  else if (!allResults) opts.limit = 20;

  const jsonOutput = args.includes('--json');

  const rows = queryConversations(opts);

  if (jsonOutput) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    if (rows.length === 0) {
      console.log('No conversations found.');
    } else {
      for (const r of rows) {
        const date = r.updated_at.slice(0, 10);
        const src = r.source.padEnd(12);
        const title = r.title.length > 60 ? r.title.slice(0, 57) + '...' : r.title;
        console.log(`${date}  ${src} ${title}  (${r.message_count} msgs)`);
      }
      const limitNote = !allResults && !limitStr && rows.length === 20 ? '  (use --all or --limit N for more)' : '';
      console.log(`\n${rows.length} conversations found${limitNote}`);
    }
  }

  closeDb();
}
