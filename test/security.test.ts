import assert from "node:assert/strict";
import test from "node:test";

import { ExportError } from "../src/errors.js";
import {
  assertGuildAllowed,
  parseAllowedGuildIds,
  parseThreadUrl,
  resolveThreadLocation,
} from "../src/security.js";
import { GUILD_ID, THREAD_ID } from "./helpers.js";

test("parses only a canonical Discord thread URL", () => {
  assert.deepEqual(
    parseThreadUrl(`https://discord.com/channels/${GUILD_ID}/${THREAD_ID}`),
    { guildId: GUILD_ID, threadId: THREAD_ID },
  );
});

for (const invalid of [
  `http://discord.com/channels/${GUILD_ID}/${THREAD_ID}`,
  `https://evil.example/channels/${GUILD_ID}/${THREAD_ID}`,
  `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}/messages/1`,
  `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}?before=1`,
  "https://discord.com/channels/@me/123",
]) {
  test(`rejects unsafe URL: ${invalid}`, () => {
    assert.throws(() => parseThreadUrl(invalid), ExportError);
  });
}

test("requires a valid, non-empty guild allowlist", () => {
  assert.deepEqual([...parseAllowedGuildIds(` ${GUILD_ID},${GUILD_ID} `)], [
    GUILD_ID,
  ]);
  assert.throws(() => parseAllowedGuildIds(""), ExportError);
  assert.throws(() => parseAllowedGuildIds("not-an-id"), ExportError);
});

test("rejects a guild outside the allowlist", () => {
  assert.throws(
    () => assertGuildAllowed(GUILD_ID, new Set([THREAD_ID])),
    (error: unknown) =>
      error instanceof ExportError && error.code === "GUILD_NOT_ALLOWED",
  );
});

test("resolves a bare thread ID when exactly one Guild is allowed", () => {
  assert.deepEqual(
    resolveThreadLocation(undefined, THREAD_ID, new Set([GUILD_ID])),
    { guildId: GUILD_ID, threadId: THREAD_ID },
  );
});

test("rejects a bare thread ID when multiple Guilds are allowed", () => {
  assert.throws(
    () =>
      resolveThreadLocation(
        undefined,
        THREAD_ID,
        new Set([GUILD_ID, "323456789012345678"]),
      ),
    (error: unknown) =>
      error instanceof ExportError && error.code === "CONFIGURATION_ERROR",
  );
});

test("requires exactly one thread reference", () => {
  assert.throws(
    () => resolveThreadLocation(undefined, undefined, new Set([GUILD_ID])),
    ExportError,
  );
  assert.throws(
    () =>
      resolveThreadLocation(
        `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}`,
        THREAD_ID,
        new Set([GUILD_ID]),
      ),
    ExportError,
  );
});
