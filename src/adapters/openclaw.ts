import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { Adapter } from './base.ts';
import type { Conversation, Message, ContentBlock } from '../normalize/schema.ts';

const OPENCLAW_ROOT = join(homedir(), '.openclaw');
const AGENTS_DIR = join(OPENCLAW_ROOT, 'agents');

interface SessionMeta {
  sessionId: string;
  model?: string;
  modelProvider?: string;
  origin?: {
    label?: string;
    provider?: string;
    surface?: string;
    chatType?: string;
    from?: string;
    to?: string;
    accountId?: string;
  };
}

interface ClawEvent {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  // session header
  version?: number;
  cwd?: string;
  // message
  message?: {
    role: string;
    content: ClawContentBlock[];
    model?: string;
    api?: string;
    provider?: string;
    usage?: Record<string, unknown>;
    timestamp?: number;
    toolCallId?: string;
  };
}

interface ClawContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  partialJson?: string;
}

interface TranscriptFileInfo {
  archived: boolean;
  archiveReason?: 'reset';
  archiveTimestamp?: string;
}

export class OpenClawAdapter implements Adapter {
  source = 'openclaw' as const;

  async *sync(): AsyncIterable<Conversation> {
    let agentDirs: string[];
    try {
      agentDirs = await readdir(AGENTS_DIR);
    } catch {
      return;
    }

    for (const agent of agentDirs) {
      const sessionsDir = join(AGENTS_DIR, agent, 'sessions');
      let files: string[];
      try {
        files = await readdir(sessionsDir);
      } catch {
        continue;
      }

      // Load sessions.json for metadata
      const metaMap = await this.loadSessionsMeta(join(sessionsDir, 'sessions.json'));

      const jsonlFiles = files.filter(f => this.isTranscriptFile(f));

      for (const file of jsonlFiles) {
        const filePath = join(sessionsDir, file);
        try {
          const conv = await this.parseSession(filePath, agent, metaMap, this.parseTranscriptFileInfo(file));
          if (conv && conv.messages.length > 0) {
            yield conv;
          }
        } catch (e) {
          console.error(`Failed to parse ${filePath}: ${e}`);
        }
      }
    }
  }

  private async loadSessionsMeta(path: string): Promise<Map<string, SessionMeta>> {
    const map = new Map<string, SessionMeta>();
    try {
      const raw = await readFile(path, 'utf-8');
      const data = JSON.parse(raw) as Record<string, SessionMeta>;
      for (const [, entry] of Object.entries(data)) {
        if (entry.sessionId) {
          map.set(entry.sessionId, entry);
        }
      }
    } catch {}
    return map;
  }

  private isTranscriptFile(fileName: string): boolean {
    if (fileName.includes('.deleted.') || fileName.includes('.bak.')) return false;
    return fileName.endsWith('.jsonl') || /\.jsonl\.reset\./.test(fileName);
  }

  private parseTranscriptFileInfo(fileName: string): TranscriptFileInfo {
    const resetMatch = fileName.match(/\.jsonl\.reset\.(.+)$/);
    if (!resetMatch) return { archived: false };
    return {
      archived: true,
      archiveReason: 'reset',
      archiveTimestamp: resetMatch[1]?.replace(/T(\d{2})-(\d{2})-(\d{2})\./, 'T$1:$2:$3.'),
    };
  }

  private async parseSession(filePath: string, agent: string, metaMap: Map<string, SessionMeta>, fileInfo: TranscriptFileInfo): Promise<Conversation | null> {
    const raw = await readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());

    let sessionId = '';
    let sessionTimestamp = '';
    let cwd = '';
    const messages: Message[] = [];
    let model: string | null = null;
    let inferredOrigin: SessionMeta['origin'] | undefined;

    // Track tool calls for pairing with toolResult
    const pendingCalls = new Map<string, { name: string; input: string }>();

    for (const line of lines) {
      let event: ClawEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event.type === 'session') {
        sessionId = event.id || '';
        sessionTimestamp = event.timestamp || '';
        cwd = event.cwd || '';
        continue;
      }

      if (event.type !== 'message' || !event.message) continue;

      const msg = event.message;
      const role = msg.role;
      const timestamp = event.timestamp || (msg.timestamp ? new Date(msg.timestamp).toISOString() : '');

