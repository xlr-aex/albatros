# Local MCP server

Albatros starts an MCP server at `http://127.0.0.1:8765/mcp`. Only programs on this computer can connect to this address. Each request must include a bearer token.

The development build uses port `8766` and a separate application-data directory. Replace the port in the examples below if you connect to the development build. You can set `ALBATROS_MCP_PORT` before startup to choose another port.

Albatros prints the token once in its terminal at startup. To use the same token each time, set `ALBATROS_MCP_TOKEN` before you start Albatros. The value must contain at least 24 characters.

## Antigravity

Add this configuration to `%USERPROFILE%\.gemini\config\mcp_config.json` for all projects. For one project, use `.agents\mcp_config.json`:

```json
{
  "mcpServers": {
    "albatros": {
      "serverUrl": "http://127.0.0.1:8765/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ALBATROS_TOKEN"
      }
    }
  }
}
```

Replace `YOUR_ALBATROS_TOKEN` with your token.

## OpenCode

Add this configuration to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "albatros": {
      "type": "remote",
      "url": "http://127.0.0.1:8765/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ALBATROS_TOKEN"
      }
    }
  }
}
```

Replace `YOUR_ALBATROS_TOKEN` with your token.

## ChatGPT

Keep the local MCP port off the public internet. Create an OpenAI Secure MCP Tunnel to `http://127.0.0.1:8765/mcp`. Set the same `Authorization` header in the tunnel. Then add the tunnel URL as an MCP connector in ChatGPT.

Search tools only read data. Separate tools create or change feeds, groups, and Laya folders.

## Search posts

You can give `search_posts` a complete question. Albatros extracts useful terms and searches stored posts. If the full-text index returns no result, Albatros tries a broader search. You do not need to split a question into single words.

Example requests:

```text
Use technology_radar for the last 30 days. List the technical advances.
Rank product opportunities and cite the related posts.

List feeds in the AI group. Find recent news about local LLMs.
Show post content and exact sources.

Use get_recent_posts for the News and OSINT groups since 2026-10-16.
Make a timeline. Separate confirmed facts from analysis.
```

Search tools:

- `list_source_groups` and `list_feeds` list groups and feeds.
- `search_posts` accepts a question. You can add `groupIds`, `feedIds`, `since`, and `until` filters. You can also request post content.
- `get_recent_posts` lists recent posts without a search term.
- `get_post_details` shows the source and full context for a post.
- `technology_radar` groups recent technical signals.
