import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("stdio server exposes exactly the read-only export tool", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/src/index.js")],
    stderr: "pipe",
  });
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.deepEqual(
      result.tools.map((tool) => tool.name),
      ["discord_export_thread"],
    );
    const invalidCall = await client.callTool({
      name: "discord_export_thread",
      arguments: {
        thread_url:
          "https://evil.example/channels/123456789012345678/223456789012345678",
      },
    });
    assert.equal(invalidCall.isError, true);
  } finally {
    await client.close();
  }
});
