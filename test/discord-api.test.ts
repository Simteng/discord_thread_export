import assert from "node:assert/strict";
import test from "node:test";

import { DiscordApiClient } from "../src/discord-api.js";
import { ExportError } from "../src/errors.js";
import { THREAD_ID, jsonResponse, makeMessage } from "./helpers.js";

for (const [count, expectedPages] of [
  [100, 2],
  [101, 2],
  [200, 3],
  [201, 3],
] as const) {
  test(`paginates ${count} messages, de-duplicates, sorts, and only uses GET`, async () => {
    const all = Array.from({ length: count }, (_, index) => makeMessage(index));
    const newestFirst = [...all].reverse();
    const requests: Array<{ url: string; method: string | undefined }> = [];

    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url: url.toString(), method: init?.method });
      const before = url.searchParams.get("before");
      const eligible = before
        ? newestFirst.filter((message) => BigInt(message.id) < BigInt(before))
        : newestFirst;
      return jsonResponse(eligible.slice(0, 100));
    };

    const client = new DiscordApiClient({ token: "test-token", fetch: fetchMock });
    const result = await client.getAllMessages(THREAD_ID);

    assert.equal(result.pageCount, expectedPages);
    assert.equal(result.messages.length, count);
    assert.equal(new Set(result.messages.map((message) => message.id)).size, count);
    assert.equal(result.messages[0]?.content, "message 0");
    assert.equal(result.messages.at(-1)?.content, `message ${count - 1}`);
    assert.ok(requests.every((request) => request.method === "GET"));
    assert.ok(
      requests.every((request) =>
        request.url.startsWith("https://discord.com/api/v10/channels/"),
      ),
    );
  });
}

test("honors retry_after on 429 then succeeds", async () => {
  const waits: number[] = [];
  let calls = 0;
  const client = new DiscordApiClient({
    token: "secret",
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ retry_after: 0.25 }, 429)
        : jsonResponse([]);
    },
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  const result = await client.getAllMessages(THREAD_ID);
  assert.equal(result.retryCount, 1);
  assert.deepEqual(waits, [250]);
  assert.equal(calls, 2);
});

test("classifies authentication failures without exposing the token", async () => {
  const token = "super-secret-token";
  const client = new DiscordApiClient({
    token,
    fetch: async () => jsonResponse({ message: `bad ${token}` }, 401),
  });

  await assert.rejects(client.getChannel(THREAD_ID), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, new RegExp(token));
    return true;
  });
});

for (const [status, expectedCode] of [
  [401, "AUTHENTICATION_FAILED"],
  [403, "PERMISSION_DENIED"],
  [404, "NOT_FOUND"],
  [500, "DISCORD_UNAVAILABLE"],
] as const) {
  test(`classifies HTTP ${status} as ${expectedCode}`, async () => {
    const client = new DiscordApiClient({
      token: "test-token",
      maxRetries: 0,
      fetch: async () => jsonResponse({ message: "failure" }, status),
    });
    await assert.rejects(
      client.getChannel(THREAD_ID),
      (error: unknown) =>
        error instanceof ExportError && error.code === expectedCode,
    );
  });
}

test("retries temporary server failures a finite number of times", async () => {
  let calls = 0;
  const waits: number[] = [];
  const client = new DiscordApiClient({
    token: "test-token",
    maxRetries: 2,
    fetch: async () => {
      calls += 1;
      return jsonResponse({ message: "unavailable" }, 503);
    },
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  await assert.rejects(client.getChannel(THREAD_ID), ExportError);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1_000]);
});
