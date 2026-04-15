import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { Adapter } from './base.ts';
import type { Conversation, Message, ContentBlock } from '../normalize/schema.ts';
import { paths } from '../profile/paths.ts';

interface GrokResponse {
  responseId: string;
  message: string;
  sender: 'human' | 'assistant';
  createTime: string;
  parentResponseId?: string;
  model?: string;
  webSearchResults?: WebSearchResult[];
}

interface WebSearchResult {
  url?: string;
  title?: string;
  preview?: string;
}

interface GrokConversation {
  conversationId: string;
  title: string;
  createTime: string;
  modifyTime: string;
  starred?: boolean;
  systemPromptName?: string;
  responses: GrokResponse[];
}

interface GrokExport {
  conversations: GrokConversation[];
}

export class GrokAdapter implements Adapter {
  source = 'grok' as const;

  async *sync(): AsyncIterable<Conversation> {
    const rawDir = paths.rawSource('grok');
    let files: string[];
    try {
      files = (await readdir(rawDir)).filter(f => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of files) {
      const filePath = join(rawDir, file);
      let data: GrokExport;
      try {
        const raw = await readFile(filePath, 'utf-8');
        data = JSON.parse(raw) as GrokExport;
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
          console.error(`Failed to convert grok conversation ${conv.conversationId}: ${e}`);
        }
      }
    }
  }

  private convertConversation(conv: GrokConversation): Conversation | null {
    if (!conv.responses || conv.responses.length === 0) return null;

    // Build message tree to get linear conversation path
    const messages: Message[] = [];
    let model: string | null = null;

    for (const resp of conv.responses) {
      const role = resp.sender === 'human' ? 'user' : 'assistant';
      if (resp.model && resp.sender === 'assistant') {
        model = resp.model;
      }

      const content: ContentBlock[] = [];

      // Main message text
      if (resp.message) {
        content.push({ type: 'text', text: resp.message });
      }

      if (content.length === 0) continue;

      messages.push({
        timestamp: resp.createTime || '',
        role,
        model: resp.sender === 'assistant' ? (resp.model || undefined) : undefined,
        content,
      });
    }

    if (messages.length === 0) return null;

    return {
      id: `grok_${conv.conversationId}`,
      source: 'grok',
      title: conv.title || conv.conversationId,
      model,
      project: null,
      created_at: conv.createTime || '',
      updated_at: conv.modifyTime || conv.createTime || '',
      messages,
      attachments: [],
      source_metadata: {
        conversation_id: conv.conversationId,
        starred: conv.starred || false,
        system_prompt_name: conv.systemPromptName || '',
      },
      original_url: `https://grok.com/chat/${conv.conversationId}`,
    };
  }
}
