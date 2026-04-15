import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { Adapter } from './base.ts';
import type { Conversation, Message, ContentBlock } from '../normalize/schema.ts';

const CODEX_SESSIONS = join(homedir(), '.codex', 'sessions');
const CODEX_INDEX = join(homedir(), '.codex', 'session_index.jsonl');

interface SessionMeta {
  id: string;
  timestamp: string;
  cwd: string;
  originator?: string;
  cli_version?: string;
}

interface CodexEvent {
  timestamp?: string;
  type: 'session_meta' | 'response_item' | 'event_msg' | 'turn_context';
  payload: Record<string, unknown>;
}

export class CodexAdapter implements Adapter {
  source = 'codex' as const;

  async *sync(): AsyncIterable<Conversation> {
    // Load session index for titles
    const titleMap = await this.loadTitleMap();

    // Recursively find all .jsonl files
    let sessionFiles: string[];
    try {
      sessionFiles = await this.findJsonlFiles(CODEX_SESSIONS);
    } catch {
      return;
    }

    for (const filePath of sessionFiles) {
      try {
        const conv = await this.parseSession(filePath, titleMap);
        if (conv && conv.messages.length > 0) {
          yield conv;
        }
      } catch (e) {
        console.error(`Failed to parse ${filePath}: ${e}`);
      }
    }
  }

  private async loadTitleMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const raw = await readFile(CODEX_INDEX, 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as { id: string; thread_name?: string };
          if (entry.thread_name) {
            map.set(entry.id, entry.thread_name);
          }
        } catch {}
      }
    } catch {}
    return map;
  }

  private async findJsonlFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.findJsonlFiles(full));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(full);
      }
    }
    return files;
  }

  private async parseSession(filePath: string, titleMap: Map<string, string>): Promise<Conversation | null> {
    const raw = await readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());

    let meta: SessionMeta | null = null;
    const messages: Message[] = [];
    let model: string | null = null;

    // Track function calls to pair with outputs
    const pendingCalls = new Map<string, { name: string; input: string }>();

    for (const line of lines) {
      let event: CodexEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event.type === 'session_meta') {
        // Only take the first session_meta (file may have multiple turns)
        if (!meta) {
          const p = event.payload as Record<string, string>;
          meta = {
            id: p.id,
            timestamp: p.timestamp || event.timestamp || '',
            cwd: p.cwd || '',
            originator: p.originator,
            cli_version: p.cli_version,
          };
        }
        continue;
      }

      if (event.type !== 'response_item') continue;

      const payload = event.payload;
      const pType = payload.type as string;
      const role = payload.role as string | undefined;

      if (pType === 'message' && role) {
        const mappedRole = this.mapRole(role);
        if (!mappedRole) continue;

        const content = this.parseContent(payload.content as ContentBlockRaw[] | undefined);
        if (content.length === 0) continue;

        messages.push({
          timestamp: event.timestamp || '',
          role: mappedRole,
          model: undefined,
          content,
        });
      } else if (pType === 'function_call') {
        const callId = payload.call_id as string || payload.id as string || '';
        const name = payload.name as string || 'unknown';
        const args = typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments);
        // Parse arguments to get a cleaner input
        let input = args;
        try {
          const parsed = JSON.parse(args);
          input = parsed.cmd || args;
        } catch {}
        pendingCalls.set(callId, { name, input });
      } else if (pType === 'function_call_output') {
        const callId = payload.call_id as string || '';
        const output = (payload.output as string || '').slice(0, 2000);
        const call = pendingCalls.get(callId);
        if (call) {
          messages.push({
            timestamp: event.timestamp || '',
            role: 'tool',
            content: [{
              type: 'tool_use',
              name: call.name,
              input: call.input,
              output,
              truncated: (payload.output as string || '').length > 2000,
            }],
          });
          pendingCalls.delete(callId);
        }
      } else if (pType === 'reasoning') {
        // Reasoning/thinking blocks — extract summary if available
        const summary = payload.summary as { text: string }[] | undefined;
        if (summary && summary.length > 0) {
          const text = summary.map(s => s.text).join('\n');
          if (text) {
            messages.push({
              timestamp: event.timestamp || '',
              role: 'assistant',
              content: [{ type: 'thinking', text }],
            });
          }
        }
      }
    }

    if (!meta || messages.length === 0) return null;

    const sessionId = meta.id;
    const title = titleMap.get(sessionId) || sessionId;
    const project = meta.cwd || null;
    const timestamps = messages.map(m => m.timestamp).filter(Boolean).sort();
    const fileStat = await stat(filePath);

    return {
      id: `codex_${sessionId}`,
      source: 'codex',
      title,
      model,
      project,
      created_at: timestamps[0] || meta.timestamp || fileStat.birthtime.toISOString(),
      updated_at: timestamps[timestamps.length - 1] || fileStat.mtime.toISOString(),
      messages,
      attachments: [],
      source_metadata: {
        session_id: sessionId,
        originator: meta.originator,
        cli_version: meta.cli_version,
        cwd: meta.cwd,
      },
    };
  }

  private mapRole(role: string): Message['role'] | null {
    switch (role) {
      case 'user': return 'user';
      case 'assistant': return 'assistant';
      case 'developer': return 'system';
      default: return null;
    }
  }

  private parseContent(content: ContentBlockRaw[] | undefined): ContentBlock[] {
    if (!content || !Array.isArray(content)) return [];

    const blocks: ContentBlock[] = [];
    for (const block of content) {
      const type = block.type as string;
      if ((type === 'input_text' || type === 'output_text') && block.text) {
        blocks.push({ type: 'text', text: block.text });
      }
    }
    return blocks;
  }
}

interface ContentBlockRaw {
  type: string;
  text?: string;
  [key: string]: unknown;
}