      if (msg.model && msg.model !== 'delivery-mirror') {
        model = msg.model;
      }

      if (role === 'user' || role === 'assistant') {
        if (!inferredOrigin && role === 'user') {
          inferredOrigin = this.inferOriginFromContent(msg.content);
        }

        const content = this.parseContent(msg.content, pendingCalls);
        if (content.length === 0) continue;

        messages.push({
          timestamp,
          role: role as Message['role'],
          model: (msg.model && msg.model !== 'delivery-mirror') ? msg.model : undefined,
          content,
        });
      } else if (role === 'toolResult') {
        const callId = msg.toolCallId || '';
        const call = pendingCalls.get(callId);
        const outputText = msg.content
          .filter(c => c.type === 'text' && c.text)
          .map(c => c.text!)
          .join('\n')
          .slice(0, 2000);

        if (call) {
          messages.push({
            timestamp,
            role: 'tool',
            content: [{
              type: 'tool_use',
              name: call.name,
              input: call.input,
              output: outputText,
              truncated: outputText.length >= 2000,
            }],
          });
          pendingCalls.delete(callId);
        }
      }
    }

    if (!sessionId || messages.length === 0) return null;

    const meta = metaMap.get(sessionId);
    if (!model && meta?.model) model = meta.model;

    const origin = meta?.origin || inferredOrigin;
    const title = origin?.label || sessionId;
    const timestamps = messages.map(m => m.timestamp).filter(Boolean).sort();
    const fileStat = await stat(filePath);

    return {
      id: `openclaw_${agent}_${sessionId}`,
      source: 'openclaw',
      title,
      model,
      project: agent,
      created_at: timestamps[0] || sessionTimestamp || fileStat.birthtime.toISOString(),
      updated_at: timestamps[timestamps.length - 1] || fileStat.mtime.toISOString(),
      messages,
      attachments: [],
      source_metadata: {
        agent,
        session_id: sessionId,
        cwd,
        origin,
        model_provider: meta?.modelProvider,
        archived: fileInfo.archived,
        archive_reason: fileInfo.archiveReason,
        archive_timestamp: fileInfo.archiveTimestamp,
      },
    };
  }

  private inferOriginFromContent(content: ClawContentBlock[]): SessionMeta['origin'] | undefined {
    for (const block of content) {
      if (block.type !== 'text' || !block.text) continue;
      const sender = this.extractJsonSection(block.text, 'Sender (untrusted metadata):');
      const info = this.extractJsonSection(block.text, 'Conversation info (untrusted metadata):');
      const senderId = this.stringValue(sender?.id ?? sender?.sender_id ?? info?.sender_id);
      const senderName = this.stringValue(sender?.name ?? info?.sender);
      const username = this.stringValue(sender?.username);
      if (!senderId && !senderName) continue;

      const label = senderName
        ? `${senderName}${username ? ` (@${username})` : ''}${senderId ? ` id:${senderId}` : ''}`
        : `Telegram ${senderId}`;

      return {
        label,
        provider: 'telegram',
        surface: 'telegram',
        from: senderId ? `telegram:${senderId}` : undefined,
        to: senderId ? `telegram:${senderId}` : undefined,
      };
    }
    return undefined;
  }

  private extractJsonSection(text: string, label: string): Record<string, unknown> | null {
    const idx = text.indexOf(label);
    if (idx === -1) return null;
    const after = text.slice(idx + label.length);
    const match = after.match(/```json\s*([\s\S]*?)```/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1] || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  private stringValue(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
    return undefined;
  }

  private parseContent(content: ClawContentBlock[], pendingCalls: Map<string, { name: string; input: string }>): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    for (const block of content) {
      switch (block.type) {
        case 'text':
          if (block.text) blocks.push({ type: 'text', text: block.text });
          break;
        case 'thinking':
          if (block.text) blocks.push({ type: 'thinking', text: block.text });
          break;
        case 'toolCall': {
          const name = block.name || 'unknown';
          const input = block.arguments
            ? JSON.stringify(block.arguments, null, 2)
            : block.partialJson || '';
          // Store for pairing with toolResult
          if (block.id) {
            pendingCalls.set(block.id, { name, input });
          }
          break;
        }
      }
    }

    return blocks;
  }
}
