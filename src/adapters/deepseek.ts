import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { Adapter } from './base.ts';
import type { Conversation, Message, ContentBlock } from '../normalize/schema.ts';
import { paths } from '../profile/paths.ts';

interface DeepSeekFragment {
  id?: number;
  type: 'REQUEST' | 'RESPONSE' | 'THINKING' | string;
  content?: string;
  thinking_content?: string;
}

interface DeepSeekMessage {
  message_id: number;
  parent_id: number | null;
  role: 'USER' | 'ASSISTANT';
  thinking_enabled?: boolean;
  status: string;
  inserted_at: number; // unix seconds
  model?: string;
  fragments: DeepSeekFragment[];
}

interface DeepSeekConversation {
  id: string;
  title: string;
  model_type: string;
  updated_at: number; // unix seconds
  inserted_at?: number;
  agent?: string;
  messages: DeepSeekMessage[];
}

interface DeepSeekExport {
  conversations: DeepSeekConversation[];
}

function unixToIso(ts: number): string {
  if (!ts) return '';
  return new Date(ts * 1000).toISOString();
}

export class DeepSeekAdapter implements Adapter {
  source = 'deepseek' as const;

  async *sync(): AsyncIterable<Conversation> {
    const rawDir = paths.rawSource('deepseek');
    let files: string[];
    try {
      files = (await readdir(rawDir)).filter(f => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of files) {
      const filePath = join(rawDir, file);
      let data: DeepSeekExport;
      try {
        const raw = await readFile(filePath, 'utf-8');
        data = JSON.parse(raw) as DeepSeekExport;
      } catch (e) {
        console.error(`Failed to read ${filePath}: ${e}`);
        continue;
      }

      for (const conv of data.conversations || []) {
        try {
          const converted = this.convertConversation(conv);
          if (converted && converted.messages.length > 0) {
            yield converted;
          }
        } catch (e) {
          console.error(`Failed to convert deepseek conversation ${conv.id}: ${e}`);
        }
      }
    }
  }

  private convertConversation(conv: DeepSeekConversation): Conversation | null {
    if (!conv.messages || conv.messages.length === 0) return null;

    const messages: Message[] = [];
    let model: string | null = conv.model_type && conv.model_type !== 'default' ? conv.model_type : null;

    for (const msg of conv.messages) {
      const role: Message['role'] = msg.role === 'USER' ? 'user' : 'assistant';
      const content: ContentBlock[] = [];

      for (const frag of msg.fragments || []) {
        const fragType = frag.type;

        if (fragType === 'REQUEST' || fragType === 'RESPONSE') {
          if (frag.content) {
            content.push({ type: 'text', text: frag.content });
          }
        } else if (fragType === 'THINKING') {
          const thinkingText = frag.thinking_content || frag.content || '';
          if (thinkingText) {
            content.push({ type: 'thinking', text: thinkingText });
          }
        }
      }

      if (content.length === 0) continue;

      messages.push({
        timestamp: unixToIso(msg.inserted_at),
        role,
        model: role === 'assistant' ? (msg.model || model || undefined) : undefined,
        content,
      });
    }

    if (messages.length === 0) return null;

    return {
      id: `deepseek_${conv.id}`,
      source: 'deepseek',
      title: conv.title || conv.id,
      model,
      project: null,
      created_at: unixToIso(conv.inserted_at || 0) || unixToIso(conv.updated_at),
      updated_at: unixToIso(conv.updated_at),
      messages,
      attachments: [],
      source_metadata: {
        session_id: conv.id,
        model_type: conv.model_type,
        agent: conv.agent,
      },
      original_url: `https://chat.deepseek.com/chat/${conv.id}`,
    };
  }
}
