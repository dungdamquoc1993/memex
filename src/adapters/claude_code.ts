import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { Adapter } from './base.ts';
import type { Conversation, Message, ContentBlock } from '../normalize/schema.ts';

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');

interface JsonlEvent {
  type: string;
  parentUuid?: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    role: string;
    content: string | ContentBlockRaw[];
    model?: string;
  };
  isSidechain?: boolean;
  isMeta?: boolean;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  aiTitle?: string;
}

interface ContentBlockRaw {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | { type: string; text: string }[];
}

export class ClaudeCodeAdapter implements Adapter {
  source = 'claude_code' as const;

  async *sync(): AsyncIterable<Conversation> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(CLAUDE_PROJECTS);
    } catch {
      return;
    }

    for (const dir of projectDirs) {
      const projectPath = join(CLAUDE_PROJECTS, dir);
      const projectName = dir.replace(/^-/, '').replace(/-/g, '/');
      let files: string[];
      try {
        files = (await readdir(projectPath)).filter(f => f.endsWith('.jsonl') && !f.includes('/'));
      } catch {
        continue;
      }

      for (const file of files) {
        const filePath = join(projectPath, file);
        const sessionId = basename(file, '.jsonl');
        try {
          const conv = await this.parseSession(filePath, sessionId, projectName);
          if (conv && conv.messages.length > 0) {
            yield conv;
          }
        } catch (e) {
          console.error(`Failed to parse ${filePath}: ${e}`);
        }
      }
    }
  }

  private async parseSession(filePath: string, sessionId: string, project: string): Promise<Conversation | null> {
    const raw = await readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());

    const events: JsonlEvent[] = [];
    let title = sessionId;

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as JsonlEvent;
        events.push(event);
        if (event.type === 'ai-title' && event.aiTitle) {
          title = event.aiTitle;
        }
      } catch {
        continue;
      }
    }

    // Filter to actual user/assistant messages (not meta, not sidechain)
    const msgEvents = events.filter(e =>
      (e.type === 'user' || e.type === 'assistant') &&
      !e.isSidechain &&
      !e.isMeta &&
      e.message
    );

    if (msgEvents.length === 0) return null;

    const messages: Message[] = [];
    let model: string | null = null;

    for (const event of msgEvents) {
      const msg = event.message!;
      const role = msg.role as Message['role'];

      // Skip tool_result messages from user (they're internal plumbing)
      if (role === 'user' && Array.isArray(msg.content)) {
        const isOnlyToolResults = (msg.content as ContentBlockRaw[]).every(b => b.type === 'tool_result');
        if (isOnlyToolResults) continue;
      }

      if (msg.model) model = msg.model;

      const content = this.parseContent(msg.content);
      if (content.length === 0) continue;

      messages.push({
        timestamp: event.timestamp || '',
        role,
        model: msg.model || undefined,
        content,
      });
    }

    if (messages.length === 0) return null;

    const timestamps = messages.map(m => m.timestamp).filter(Boolean).sort();
    const fileStat = await stat(filePath);

    return {
      id: `claude_code_${sessionId}`,
      source: 'claude_code',
      title,
      model,
      project,
      created_at: timestamps[0] || fileStat.birthtime.toISOString(),
      updated_at: timestamps[timestamps.length - 1] || fileStat.mtime.toISOString(),
      messages,
      attachments: [],
      source_metadata: {
        session_id: sessionId,
        project_path: project,
      },
    };
  }

  private parseContent(content: string | ContentBlockRaw[]): ContentBlock[] {
    if (typeof content === 'string') {
      // Skip command/system messages
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
          // Tool results get attached to preceding tool_use — skip as standalone
          break;
      }
    }
    return blocks;
  }
}
