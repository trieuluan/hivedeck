# ADR-043: Installing into CLI config

- **Status**: Accepted
- **Date**: 2026-11-19

## Context

ADR-038 states that HiveDeck never edits CLI config. Installing MCP servers
from the MCP page requires writing to that config, which may contain comments.

## Decision

- Extension enablement remains per-run as described in ADR-038.
- Explicit owner-initiated installation from the MCP page writes CLI config,
  preserving comments, backing up the existing file, and replacing it atomically.

## Consequences

- Installed servers are available to the CLI outside HiveDeck runs.
- A `.hivedeck.bak` copy retains the previous config on each write.
