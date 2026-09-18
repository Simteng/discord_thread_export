import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMessage } from "../src/normalize-message.js";
import { GUILD_ID, THREAD_ID, makeMessage } from "./helpers.js";

test("normalizes replies, attachments, embeds, reactions, and edits", () => {
  const referenced = makeMessage(1);
  const message = {
    ...makeMessage(2),
    member: { nick: "Nickname" },
    edited_timestamp: "2026-01-01T01:00:00.000Z",
    message_reference: { message_id: referenced.id },
    referenced_message: referenced,
    attachments: [
      {
        id: "523456789012345678",
        filename: "report.pdf",
        size: 42,
        url: "https://cdn.discordapp.com/attachments/example/report.pdf",
        content_type: "application/pdf",
      },
    ],
    embeds: [{ title: "Example" }],
    reactions: [
      {
        count: 3,
        count_details: { burst: 1, normal: 2 },
        emoji: { id: null, name: "✅" },
      },
    ],
    pinned: true,
    flags: 4,
  };

  const normalized = normalizeMessage(message);
  assert.equal(normalized.author.display_name, "Nickname");
  assert.equal(normalized.edited_at, "2026-01-01T01:00:00.000Z");
  assert.equal(normalized.reply_to?.id, referenced.id);
  assert.equal(normalized.attachments[0]?.filename, "report.pdf");
  assert.deepEqual(normalized.embeds, [
    { title: "Example", description: null, url: null, fields: [] },
  ]);
  assert.equal(normalized.reactions[0]?.count, 3);
  assert.equal(normalized.pinned, true);
  assert.equal("raw" in normalized, false);
  assert.equal("guild_id" in normalized, false);
  assert.equal("thread_id" in normalized, false);
});
