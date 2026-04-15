import type { Conversation, Source } from '../normalize/schema.ts';

export interface Adapter {
  source: Source;
  sync(): AsyncIterable<Conversation>;
}
