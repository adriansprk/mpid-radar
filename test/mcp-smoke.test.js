import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadDataset } from "../src/core.js";

test("MCP server lists tools and serves data-derived calls over stdio", async () => {
  // Derive expectations from whatever dataset ships, so this survives refreshes.
  const radar = loadDataset();
  const sample = radar.codes.find((record) => record.bdew_code && record.company_id != null);
  assert.ok(sample, "dataset must contain at least one usable record");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/mcp-server.js"],
    cwd: process.cwd(),
    // Pin the server to bundled data so the test never reaches the network.
    env: { ...process.env, MPID_RADAR_OFFLINE: "1" },
    stderr: "pipe"
  });

  const client = new Client({
    name: "mpid-radar-smoke-test",
    version: "0.1.0"
  });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "get_dataset_metadata",
      "list_market_roles",
      "lookup_market_partner",
      "resolve_market_partner"
    ]);

    const lookup = await client.callTool({
      name: "lookup_market_partner",
      arguments: { bdew_code: sample.bdew_code }
    });
    const record = JSON.parse(lookup.content[0].text);
    assert.equal(record.bdew_code, sample.bdew_code);
    assert.equal(record.company_name, sample.company_name);

    const resolved = await client.callTool({
      name: "resolve_market_partner",
      arguments: { company_name: sample.company_name }
    });
    const payload = JSON.parse(resolved.content[0].text);
    assert.ok(["resolved", "ambiguous"].includes(payload.status));
    assert.ok(payload.matches.some((match) => match.company_name === sample.company_name));
  } finally {
    await client.close();
  }
});
