import { ExportError } from "./errors.js";
import type {
  DiscordChannel,
  DiscordMessage,
  FetchMessagesResult,
} from "./types.js";

const API_BASE = "https://discord.com/api/v10";
const MAX_PAGES = 10_000;

export interface DiscordApiOptions {
  token: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
}

export class DiscordApiClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxRetries: number;
  private retryCountValue = 0;

  constructor(private readonly options: DiscordApiOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.maxRetries = options.maxRetries ?? 4;
  }

  get retryCount(): number {
    return this.retryCountValue;
  }

  async getChannel(threadId: string): Promise<DiscordChannel> {
    return this.getJson<DiscordChannel>(`/channels/${threadId}`);
  }

  async getAllMessages(threadId: string): Promise<FetchMessagesResult> {
    const byId = new Map<string, DiscordMessage>();
    let before: string | undefined;
    let pageCount = 0;
    let complete = false;

    while (pageCount < MAX_PAGES) {
      const query = new URLSearchParams({ limit: "100" });
      if (before) query.set("before", before);
      const page = await this.getJson<DiscordMessage[]>(
        `/channels/${threadId}/messages?${query.toString()}`,
      );
      pageCount += 1;

      if (!Array.isArray(page)) {
        throw new ExportError(
          "INVALID_RESPONSE",
          "Discord returned an invalid message list.",
        );
      }
      for (const message of page) {
        if (typeof message?.id !== "string" || !/^\d+$/.test(message.id)) {
          throw new ExportError(
            "INVALID_RESPONSE",
            "Discord returned a message without a valid ID.",
          );
        }
        byId.set(message.id, message);
      }

      if (page.length < 100) {
        complete = true;
        break;
      }
      const oldestId = page.reduce(
        (oldest, message) =>
          BigInt(message.id) < BigInt(oldest) ? message.id : oldest,
        page[0]!.id,
      );
      if (oldestId === before) {
        throw new ExportError(
          "INVALID_RESPONSE",
          "Discord pagination stopped advancing before the export completed.",
        );
      }
      before = oldestId;
    }

    if (!complete) {
      throw new ExportError(
        "EXPORT_FAILED",
        "The export exceeded the safety limit of 10,000 API pages.",
      );
    }

    const messages = [...byId.values()].sort((a, b) => {
      const timeDifference =
        Date.parse(a.timestamp) - Date.parse(b.timestamp);
      return timeDifference || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
    });

    return { messages, pageCount, retryCount: this.retryCountValue };
  }

  private async getJson<T>(route: string): Promise<T> {
    if (!route.startsWith("/channels/")) {
      throw new ExportError("EXPORT_FAILED", "Blocked a non-allowlisted Discord route.");
    }

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${API_BASE}${route}`, {
          method: "GET",
          headers: {
            Authorization: `Bot ${this.options.token}`,
            "User-Agent": "discord-thread-export-mcp/0.1.0",
          },
        });
      } catch (error) {
        if (attempt < this.maxRetries) {
          this.retryCountValue += 1;
          await this.sleep(backoffMilliseconds(attempt));
          continue;
        }
        throw new ExportError(
          "NETWORK_ERROR",
          "Could not reach Discord after several attempts.",
          { cause: error },
        );
      }

      if (response.ok) {
        try {
          return (await response.json()) as T;
        } catch (error) {
          throw new ExportError(
            "INVALID_RESPONSE",
            "Discord returned malformed JSON.",
            { cause: error },
          );
        }
      }

      if (response.status === 429) {
        if (attempt >= this.maxRetries) {
          throw new ExportError(
            "RATE_LIMITED",
            "Discord rate limiting persisted after the retry limit.",
          );
        }
        const retryAfter = await readRetryAfterMilliseconds(response);
        this.retryCountValue += 1;
        await this.sleep(retryAfter);
        continue;
      }

      if (response.status >= 500 && attempt < this.maxRetries) {
        this.retryCountValue += 1;
        await this.sleep(backoffMilliseconds(attempt));
        continue;
      }

      throw classifyHttpError(response.status);
    }
  }
}

function backoffMilliseconds(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8_000);
}

async function readRetryAfterMilliseconds(response: Response): Promise<number> {
  try {
    const body = (await response.json()) as { retry_after?: unknown };
    if (typeof body.retry_after === "number" && body.retry_after >= 0) {
      return Math.ceil(body.retry_after * 1_000);
    }
  } catch {
    // Fall back to the Retry-After header below.
  }
  const header = Number(response.headers.get("retry-after"));
  return Number.isFinite(header) && header >= 0 ? Math.ceil(header * 1_000) : 1_000;
}

function classifyHttpError(status: number): ExportError {
  switch (status) {
    case 401:
      return new ExportError(
        "AUTHENTICATION_FAILED",
        "Discord rejected the bot credentials. Check or reset the local token.",
      );
    case 403:
      return new ExportError(
        "PERMISSION_DENIED",
        "The bot cannot read this thread. Check View Channel, Read Message History, and private-thread membership.",
      );
    case 404:
      return new ExportError(
        "NOT_FOUND",
        "The Discord thread was not found or is not visible to the bot.",
      );
    default:
      return new ExportError(
        status >= 500 ? "DISCORD_UNAVAILABLE" : "EXPORT_FAILED",
        `Discord returned HTTP ${status}.`,
      );
  }
}
