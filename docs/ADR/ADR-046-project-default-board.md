# ADR-046: New projects get default columns and tags

> Project creation seeds the standard board columns and tags in the same
> transaction; startup backfills projects that have none.

- **Status**: Accepted
- **Date**: 2026-11-20

## Context

Columns (`project_statuses`) and tags (`kanban_tags`) are per project. Project
creation (`POST /v1/projects`) seeded columns in a separate, non-transactional
step whose error was only logged, and seeded no tags. A project created that
way, or created before seeding existed, had an empty board (e.g. `bot-trading`).

## Decision

- `create_project_record` inserts the project, `ProjectStatus::seed_defaults`
  (Todo, In Progress, In Review, Done, Cancelled; colors/terminal flags copied
  from `hivedeck`) and `KanbanTag::seed_defaults` (bug, debug, feature,
  research) in one transaction.
- Startup (`startup.rs`, `main.rs`) runs `backfill_default_statuses` and
  `backfill_default_tags`: only projects with zero statuses / zero tags are
  touched, so custom boards and tags are never overwritten and reruns are no-ops.
- Only the standard set is seeded; columns are not copied from other projects.

## Consequences

A project can no longer exist without its default columns. A user who deletes
every column or tag of a project gets the defaults back on next startup.
