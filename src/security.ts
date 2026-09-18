import { ExportError } from "./errors.js";

const SNOWFLAKE = /^\d{17,20}$/;

export interface ThreadLocation {
  guildId: string;
  threadId: string;
}

export function parseThreadUrl(value: string): ThreadLocation {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExportError(
      "INVALID_URL",
      "thread_url must be an absolute Discord URL such as https://discord.com/channels/<guild_id>/<thread_id>.",
    );
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "discord.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ExportError(
      "INVALID_URL",
      "Only canonical https://discord.com/channels/<guild_id>/<thread_id> URLs are accepted.",
    );
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length !== 3 ||
    parts[0] !== "channels" ||
    !SNOWFLAKE.test(parts[1] ?? "") ||
    !SNOWFLAKE.test(parts[2] ?? "")
  ) {
    throw new ExportError(
      "INVALID_URL",
      "The Discord URL must contain numeric guild and thread IDs and no extra path segments.",
    );
  }

  return { guildId: parts[1]!, threadId: parts[2]! };
}

export function resolveThreadLocation(
  threadUrl: string | undefined,
  threadId: string | undefined,
  allowedGuildIds: ReadonlySet<string>,
): ThreadLocation {
  if ((threadUrl ? 1 : 0) + (threadId ? 1 : 0) !== 1) {
    throw new ExportError(
      "INVALID_URL",
      "Provide exactly one of thread_url or thread_id.",
    );
  }

  if (threadUrl) return parseThreadUrl(threadUrl);
  if (!SNOWFLAKE.test(threadId ?? "")) {
    throw new ExportError(
      "INVALID_URL",
      "thread_id must be a 17–20 digit Discord snowflake.",
    );
  }
  if (allowedGuildIds.size !== 1) {
    throw new ExportError(
      "CONFIGURATION_ERROR",
      "A bare thread_id can only be used when DISCORD_ALLOWED_GUILD_IDS contains exactly one Guild. Use a full thread_url instead.",
    );
  }

  return { guildId: [...allowedGuildIds][0]!, threadId: threadId! };
}

export function parseAllowedGuildIds(value: string | undefined): ReadonlySet<string> {
  const ids = (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0 || ids.some((id) => !SNOWFLAKE.test(id))) {
    throw new ExportError(
      "CONFIGURATION_ERROR",
      "DISCORD_ALLOWED_GUILD_IDS must contain one or more comma-separated numeric guild IDs.",
    );
  }
  return new Set(ids);
}

export function assertGuildAllowed(
  guildId: string,
  allowedGuildIds: ReadonlySet<string>,
): void {
  if (!allowedGuildIds.has(guildId)) {
    throw new ExportError(
      "GUILD_NOT_ALLOWED",
      `Guild ${guildId} is not in DISCORD_ALLOWED_GUILD_IDS. No Discord request was made.`,
    );
  }
}

export function requireBotToken(value: string | undefined): string {
  if (!value?.trim()) {
    throw new ExportError(
      "CONFIGURATION_ERROR",
      "DISCORD_BOT_TOKEN is not configured. Set it in the local MCP server environment.",
    );
  }
  return value.trim();
}
