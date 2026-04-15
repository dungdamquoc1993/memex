import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { Adapter } from './base.ts';
import type { Conversation, Message, ContentBlock } from '../normalize/schema.ts';
import { paths } from '../profile/paths.ts';

interface ClaudeWebExport {
  conversations: ClaudeWebConversation[];
}

interface ClaudeWebConversation {
  id: string;
  title: string;
  create_time: number;
  update_time: number;
  model: string | null;
  source?: string;
  project?: string | null;
  message_count: number;
  messages: ClaudeWebMessage[];
}

interface ClaudeWebMessage {
  role: string;
  content: string;
  timestamp: number;
  model: string | null;
}

export class ClaudeWebAdapter implements Adapter {
  source = 'claude_web' as const;

  async *sync(): AsyncIterable<Conversation> {
    const originalDir = paths.rawSource('claude_web');
    let files: string[];
    try {
      files = (await readdir(originalDir)).filter(f => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of files) {
      const filePath = join(originalDir, file);
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as ClaudeWebExport;

      if (!data.conversations) continue;

      for (const conv of data.conversations) {
        yield this.convertConversation(conv);
      }
    }
  }

  private convertConversation(raw: ClaudeWebConversation): Conversation {
    const messages: Message[] = [];

    for (const msg of raw.messages || []) {
      if (!msg.content?.trim()) continue;

      const content: ContentBlock[] = [{ type: 'text', text: msg.content }];

      messages.push({
        timestamp: this.toIso(msg.timestamp),
        role: msg.role as Message['role'],
        model: msg.model || undefined,
        content,
      });
    }

    const firstMsgTs = raw.messages?.find(m => m.timestamp > 0)?.timestamp ?? 0;
    const lastMsgTs = [...(raw.messages ?? [])].reverse().find(m => m.timestamp > 0)?.timestamp ?? 0;

    return {
      id: `claude_web_${raw.id}`,
      source: 'claude_web',
      title: raw.title || 'Untitled',
      model: raw.model,
      project: raw.project || null,
      created_at: this.toIso(raw.create_time > 0 ? raw.create_time : firstMsgTs),
      updated_at: this.toIso(raw.update_time > 0 ? raw.update_time : (lastMsgTs || firstMsgTs)),
      messages,
      attachments: [],
      source_metadata: {},
      original_url: `https://claude.ai/chat/${raw.id}`,
    };
  }

  private toIso(ts: number): string {
    if (ts > 0) {
      return new Date(ts * 1000).toISOString();
    }
    return '';
  }
}
