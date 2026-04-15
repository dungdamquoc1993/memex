import { join } from 'path';
import { homedir } from 'os';

const MEMEX_ROOT = join(homedir(), '.memex');

export const paths = {
  root: MEMEX_ROOT,
  memory: join(MEMEX_ROOT, 'memory'),
  wiki: join(MEMEX_ROOT, 'wiki'),
  raw: join(MEMEX_ROOT, 'memory', 'raw'),
  attachments: join(MEMEX_ROOT, 'memory', 'attachments'),
  wikiDomains: join(MEMEX_ROOT, 'wiki', 'domains'),
  references: join(MEMEX_ROOT, 'wiki', 'references'),
  state: join(MEMEX_ROOT, 'state'),
  logs: join(MEMEX_ROOT, 'logs'),
  scripts: join(MEMEX_ROOT, 'scripts'),
  syncDb: join(MEMEX_ROOT, 'state', 'sync.db'),
  syncLog: join(MEMEX_ROOT, 'logs', 'sync.log'),

  memorySource(source: string) {
    return join(MEMEX_ROOT, 'memory', source);
  },
  rawSource(source: string) {
    return join(MEMEX_ROOT, 'memory', 'raw', source);
  },
  attachmentsSource(source: string) {
    return join(MEMEX_ROOT, 'memory', 'attachments', source);
  },
  conversationFile(source: string, year: string, month: string, id: string) {
    return join(MEMEX_ROOT, 'memory', source, year, month, `${id}.md`);
  },
  scriptFile(source: string) {
    return join(MEMEX_ROOT, 'scripts', `${source}.js`);
  },
};
