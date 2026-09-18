import type { DiscordMessage, NormalizedMessage } from "./types.js";

export function normalizeMessage(
  message: DiscordMessage,
): NormalizedMessage {
  const displayName =
    message.member?.nick ??
    message.author.global_name ??
    message.author.username;
  const referenced = message.referenced_message;

  return {
    schema_version: 2,
    id: message.id,
    type: message.type,
    author: {
      id: message.author.id,
      username: message.author.username,
      display_name: displayName,
      is_bot: message.author.bot ?? false,
    },
    created_at: message.timestamp,
    edited_at: message.edited_timestamp ?? null,
    content: message.content,
    reply_to: referenced
      ? {
          id: referenced.id,
          author_id: referenced.author.id,
          content_excerpt: excerpt(referenced.content),
        }
      : null,
    attachments: (message.attachments ?? []).map((attachment) => ({
      filename: attachment.filename,
      content_type: attachment.content_type ?? null,
      size: attachment.size,
      url: attachment.url,
      description: attachment.description ?? null,
    })),
    embeds: (message.embeds ?? []).map(normalizeEmbed),
    reactions: (message.reactions ?? []).map((reaction) => ({
      emoji: reaction.emoji.name ?? reaction.emoji.id ?? "?",
      count: reaction.count,
    })),
    pinned: message.pinned ?? false,
  };
}

function excerpt(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 500);
}

function normalizeEmbed(value: unknown): NormalizedMessage["embeds"][number] {
  const embed = isRecord(value) ? value : {};
  const fields = Array.isArray(embed.fields)
    ? embed.fields.flatMap((field) => {
        if (!isRecord(field)) return [];
        if (typeof field.name !== "string" || typeof field.value !== "string") {
          return [];
        }
        return [{ name: field.name, value: field.value }];
      })
    : [];
  return {
    title: typeof embed.title === "string" ? embed.title : null,
    description:
      typeof embed.description === "string" ? embed.description : null,
    url: typeof embed.url === "string" ? embed.url : null,
    fields,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
