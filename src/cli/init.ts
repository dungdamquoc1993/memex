import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { paths } from '../profile/paths.ts';
import { saveConfig } from './config.ts';

const SOURCES = ['chatgpt', 'claude_web', 'gemini', 'claude_code', 'codex', 'openclaw', 'grok', 'deepseek'];

export async function init(opts: { workdirFlag?: string } = {}): Promise<void> {
  if (existsSync(paths.profileRoot)) {
    console.log(`Profile already exists at ${paths.profileRoot}`);
    console.log('Ensuring all directories exist...');
  }

  // Profile root (internal)
  await mkdir(paths.profileRoot, { recursive: true });
  await mkdir(paths.state, { recursive: true });
  await mkdir(paths.logs, { recursive: true });

  // Workdir (user-facing)
  await mkdir(paths.workdir, { recursive: true });

  // Memory directories (chỉ .md conversation files — qmd indexes here)
  for (const source of SOURCES) {
    await mkdir(paths.memorySource(source), { recursive: true });
  }

  // Raw directories (JSON exports — NOT indexed by qmd)
  for (const source of ['chatgpt', 'claude_web', 'gemini', 'grok', 'deepseek']) {
    await mkdir(paths.rawSource(source), { recursive: true });
  }

  // Attachment directories (binary/media — NOT indexed by qmd)
  for (const source of SOURCES) {
    await mkdir(paths.attachmentsSource(source), { recursive: true });
  }

  // Wiki directories
  await mkdir(paths.wiki, { recursive: true });
  await mkdir(paths.wikiDomains, { recursive: true });
  await mkdir(paths.references, { recursive: true });

  // Scripts
  await mkdir(paths.scripts, { recursive: true });

  // User profile build (memex-profile pipeline → USER.md, etc.)
  await mkdir(paths.profile, { recursive: true });

  // Persist workdir to config.json (idempotent — always record current choice).
  // Source of truth for resolution: flag > env > config > default. We save the
  // effective workdir so future invocations without flag/env still use it.
  await saveConfig({ workdir: paths.workdir });

  console.log(`Initialized memex`);
  console.log(`  Profile: ${paths.profileRoot}  (state, logs, config)`);
  console.log(`  Workdir: ${paths.workdir}  (memory, wiki, scripts, profile)`);
  if (opts.workdirFlag) {
    console.log(`  (workdir set via --workdir; persisted to ${paths.configFile})`);
  }
  console.log(`
Next steps:
  1. Generate a browser export script:
       memex sync-script chatgpt
       memex sync-script claude
       memex sync-script gemini
       memex sync-script grok
       memex sync-script deepseek

  2. Paste the script into your browser console, download the JSON.

  3. Move the downloaded file into the matching folder:
       ${paths.rawSource('chatgpt')}/
       ${paths.rawSource('claude_web')}/
       ${paths.rawSource('gemini')}/
       ${paths.rawSource('grok')}/
       ${paths.rawSource('deepseek')}/

  4. Run: memex sync

  5. Setup qmd collections (one-time):
       qmd collection add ${paths.memory} --name memex-memory
       qmd collection add ${paths.wiki} --name memex-wiki
       qmd update && qmd embed
`);
}
