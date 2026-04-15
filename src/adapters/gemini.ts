import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { Adapter } from './base.ts';
import type { Conversation, Message, ContentBlock } from '../normalize/schema.ts';
import { paths } from '../profile/paths.ts';

interface GeminiExport {
  conversations: GeminiConversation[];
}

interface GeminiConversation {
  id: string;
  title: string;
  create_time: number;
  update_time: number;
  model: string | null;
  source?: string;
  message_count: number;
  messages: GeminiMessage[];
}

interface GeminiMessage {
  role: string;
  content: string;
  timestamp: number;
  model: string | null;
  source?: string;
}

export class GeminiAdapter implements Adapter {
  source = 'gemini' as const;

  async *sync(): AsyncIterable<Conversation> {
    const originalDir = paths.rawSource('gemini');
    let files: string[];
    try {
      files = (await readdir(originalDir)).filter(f => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of files) {
      const filePath = join(originalDir, file);
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as GeminiExport;

      if (!data.conversations) continue;

      for (const conv of data.conversations) {
        yield this.convertConversation(conv);
      }
    }
  }

  private convertConversation(raw: GeminiConversation): Conversation {
    const messages: Message[] = [];

    for (const msg of raw.messages || []) {
      if (!msg.content?.trim()) continue;

      const content: ContentBlock[] = [{ type: 'text', text: msg.content }];

      messages.push({
        // Use per-message timestamp when available; fall back to conversation-level
        timestamp: this.toIso(msg.timestamp > 0 ? msg.timestamp : (raw.update_time || raw.create_time)),
        role: msg.role as Message['role'],
        model: msg.model || undefined,
        content,
      });
    }

    return {
      id: `gemini_${raw.id}`,
      source: 'gemini',
      title: raw.title || 'Untitled',
      model: raw.model,
      project: null,
      created_at: this.toIso(raw.create_time),
      updated_at: this.toIso(raw.update_time || raw.create_time),
      messages,
      attachments: [],
      source_metadata: {},
      original_url: `https://gemini.google.com/app/${raw.id}`,
    };
  }

  private toIso(ts: number): string {
    if (ts > 0) {
      return new Date(ts * 1000).toISOString();
    }
    return '';
  }
}
