import { mkdir, writeFile, appendFile, readFile } from 'fs/promises';
import { dirname, relative } from 'path';
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
import { checkSync, recordSync, hashContent, closeDb, upsertConversation, conversationCount, clearConversations, exportIndex } from '../profile/state.ts';
import { paths } from '../profile/paths.ts';
import { Glob } from 'bun';

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

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  return fm;
}

async function rebuildIndex(): Promise<number> {
  console.log('\nRebuilding index from existing files...');
  clearConversations();
  let count = 0;
  const glob = new Glob('**/*.md');
  for await (const file of glob.scan({ cwd: paths.memory, absolute: true })) {
    // Skip raw/ and attachments/
    const rel = relative(paths.workdir, file);
    if (rel.startsWith('memory/raw/') || rel.startsWith('memory/attachments/')) continue;

    try {
      const content = await readFile(file, 'utf-8');
      const fm = parseFrontmatter(content);
      if (!fm.id || !fm.source) continue;

      upsertConversation(
        fm.id, fm.source, fm.title ?? '', fm.model === 'null' ? null : (fm.model ?? null),
        fm.project === 'null' ? null : (fm.project ?? null),
        fm.created_at ?? '', fm.updated_at ?? '',
        parseInt(fm.message_count) || 0, wordCount(content),
        fm.original_url === 'null' ? undefined : fm.original_url,
        rel,
      );
      count++;
    } catch {}
  }
  console.log(`  Indexed ${count} conversations`);
  return count;
}

export async function sync(sourceArg?: string, dryRun = false, opts: { noIndex?: boolean; rebuildIndex?: boolean } = {}) {
  if (sourceArg === 'claude') sourceArg = 'claude_web';

  const doIndex = !dryRun && !opts.noIndex;

  // Rebuild index if requested or auto-bootstrap (empty conversations table)
  if (doIndex && (opts.rebuildIndex || conversationCount() === 0)) {
    await rebuildIndex();
  }

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

        // Index conversation
        if (doIndex) {
          const relPath = relative(paths.workdir, outPath);
          upsertConversation(
            conv.id, source, conv.title, conv.model, conv.project,
            conv.created_at, conv.updated_at, conv.messages.length,
            wordCount(md), conv.original_url, relPath,
          );
        }

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

  // Export catalog.jsonl
  if (doIndex) {
    await exportIndex();
    console.log(`Index exported to ${paths.index}`);
  }

  closeDb();
}
