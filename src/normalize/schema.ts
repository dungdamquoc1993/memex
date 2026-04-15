export type Source = 'chatgpt' | 'claude_web' | 'gemini' | 'claude_code' | 'codex' | 'openclaw' | 'grok' | 'deepseek';

export interface Conversation {
  id: string;                    // <source>_<original_id>
  source: Source;
  title: string;
  model: string | null;
  project: string | null;
  created_at: string;            // ISO 8601
  updated_at: string;            // ISO 8601
  messages: Message[];
  attachments: Attachment[];
  source_metadata: Record<string, unknown>;
  original_url?: string;
}

export interface Message {
  timestamp: string;             // ISO 8601
  role: 'user' | 'assistant' | 'system' | 'tool';
  model?: string;
  content: ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; name: string; input: string; output?: string; truncated?: boolean }
  | { type: 'attachment'; kind: 'image' | 'file'; name: string; exists: boolean; mime?: string; ref?: string };

export interface Attachment {
  name: string;
  mime?: string;
  exists: boolean;
  ref?: string;                  // relative path if file was copied
  source_conversation_id: string;
}
