# MPID Radar

[![dataset](https://img.shields.io/badge/dataset-2026--07--10%2005%3A15%20UTC-blue)](https://mpid.adriancares.com) [![market partners](https://img.shields.io/badge/market%20partners-9133-green)](data/latest.csv) [![MCP server](https://img.shields.io/badge/MCP-server-orange)](#mcp-server)

A daily snapshot of the public BDEW code directory (German energy market partner IDs).

**Live site: [https://mpid.adriancares.com](https://mpid.adriancares.com)**

## Data

- `data/latest.json` — full snapshot with metadata
- `data/latest.csv` — flat table: `bdew_code, market_function, role_code, company_uid, company_name, company_id, code_row_id`
- `data/diff-latest.json` — machine-readable diff for the most recent change

## Source

[https://bdew-codes.de/Codenumbers/BDEWCodes/CodeOverview](https://bdew-codes.de/Codenumbers/BDEWCodes/CodeOverview)

## MCP server

Lets an agent (Claude, Cursor, Codex…) look up German energy market partner IDs. Runs locally over stdio. **Requires Node 24+**, no install, no dependencies.

### Setup

Add it to your client's MCP config, then restart the client. No install or clone needed — `npx` fetches it.

**Claude Code** — one command:

```bash
claude mcp add mpid-radar -- npx -y mpid-radar-mcp
```

**Cursor** (`~/.cursor/mcp.json`) or **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mpid-radar": { "command": "npx", "args": ["-y", "mpid-radar-mcp"] }
  }
}
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.mpid-radar]
command = "npx"
args = ["-y", "mpid-radar-mcp"]
```

### Tools

- `resolve_market_partner` — main tool. MPID for a company by name (+ optional role). Returns ranked `matches`; with no role, also returns the company's codes grouped by role; flags `ambiguous` so the agent asks instead of guessing.
- `lookup_market_partner` — reverse lookup by exact BDEW/MPID code.
- `list_market_roles` — role codes, German functions, English glosses, counts.
- `get_dataset_metadata` — dataset date, source, record counts.

### Try it

- `Find the Lieferant MPID for Uniper.`
- `Look up BDEW code 4033872000010.`
- `List all market partner IDs for TenneT TSO GmbH.`

### Notes

- **Data stays current**: bundled `data/latest.json` loads instantly; the server refreshes from the published dataset on startup and every 6h. Offline-safe.
- `MPID_RADAR_OFFLINE=1` — bundled data only, no network. `MPID_RADAR_DATA_URL=<url>` — use a mirror.
- Dev only: `npm install && npm test`.

