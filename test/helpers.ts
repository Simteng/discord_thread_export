import type { DiscordMessage } from "../src/types.js";

export const GUILD_ID = "123456789012345678";
export const THREAD_ID = "223456789012345678";

export function makeMessage(index: number): DiscordMessage {
  const id = (323456789012345678n + BigInt(index)).toString();
  return {
    id,
    channel_id: THREAD_ID,
    guild_id: GUILD_ID,
    type: 0,
    author: {
      id: "423456789012345678",
      username: "tester",
      global_name: "Test User",
    },
    content: `message ${index}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    attachments: [],
    embeds: [],
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
