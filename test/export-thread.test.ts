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
  assert.equal(result.selected_message_count, null);
  assert.equal(result.selected_jsonl_path, null);
  assert.equal(result.analysis_jsonl_path, result.jsonl_path);
  assert.equal(result.analysis_markdown_path, result.markdown_path);
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
    selection: unknown;
  };
  assert.deepEqual(metadata, { ...metadata, status: "complete", message_count: 2 });
  assert.equal(metadata.selection, null);
});

test("keeps the complete export and creates an exclusive selected range", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "discord-export-test-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const newestFirst = Array.from({ length: 5 }, (_, index) => makeMessage(index)).reverse();
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith(`/channels/${THREAD_ID}`)) {
      return jsonResponse({
        id: THREAD_ID,
        guild_id: GUILD_ID,
        name: "Range test",
        type: 11,
      });
    }
    return jsonResponse(newestFirst);
  };

  const result = await exportThread({
    threadUrl: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}`,
    token: "secret",
    allowedGuildIds: GUILD_ID,
    outputRoot,
    afterMessageId: makeMessage(1).id,
    beforeMessageId: makeMessage(4).id,
    fetch: fetchMock,
  });

  assert.equal(result.message_count, 5);
  assert.equal(result.selected_message_count, 2);
  assert.ok(result.selected_jsonl_path);
  assert.ok(result.selected_markdown_path);
  assert.ok(result.selection_metadata_path);
  assert.equal(result.analysis_jsonl_path, result.selected_jsonl_path);
  assert.equal(result.analysis_markdown_path, result.selected_markdown_path);

  const fullLines = (await readFile(result.jsonl_path, "utf8")).trim().split("\n");
  assert.equal(fullLines.length, 5);
  const selectedLines = (await readFile(result.selected_jsonl_path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { content: string });
  assert.deepEqual(
    selectedLines.map((line) => line.content),
    ["message 2", "message 3"],
  );
  const selection = JSON.parse(
    await readFile(result.selection_metadata_path, "utf8"),
  ) as { source_message_count: number; message_count: number };
  assert.deepEqual(selection, {
    ...selection,
    source_message_count: 5,
    message_count: 2,
  });
});

test("can include both selected boundary messages", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "discord-export-test-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const newestFirst = Array.from({ length: 5 }, (_, index) => makeMessage(index)).reverse();
  const result = await exportThread({
    threadUrl: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}`,
    token: "secret",
    allowedGuildIds: GUILD_ID,
    outputRoot,
    afterMessageId: makeMessage(1).id,
    beforeMessageId: makeMessage(4).id,
    includeBoundaryMessages: true,
    includeMarkdown: false,
    fetch: async (input) => {
      const url = new URL(String(input));
      return url.pathname.endsWith(`/channels/${THREAD_ID}`)
        ? jsonResponse({ id: THREAD_ID, guild_id: GUILD_ID, name: "Range", type: 11 })
        : jsonResponse(newestFirst);
    },
  });

  assert.equal(result.message_count, 5);
  assert.equal(result.selected_message_count, 4);
  assert.equal(result.selected_markdown_path, null);
  assert.equal(result.analysis_markdown_path, null);
  assert.ok(result.selected_jsonl_path);
  const selectedLines = (await readFile(result.selected_jsonl_path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { content: string });
  assert.deepEqual(
    selectedLines.map((line) => line.content),
    ["message 1", "message 2", "message 3", "message 4"],
  );
});

test("supports one-sided after and before selections", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "discord-export-test-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const newestFirst = Array.from({ length: 5 }, (_, index) => makeMessage(index)).reverse();
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    return url.pathname.endsWith(`/channels/${THREAD_ID}`)
      ? jsonResponse({ id: THREAD_ID, guild_id: GUILD_ID, name: "One side", type: 11 })
      : jsonResponse(newestFirst);
  };

  const afterResult = await exportThread({
    threadUrl: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}`,
    token: "secret",
    allowedGuildIds: GUILD_ID,
    outputRoot,
    now: () => new Date("2026-09-24T01:00:00.000Z"),
    afterMessageId: makeMessage(2).id,
    fetch: fetchMock,
  });
  const beforeResult = await exportThread({
    threadUrl: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}`,
    token: "secret",
    allowedGuildIds: GUILD_ID,
    outputRoot,
    now: () => new Date("2026-09-24T02:00:00.000Z"),
    beforeMessageId: makeMessage(2).id,
    fetch: fetchMock,
  });

  assert.equal(afterResult.selected_message_count, 2);
  assert.equal(beforeResult.selected_message_count, 2);
});

test("rejects an invalid selection before making any request", async () => {
  let called = false;
  await assert.rejects(
    exportThread({
      threadUrl: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}`,
      token: "secret",
      allowedGuildIds: GUILD_ID,
      afterMessageId: makeMessage(4).id,
      beforeMessageId: makeMessage(1).id,
      fetch: async () => {
        called = true;
        return jsonResponse([]);
      },
    }),
    (error: unknown) =>
      error instanceof Error && error.message.includes("must be older"),
  );
  assert.equal(called, false);
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
