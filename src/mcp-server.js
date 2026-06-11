#!/usr/bin/env node
// Minimal MCP server over stdio. MCP's stdio transport is newline-delimited
// JSON-RPC 2.0, so a tools-only server needs no framework — this keeps the
// package at zero runtime dependencies. (The @modelcontextprotocol/sdk client
// is a devDependency used by the smoke test to verify real-client compatibility.)
import { createInterface } from "node:readline";
import { DatasetHolder } from "./dataset-holder.js";

const SERVER_INFO = { name: "mpid-radar", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-06-18";
const ROLE_CODE_DESC =
  "Optional role code or alias such as LF, NB, MSB, BKV, EIV, BTR, ESA, NN, DP, BIKO, UENB, REG.";

const dataset = new DatasetHolder().start();
const radar = () => dataset.get();

const TOOLS = [
  {
    name: "resolve_market_partner",
    description:
      "Primary tool for finding a market partner ID. Derives the most likely MPID for a company from its name and an optional role, and returns ranked alternatives in 'matches'. Role is a preference, not a strict filter — a strong company match in another role is still returned (demoted), so check each match's market_function. If status is 'ambiguous' or the top match confidence is 'medium'/'low', ask the user to clarify rather than guessing. When no role is given, the response also includes a 'roles' list of the resolved company's codes grouped by market function — use it to answer 'what are all the codes for company X'.",
    inputSchema: {
      type: "object",
      properties: {
        company_name: { type: "string", minLength: 1, description: "Company name or partial company name to resolve." },
        role: { type: "string", description: "Optional role as a German market function or alias, e.g. Lieferant, lf, Netzbetreiber, nb." },
        role_code: { type: "string", description: ROLE_CODE_DESC },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum number of alternatives to return. Defaults to 5." }
      },
      required: ["company_name"]
    },
    handler: (args) => radar().resolveMarketPartner(args)
  },
  {
    name: "lookup_market_partner",
    description: "Look up one exact BDEW/MPID code and return the associated market partner record.",
    inputSchema: {
      type: "object",
      properties: { bdew_code: { type: "string", minLength: 4, description: "Exact BDEW/MPID code." } },
      required: ["bdew_code"]
    },
    handler: ({ bdew_code }) => radar().lookupMarketPartner(bdew_code) || { status: "not_found", bdew_code }
  },
  {
    name: "list_market_roles",
    description: "List market role names, role codes, English glosses, and counts available in the dataset.",
    inputSchema: { type: "object", properties: {} },
    handler: () => radar().listRoles()
  },
  {
    name: "get_dataset_metadata",
    description: "Return MPID Radar dataset freshness, source, record counts, and local source path.",
    inputSchema: { type: "object", properties: {} },
    handler: () => radar().metadata()
  }
];

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize":
      // Echo the client's protocol version so it always matches what it supports.
      return reply(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
      });
    case "tools/call": {
      const tool = TOOL_BY_NAME.get(params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const value = tool.handler(params?.arguments || {});
        return reply(id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
      } catch (error) {
        // Tool-execution failures are returned as a result with isError, not a
        // protocol error, so the client surfaces them to the model.
        return reply(id, { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true });
      }
    }
    default:
      // Unknown notifications (e.g. notifications/initialized) are ignored.
      if (isRequest) return fail(id, -32601, `Method not found: ${method}`);
      return undefined;
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return; // ignore non-JSON noise
  }
  try {
    handle(message);
  } catch (error) {
    if (message?.id !== undefined && message?.id !== null) fail(message.id, -32603, error.message);
  }
});
