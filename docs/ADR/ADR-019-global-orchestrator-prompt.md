# ADR-019: Global orchestrator prompt

Status: Accepted
Date: 2026-11-20

## Context

ADR-016 stores prompts on project and board rows and resolves the parent chain. ADR-018 removed organisations; no global prompt scope exists. Project creation inserts an empty prompt and does not copy another project's prompt. The reported copying behaviour could not be traced to a repository code path.

## Decision

Store one global prompt in `app_settings`. Append it after the project and board prompts in the existing stack. More specific instructions take precedence. Empty stacks retain the default behaviour. Existing project prompts are not migrated.

## Consequences

To share existing instructions, copy their common portion into Settings → General → Global orchestrator prompt. Save it, review each project's saved stack, then manually remove duplicated instructions from each project where appropriate. Existing prompts remain unchanged until you edit them.
