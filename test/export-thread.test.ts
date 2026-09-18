import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { exportThread } from "../src/export-thread.js";
import { GUILD_ID, THREAD_ID, jsonResponse, makeMessage } from "./helpers.js";

test("writes valid JSONL, Markdown, and complete metadata", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "discord-export-test-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const messages = [makeMessage(1), makeMessage(0)];
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith(`/channels/${THREAD_ID}`)) {
      return jsonResponse({
        id: THREAD_ID,
        guild_id: GUILD_ID,
        name: "Project #discussion",
        type: 11,
      });
    }
    return jsonResponse(messages);
  };

  const result = await exportThread({
    threadUrl: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}`,
    token: "secret",
    allowedGuildIds: GUILD_ID,
    outputRoot,
    now: () => new Date("2026-09-17T06:30:00.000Z"),
    fetch: fetchMock,
  });

  assert.equal(result.message_count, 2);
  assert.ok(result.jsonl_path.startsWith(outputRoot));
  const jsonLines = (await readFile(result.jsonl_path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { content: string });
  assert.deepEqual(
    jsonLines.map((line) => line.content),
    ["message 0", "message 1"],
  );
  assert.ok(jsonLines.every((line) => !("raw" in line)));
  const rawLines = (await readFile(result.raw_jsonl_path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { content: string; guild_id: string });
  assert.equal(rawLines.length, 2);
  assert.ok(rawLines.every((line) => line.guild_id === GUILD_ID));
  assert.ok(result.markdown_path);
  const markdown = await readFile(result.markdown_path, "utf8");
  assert.match(markdown, /Project \\#discussion/);
  const metadata = JSON.parse(await readFile(result.metadata_path, "utf8")) as {
    status: string;
    message_count: number;
  };
  assert.deepEqual(metadata, { ...metadata, status: "complete", message_count: 2 });
});

test("rejects a disallowed guild before making any request", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "discord-export-test-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  let called = false;

  await assert.rejects(
    exportThread({
      threadUrl: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}`,
      token: "secret",
      allowedGuildIds: "923456789012345678",
      outputRoot,
      fetch: async () => {
        called = true;
        return jsonResponse([]);
      },
    }),
  );
  assert.equal(called, false);
});

test("records an incomplete metadata file after an API failure", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "discord-export-test-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const now = new Date("2026-09-17T06:30:00.000Z");

  await assert.rejects(
    exportThread({
      threadUrl: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}`,
      token: "test-token",
      allowedGuildIds: GUILD_ID,
      outputRoot,
      now: () => now,
      fetch: async () => jsonResponse({ message: "forbidden" }, 403),
    }),
  );

  const metadataPath = path.join(
    outputRoot,
    THREAD_ID,
    "20260917T063000000Z",
    "metadata.json",
  );
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
    status: string;
    error: { code: string };
  };
  assert.equal(metadata.status, "incomplete");
  assert.equal(metadata.error.code, "PERMISSION_DENIED");
});

test("exports from a bare thread ID when one Guild is allowed", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "discord-export-test-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith(`/channels/${THREAD_ID}`)) {
      return jsonResponse({
        id: THREAD_ID,
        guild_id: GUILD_ID,
        name: "Bare ID test",
        type: 11,
      });
    }
    return jsonResponse([makeMessage(0)]);
  };

  const result = await exportThread({
    threadId: THREAD_ID,
    token: "test-token",
    allowedGuildIds: GUILD_ID,
    outputRoot,
    fetch: fetchMock,
  });

  assert.equal(result.guild_id, GUILD_ID);
  assert.equal(result.thread_id, THREAD_ID);
  assert.equal(result.message_count, 1);
});
