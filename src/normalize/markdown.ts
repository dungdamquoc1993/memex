import type { Conversation, Message, ContentBlock } from './schema.ts';

const TOOL_OUTPUT_MAX = 2000;

export function conversationToMarkdown(conv: Conversation): string {
  const frontmatter = buildFrontmatter(conv);
  const titleHeading = conv.title ? `# ${conv.title}\n\n` : '';
  const body = conv.messages.map(msgToMarkdown).join('\n\n');
  return `${frontmatter}\n${titleHeading}${body}\n`;
}

function buildFrontmatter(conv: Conversation): string {
  const fm: Record<string, unknown> = {
    id: conv.id,
    source: conv.source,
    title: conv.title,
    model: conv.model,
    project: conv.project,
    created_at: conv.created_at,
    updated_at: conv.updated_at,
    message_count: conv.messages.length,
  };
  if (conv.original_url) fm.original_url = conv.original_url;
  if (conv.attachments.length > 0) {
    fm.attachments = conv.attachments.map(a => ({
      name: a.name,
      exists: a.exists,
      ...(a.mime ? { mime: a.mime } : {}),
      ...(a.ref ? { ref: a.ref } : {}),
    }));
  }
  if (Object.keys(conv.source_metadata).length > 0) {
    fm.source_metadata = conv.source_metadata;
  }
  return `---\n${yamlSerialize(fm)}---\n`;
}

function yamlSerialize(obj: Record<string, unknown>, indent = 0): string {
  const pad = '  '.repeat(indent);
  let out = '';
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      out += `${pad}${key}: null\n`;
    } else if (typeof val === 'string') {
      if (val.includes('\n') || val.includes('"') || val.includes(':')) {
        out += `${pad}${key}: ${JSON.stringify(val)}\n`;
      } else {
        out += `${pad}${key}: "${val}"\n`;
      }
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      out += `${pad}${key}: ${val}\n`;
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        out += `${pad}${key}: []\n`;
      } else if (typeof val[0] === 'object') {
        out += `${pad}${key}:\n`;
        for (const item of val) {
          out += `${pad}  - ${yamlSerializeInline(item as Record<string, unknown>)}\n`;
        }
      } else {
        out += `${pad}${key}: [${val.map(v => JSON.stringify(v)).join(', ')}]\n`;
      }
    } else if (typeof val === 'object') {
      out += `${pad}${key}:\n${yamlSerialize(val as Record<string, unknown>, indent + 1)}`;
    }
  }
  return out;
}

function yamlSerializeInline(obj: Record<string, unknown>): string {
  const parts = Object.entries(obj).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `{${parts.join(', ')}}`;
}

function formatTimestamp(iso: string): string {
  if (!iso) return 'unknown';
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  } catch {
    return iso;
  }
}

function msgToMarkdown(msg: Message): string {
  const ts = formatTimestamp(msg.timestamp);
  const modelSuffix = msg.model ? ` (${msg.model})` : '';
  const heading = `## [${ts}] ${msg.role}${modelSuffix}`;

  const blocks: string[] = [];
  let hasThinking = false;
  let hasResponse = false;

  for (const block of msg.content) {
    switch (block.type) {
      case 'thinking':
        hasThinking = true;
        blocks.push(`### Thinking\n\n${block.text}`);
        break;
      case 'text':
        if (hasThinking && !hasResponse) {
          hasResponse = true;
          blocks.push(`### Response\n\n${block.text}`);
        } else {
          blocks.push(block.text);
        }
        break;
      case 'tool_use':
        blocks.push(renderToolUse(block));
        break;
      case 'attachment':
        blocks.push(renderAttachment(block));
        break;
    }
  }

  return `${heading}\n\n${blocks.join('\n\n')}`;
}

function renderToolUse(block: Extract<ContentBlock, { type: 'tool_use' }>): string {
  let out = `### Tool: ${block.name}\n\n`;
  if (block.input) {
    out += `**Input:**\n\`\`\`\n${block.input}\n\`\`\`\n`;
  }
  if (block.output) {
    let output = block.output;
    if (output.length > TOOL_OUTPUT_MAX) {
      const keep = Math.floor(TOOL_OUTPUT_MAX / 2);
      const omitted = output.length - TOOL_OUTPUT_MAX;
      output = `${output.slice(0, keep)}\n\n[... ${omitted} chars omitted ...]\n\n${output.slice(-keep)}`;
    }
    out += `\n**Output:**\n\`\`\`\n${output}\n\`\`\``;
  }
  return out;
}

function renderAttachment(block: Extract<ContentBlock, { type: 'attachment' }>): string {
  if (block.exists && block.ref) {
    return `[attachment: ${block.name}](${block.ref})`;
  }
  const typeInfo = block.mime ? ` (${block.mime})` : '';
  return `[attachment: ${block.name} — NOT AVAILABLE${typeInfo}]`;
}
