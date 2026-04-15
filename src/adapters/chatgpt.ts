import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { Adapter } from './base.ts';
import type { Conversation, Message, ContentBlock } from '../normalize/schema.ts';
import { paths } from '../profile/paths.ts';

interface ChatGPTExport {
  conversations: ChatGPTConversation[];
}

interface ChatGPTConversation {
  id: string;
  title: string;
  create_time: string | number;
  update_time: string | number;
  model: string | null;
  project: string | null;
  project_id?: string | null;
  archived?: boolean;
  memory_scope?: string;
  has_branches?: boolean;
  message_count: number;
  messages: ChatGPTMessage[];
}

interface ChatGPTMessage {
  role: string;
  content: string;
  timestamp: number;
  model: string | null;
}

export class ChatGPTAdapter implements Adapter {
  source = 'chatgpt' as const;

  async *sync(): AsyncIterable<Conversation> {
    const originalDir = paths.rawSource('chatgpt');
    let files: string[];
    try {
      files = (await readdir(originalDir)).filter(f => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of files) {
      const filePath = join(originalDir, file);
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as ChatGPTExport;

      if (!data.conversations) continue;

      for (const conv of data.conversations) {
        yield this.convertConversation(conv);
      }
    }
  }

  private convertConversation(raw: ChatGPTConversation): Conversation {
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

    return {
      id: `chatgpt_${raw.id}`,
      source: 'chatgpt',
      title: raw.title || 'Untitled',
      model: raw.model,
      project: raw.project,
      created_at: this.toIso(raw.create_time),
      updated_at: this.toIso(raw.update_time),
      messages,
      attachments: [],
      source_metadata: {
        ...(raw.archived !== undefined ? { archived: raw.archived } : {}),
        ...(raw.has_branches ? { has_branches: raw.has_branches } : {}),
        ...(raw.memory_scope ? { memory_scope: raw.memory_scope } : {}),
      },
      original_url: `https://chatgpt.com/c/${raw.id}`,
    };
  }

  private toIso(ts: string | number): string {
    if (typeof ts === 'string' && ts) {
      return new Date(ts).toISOString();
    }
    if (typeof ts === 'number' && ts > 0) {
      return new Date(ts * 1000).toISOString();
    }
    return '';
  }
}
