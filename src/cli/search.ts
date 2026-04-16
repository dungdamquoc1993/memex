import { queryConversations, closeDb } from '../profile/state.ts';
import type { QueryOpts } from '../profile/state.ts';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export async function search(args: string[]) {
  const opts: QueryOpts = {};
  opts.source = parseFlag(args, '--source');
  opts.since = parseFlag(args, '--since');
  opts.until = parseFlag(args, '--until');
  opts.model = parseFlag(args, '--model');
  opts.project = parseFlag(args, '--project');
  opts.search = parseFlag(args, '--search');
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
        const date = r.created_at.slice(0, 10);
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
