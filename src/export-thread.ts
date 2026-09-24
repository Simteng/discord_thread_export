import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { DiscordApiClient } from "./discord-api.js";
import { ExportError, safeErrorMessage } from "./errors.js";
import { renderThreadMarkdown } from "./markdown.js";
import { normalizeMessage } from "./normalize-message.js";
import {
  assertGuildAllowed,
  parseAllowedGuildIds,
  requireBotToken,
  resolveThreadLocation,
} from "./security.js";
import type {
  DiscordChannel,
  ExportMetadata,
  ExportSummary,
  MessageSelection,
  NormalizedMessage,
} from "./types.js";

const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);

export interface ExportThreadOptions {
  threadUrl?: string;
  threadId?: string;
  includeMarkdown?: boolean;
  afterMessageId?: string;
  beforeMessageId?: string;
  includeBoundaryMessages?: boolean;
  token?: string;
  allowedGuildIds?: string;
  outputRoot?: string;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function exportThread(
  options: ExportThreadOptions,
): Promise<ExportSummary> {
  validateSelectionOptions(options);
  const allowed = parseAllowedGuildIds(
    options.allowedGuildIds ?? process.env.DISCORD_ALLOWED_GUILD_IDS,
  );
  const { guildId, threadId } = resolveThreadLocation(
    options.threadUrl,
    options.threadId,
    allowed,
  );
  assertGuildAllowed(guildId, allowed);
  const token = requireBotToken(options.token ?? process.env.DISCORD_BOT_TOKEN);
  const now = options.now?.() ?? new Date();
  const exportedAt = now.toISOString();
  const outputRoot = path.resolve(
    options.outputRoot ?? path.join(process.cwd(), "data", "exports"),
  );
  const exportDirectory = path.join(
    outputRoot,
    threadId,
    directoryTimestamp(now),
  );
  await mkdir(exportDirectory, { recursive: true });

  const metadataPath = path.join(exportDirectory, "metadata.json");
  let channel: DiscordChannel | null = null;
  let pageCount = 0;
  let retryCount = 0;
  let client: DiscordApiClient | null = null;

  try {
    client = new DiscordApiClient({
      token,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });
    channel = await client.getChannel(threadId);
    validateChannel(channel, guildId, threadId);

    const fetched = await client.getAllMessages(threadId);
    pageCount = fetched.pageCount;
    retryCount = fetched.retryCount;
    const messages = fetched.messages.map((message) => normalizeMessage(message));
    const selectedMessages = hasSelection(options)
      ? selectMessages(messages, options)
      : null;
    const selection = selectedMessages
      ? createSelectionMetadata(messages, selectedMessages, options)
      : null;
    const warnings = collectWarnings(messages, options);
    const oldest = messages[0]?.created_at ?? null;
    const newest = messages.at(-1)?.created_at ?? null;
    const metadata: ExportMetadata = {
      format_version: 3,
      status: "complete",
      exported_at: exportedAt,
      guild_id: guildId,
      thread_id: threadId,
      thread: channel,
      message_count: messages.length,
      oldest_message_at: oldest,
      newest_message_at: newest,
      api_page_count: pageCount,
      retry_count: client?.retryCount ?? retryCount,
      warnings,
      selection,
    };

    const jsonlPath = path.join(exportDirectory, "messages.jsonl");
    const rawJsonlPath = path.join(exportDirectory, "raw-messages.jsonl");
    const markdownPath = path.join(exportDirectory, "thread.md");
    const selectedJsonlPath = selectedMessages
      ? path.join(exportDirectory, "selected-messages.jsonl")
      : null;
    const selectedMarkdownPath = selectedMessages
      ? path.join(exportDirectory, "selected-thread.md")
      : null;
    const selectionMetadataPath = selectedMessages
      ? path.join(exportDirectory, "selection-metadata.json")
      : null;
    await writeAtomic(
      jsonlPath,
      messages.map((message) => JSON.stringify(message)).join("\n") +
        (messages.length > 0 ? "\n" : ""),
    );
    await writeAtomic(
      rawJsonlPath,
      fetched.messages.map((message) => JSON.stringify(message)).join("\n") +
        (fetched.messages.length > 0 ? "\n" : ""),
    );
    if (options.includeMarkdown !== false) {
      await writeAtomic(
        markdownPath,
        renderThreadMarkdown(channel.name ?? threadId, messages),
      );
    }
    if (selectedMessages && selectedJsonlPath && selectionMetadataPath && selection) {
      await writeAtomic(
        selectedJsonlPath,
        selectedMessages.map((message) => JSON.stringify(message)).join("\n") +
          (selectedMessages.length > 0 ? "\n" : ""),
      );
      if (options.includeMarkdown !== false && selectedMarkdownPath) {
        await writeAtomic(
          selectedMarkdownPath,
          renderThreadMarkdown(`${channel.name ?? threadId} — selected range`, selectedMessages),
        );
      }
      await writeAtomic(
        selectionMetadataPath,
        `${JSON.stringify(selection, null, 2)}\n`,
      );
    }
    await writeAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    return {
      status: "complete",
      guild_id: guildId,
      thread_id: threadId,
      thread_name: channel.name ?? threadId,
      message_count: messages.length,
      oldest_message_at: oldest,
      newest_message_at: newest,
      jsonl_path: jsonlPath,
      raw_jsonl_path: rawJsonlPath,
      markdown_path: options.includeMarkdown === false ? null : markdownPath,
      metadata_path: metadataPath,
      selected_message_count: selectedMessages?.length ?? null,
      selected_jsonl_path: selectedJsonlPath,
      selected_markdown_path:
        selectedMessages && options.includeMarkdown !== false
          ? selectedMarkdownPath
          : null,
      selection_metadata_path: selectionMetadataPath,
      analysis_jsonl_path: selectedJsonlPath ?? jsonlPath,
      analysis_markdown_path:
        options.includeMarkdown === false
          ? null
          : (selectedMarkdownPath ?? markdownPath),
      warnings,
    };
  } catch (error) {
    const exportError =
      error instanceof ExportError
        ? error
        : new ExportError("EXPORT_FAILED", safeErrorMessage(error), {
            cause: error,
          });
    const incomplete: ExportMetadata = {
      format_version: 3,
      status: "incomplete",
      exported_at: exportedAt,
      guild_id: guildId,
      thread_id: threadId,
      thread: channel,
      message_count: 0,
      oldest_message_at: null,
      newest_message_at: null,
      api_page_count: pageCount,
      retry_count: retryCount,
      warnings: [],
      selection: null,
      error: { code: exportError.code, message: exportError.message },
    };
    try {
      await writeAtomic(metadataPath, `${JSON.stringify(incomplete, null, 2)}\n`);
    } catch {
      // Preserve the original actionable error if even metadata cannot be written.
    }
    throw exportError;
  }
}

function validateChannel(
  channel: DiscordChannel,
  guildId: string,
  threadId: string,
): void {
  if (
    channel.id !== threadId ||
    channel.guild_id !== guildId ||
    !THREAD_CHANNEL_TYPES.has(channel.type)
  ) {
    throw new ExportError(
      "INVALID_RESPONSE",
      "The Discord URL did not resolve to a thread in the allowed guild.",
    );
  }
}

function collectWarnings(
  messages: readonly NormalizedMessage[],
  options: ExportThreadOptions,
): string[] {
  const warnings: string[] = [];
  if (messages.some((message) => !message.content && message.type === 0)) {
    warnings.push(
      "One or more standard messages have empty content. Check Message Content Intent or inspect their attachments/embeds.",
    );
  }
  const ids = new Set(messages.map((message) => message.id));
  if (options.afterMessageId && !ids.has(options.afterMessageId)) {
    warnings.push(
      "The after_message_id was not present in the complete export; the Snowflake boundary was still applied.",
    );
  }
  if (options.beforeMessageId && !ids.has(options.beforeMessageId)) {
    warnings.push(
      "The before_message_id was not present in the complete export; the Snowflake boundary was still applied.",
    );
  }
  return warnings;
}

function validateSelectionOptions(options: ExportThreadOptions): void {
  for (const [name, value] of [
    ["after_message_id", options.afterMessageId],
    ["before_message_id", options.beforeMessageId],
  ] as const) {
    if (value !== undefined && !/^\d+$/.test(value)) {
      throw new ExportError(
        "INVALID_SELECTION",
        `${name} must be a Discord message ID.`,
      );
    }
  }
  if (
    options.afterMessageId &&
    options.beforeMessageId &&
    BigInt(options.afterMessageId) >= BigInt(options.beforeMessageId)
  ) {
    throw new ExportError(
      "INVALID_SELECTION",
      "after_message_id must be older than before_message_id.",
    );
  }
  if (
    options.includeBoundaryMessages &&
    !options.afterMessageId &&
    !options.beforeMessageId
  ) {
    throw new ExportError(
      "INVALID_SELECTION",
      "include_boundary_messages requires a message boundary.",
    );
  }
}

function hasSelection(options: ExportThreadOptions): boolean {
  return Boolean(options.afterMessageId || options.beforeMessageId);
}

function selectMessages(
  messages: readonly NormalizedMessage[],
  options: ExportThreadOptions,
): NormalizedMessage[] {
  const after = options.afterMessageId ? BigInt(options.afterMessageId) : null;
  const before = options.beforeMessageId ? BigInt(options.beforeMessageId) : null;
  const includeBoundaries = options.includeBoundaryMessages === true;

  return messages.filter((message) => {
    const id = BigInt(message.id);
    const passesAfter =
      after === null || (includeBoundaries ? id >= after : id > after);
    const passesBefore =
      before === null || (includeBoundaries ? id <= before : id < before);
    return passesAfter && passesBefore;
  });
}

function createSelectionMetadata(
  sourceMessages: readonly NormalizedMessage[],
  selectedMessages: readonly NormalizedMessage[],
  options: ExportThreadOptions,
): MessageSelection {
  return {
    after_message_id: options.afterMessageId ?? null,
    before_message_id: options.beforeMessageId ?? null,
    include_boundary_messages: options.includeBoundaryMessages === true,
    source_message_count: sourceMessages.length,
    message_count: selectedMessages.length,
    oldest_message_at: selectedMessages[0]?.created_at ?? null,
    newest_message_at: selectedMessages.at(-1)?.created_at ?? null,
  };
}

async function writeAtomic(destination: string, content: string): Promise<void> {
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
}

function directoryTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, "");
}
