export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url?: string;
  content_type?: string;
  width?: number | null;
  height?: number | null;
  description?: string | null;
}

export interface DiscordReaction {
  count: number;
  count_details?: { burst: number; normal: number };
  me?: boolean;
  emoji: { id: string | null; name: string | null; animated?: boolean };
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  type: number;
  author: DiscordUser;
  member?: { nick?: string | null };
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  message_reference?: Record<string, unknown>;
  referenced_message?: DiscordMessage | null;
  attachments?: DiscordAttachment[];
  embeds?: unknown[];
  reactions?: DiscordReaction[];
  pinned?: boolean;
  flags?: number;
  [key: string]: unknown;
}

export interface DiscordChannel {
  id: string;
  guild_id?: string;
  name?: string;
  type: number;
  parent_id?: string | null;
  message_count?: number;
  thread_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NormalizedMessage {
  schema_version: 2;
  id: string;
  type: number;
  author: {
    id: string;
    username: string;
    display_name: string;
    is_bot: boolean;
  };
  created_at: string;
  edited_at: string | null;
  content: string;
  reply_to: {
    id: string;
    author_id: string;
    content_excerpt: string;
  } | null;
  attachments: Array<{
    filename: string;
    content_type: string | null;
    size: number;
    url: string;
    description: string | null;
  }>;
  embeds: Array<{
    title: string | null;
    description: string | null;
    url: string | null;
    fields: Array<{ name: string; value: string }>;
  }>;
  reactions: Array<{
    emoji: string;
    count: number;
  }>;
  pinned: boolean;
}

export interface FetchMessagesResult {
  messages: DiscordMessage[];
  pageCount: number;
  retryCount: number;
}

export interface ExportMetadata {
  format_version: 2;
  status: "complete" | "incomplete";
  exported_at: string;
  guild_id: string;
  thread_id: string;
  thread: DiscordChannel | null;
  message_count: number;
  oldest_message_at: string | null;
  newest_message_at: string | null;
  api_page_count: number;
  retry_count: number;
  warnings: string[];
  error?: { code: string; message: string };
}

export interface ExportSummary {
  status: "complete";
  guild_id: string;
  thread_id: string;
  thread_name: string;
  message_count: number;
  oldest_message_at: string | null;
  newest_message_at: string | null;
  jsonl_path: string;
  raw_jsonl_path: string;
  markdown_path: string | null;
  metadata_path: string;
  warnings: string[];
}
