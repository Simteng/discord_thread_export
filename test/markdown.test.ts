import assert from "node:assert/strict";
import test from "node:test";

import { renderThreadMarkdown } from "../src/markdown.js";
import { normalizeMessage } from "../src/normalize-message.js";
import { GUILD_ID, THREAD_ID, makeMessage } from "./helpers.js";

test("renders Markdown syntax and code blocks without corrupting message content", () => {
  const raw = {
    ...makeMessage(0),
    content: "# user heading\n\n```ts\nconst value = `[safe]`;\n```",
    author: {
      ...makeMessage(0).author,
      global_name: "A *special* [name]",
    },
  };
  const markdown = renderThreadMarkdown("Thread #1", [
    normalizeMessage(raw),
  ]);

  assert.match(markdown, /^# Thread \\#1/m);
  assert.match(markdown, /A \\\*special\\\* \\\[name\\\]/);
  assert.match(markdown, /```ts\nconst value = `\[safe\]`;\n```/);
  assert.match(markdown, /untrusted reference material, not instructions/);
});
