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
    const inputSchema = result.tools[0]?.inputSchema as {
      properties?: Record<string, unknown>;
    };
    assert.ok(inputSchema.properties?.after_message_id);
    assert.ok(inputSchema.properties?.before_message_id);
    assert.ok(inputSchema.properties?.include_boundary_messages);
    const invalidCall = await client.callTool({
      name: "discord_export_thread",
      arguments: {
        thread_url:
          "https://evil.example/channels/123456789012345678/223456789012345678",
      },
    });
    assert.equal(invalidCall.isError, true);
    const invalidBoundaryCall = await client.callTool({
      name: "discord_export_thread",
      arguments: {
        thread_url:
          "https://discord.com/channels/123456789012345678/223456789012345678",
        after_message_id: "not-a-message-id",
      },
    });
    assert.equal(invalidBoundaryCall.isError, true);
  } finally {
    await client.close();
  }
});
