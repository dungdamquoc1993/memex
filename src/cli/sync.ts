import { mkdir, writeFile, appendFile } from 'fs/promises';
import { dirname } from 'path';
import type { Adapter } from '../adapters/base.ts';
import type { Conversation, Source } from '../normalize/schema.ts';
import { ClaudeCodeAdapter } from '../adapters/claude_code.ts';
import { ChatGPTAdapter } from '../adapters/chatgpt.ts';
import { ClaudeWebAdapter } from '../adapters/claude_web.ts';
import { GeminiAdapter } from '../adapters/gemini.ts';
import { CodexAdapter } from '../adapters/codex.ts';
import { OpenClawAdapter } from '../adapters/openclaw.ts';
import { GrokAdapter } from '../adapters/grok.ts';
import { DeepSeekAdapter } from '../adapters/deepseek.ts';
import { conversationToMarkdown } from '../normalize/markdown.ts';
import { checkSync, recordSync, hashContent, closeDb } from '../profile/state.ts';
import { paths } from '../profile/paths.ts';

const ADAPTERS: Record<Source, () => Adapter> = {
  claude_code: () => new ClaudeCodeAdapter(),
  chatgpt: () => new ChatGPTAdapter(),
  claude_web: () => new ClaudeWebAdapter(),
  gemini: () => new GeminiAdapter(),
  codex: () => new CodexAdapter(),
  openclaw: () => new OpenClawAdapter(),
  grok: () => new GrokAdapter(),
  deepseek: () => new DeepSeekAdapter(),
};

export async function sync(sourceArg?: string, dryRun = false) {
  if (sourceArg === 'claude') sourceArg = 'claude_web';

  const sources: Source[] = sourceArg
    ? [sourceArg as Source]
    : ['claude_code', 'chatgpt', 'claude_web', 'gemini', 'codex', 'openclaw', 'grok', 'deepseek'];

  let totalNew = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const source of sources) {
    if (!ADAPTERS[source]) {
      console.log(`Unknown source: ${source}`);
      continue;
    }

    console.log(`\n--- Syncing ${source} ---`);
    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    try {
      const adapter = ADAPTERS[source]();
      for await (const conv of adapter.sync()) {
        const md = conversationToMarkdown(conv);
        const hash = hashContent(md);
        const action = checkSync(source, conv.id, hash);

        if (action === 'skip') {
          skippedCount++;
          continue;
        }

        if (dryRun) {
          console.log(`  [dry-run] ${action}: ${conv.title} (${conv.messages.length} msgs)`);
          if (action === 'insert') newCount++;
          else updatedCount++;
          continue;
        }

        // Write markdown file
        const raw = new Date(conv.created_at);
        const date = isNaN(raw.getTime()) ? new Date() : raw;
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const outPath = paths.conversationFile(source, year, month, conv.id);
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, md, 'utf-8');

        // Record in sync db
        recordSync(source, conv.id, hash);

        if (action === 'insert') {
          newCount++;
          console.log(`  + ${conv.title} (${conv.messages.length} msgs)`);
        } else {
          updatedCount++;
          console.log(`  ~ ${conv.title} (updated)`);
        }
      }
    } catch (e) {
      console.error(`  Error syncing ${source}: ${e}`);
    }

    console.log(`  ${source}: ${newCount} new, ${updatedCount} updated, ${skippedCount} skipped`);
    totalNew += newCount;
    totalUpdated += updatedCount;
    totalSkipped += skippedCount;

    // Log
    try {
      await appendFile(paths.syncLog,
        `${new Date().toISOString()} sync ${source}: ${newCount} new, ${updatedCount} updated, ${skippedCount} skipped\n`
      );
    } catch {}
  }

  console.log(`\nTotal: ${totalNew} new, ${totalUpdated} updated, ${totalSkipped} skipped`);
  closeDb();
}
