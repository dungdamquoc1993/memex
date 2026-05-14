import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, join, relative, sep } from 'path';
import { homedir } from 'os';
import { Glob } from 'bun';
import type { Adapter } from './base.ts';
import type { Conversation, Message, ContentBlock } from '../normalize/schema.ts';

const CURSOR_PROJECTS = join(homedir(), '.cursor', 'projects');

interface ContentBlockRaw {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | { type: string; text: string }[];
}

interface CursorLine {
  role?: string;
  message?: {
    content?: string | ContentBlockRaw[];
    model?: string;
  };
}

export class CursorAgentAdapter implements Adapter {
  source = 'cursor' as const;

  async *sync(): AsyncIterable<Conversation> {
    if (!existsSync(CURSOR_PROJECTS)) {
      return;
    }
    const glob = new Glob('**/agent-transcripts/**/*.jsonl');
    for await (const abs of glob.scan({ cwd: CURSOR_PROJECTS, absolute: true })) {
      try {
        const conv = await this.parseTranscript(abs);
        if (conv && conv.messages.length > 0) {
          yield conv;
        }
      } catch (e) {
        console.error(`Failed to parse ${abs}: ${e}`);
      }
    }
  }

  private slugFromPath(filePath: string): string {
    const rel = relative(CURSOR_PROJECTS, filePath);
    const i = rel.indexOf(sep);
    return i === -1 ? rel : rel.slice(0, i);
  }

  private async parseTranscript(filePath: string): Promise<Conversation | null> {
    const raw = await readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());

    const sessionId = basename(filePath, '.jsonl');
    const slug = this.slugFromPath(filePath);
    const project = slug.replace(/^-/, '').replace(/-/g, '/');
    const transcriptRel = relative(join(homedir(), '.cursor'), filePath);

    const messages: Message[] = [];
    let model: string | null = null;

    for (const line of lines) {
      let row: CursorLine;
      try {
        row = JSON.parse(line) as CursorLine;
      } catch {
        continue;
      }

      const roleRaw = row.role;
      if (roleRaw !== 'user' && roleRaw !== 'assistant' && roleRaw !== 'system' && roleRaw !== 'tool') continue;
      if (!row.message?.content) continue;

      const msg = row.message;
      if (msg.model) model = msg.model;

      const rawContent = msg.content;
      if (rawContent === undefined) continue;

      const role = roleRaw as Message['role'];
      if (role === 'system') continue;

      if (role === 'user' && Array.isArray(rawContent)) {
        const isOnlyToolResults = rawContent.every(b => b.type === 'tool_result');
        if (isOnlyToolResults) continue;
      }

      const content = this.parseContent(rawContent);
      if (content.length === 0) continue;

      messages.push({
        timestamp: '',
        role,
        model: msg.model || undefined,
        content,
      });
    }

    if (messages.length === 0) return null;

    const title = this.deriveTitle(sessionId, messages);
    const fileStat = await stat(filePath);

    return {
      id: `cursor_${sessionId}`,
      source: 'cursor',
      title,
      model,
      project,
      created_at: fileStat.birthtime.toISOString(),
      updated_at: fileStat.mtime.toISOString(),
      messages,
      attachments: [],
      source_metadata: {
        session_id: sessionId,
        workspace_slug: slug,
        transcript_path: transcriptRel.split(sep).join('/'),
      },
    };
  }

  private deriveTitle(sessionId: string, messages: Message[]): string {
    for (const m of messages) {
      if (m.role !== 'user') continue;
      for (const b of m.content) {
        if (b.type !== 'text') continue;
        let t = b.text.trim();
        const wrapped = t.match(/^<user_query>\s*([\s\S]*?)\s*<\/user_query>$/i);
        if (wrapped) t = wrapped[1]!.trim();
        const first = t.split(/\n+/)[0] ?? t;
        if (first) {
          return first.length > 120 ? `${first.slice(0, 117)}...` : first;
        }
      }
    }
    return sessionId;
  }

  private parseContent(content: string | ContentBlockRaw[]): ContentBlock[] {
    if (typeof content === 'string') {
      if (content.includes('<local-command-') || content.includes('<command-name>')) {
        return [];
      }
      return [{ type: 'text', text: content }];
    }

    const blocks: ContentBlock[] = [];
    for (const block of content) {
      switch (block.type) {
        case 'text':
          if (block.text) blocks.push({ type: 'text', text: block.text });
          break;
        case 'thinking':
          if (block.text) blocks.push({ type: 'thinking', text: block.text });
          break;
        case 'tool_use':
          blocks.push({
            type: 'tool_use',
            name: block.name || 'unknown',
            input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2),
          });
          break;
        case 'tool_result':
          break;
        default:
          break;
      }
    }
    return blocks;
  }
}
