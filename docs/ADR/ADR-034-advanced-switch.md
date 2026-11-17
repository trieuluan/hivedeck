# ADR-034: Advanced Features Behind a Switch

**Status**: Accepted
**Date**: 2026-11-17
**Relates to**: ADR-029 (product scope), ADR-032 (project cockpit), ADR-033 (headless Claude captain)

## Context

ADR-029 step 2: the main UI should serve the core loop (project → captain → cards → agents → Merge). Inherited features that sit off that loop still showed up everywhere: child boards, per-card pipelines, recurrent routines, spec intake, and a global captain whose sidebar node ("Orchestrator") really held workspaces without a project. A fresh install with no project landed on the bare "new workspace" page.

## Decision

- **One switch**, `showAdvanced` (UI preference in localStorage, default **off**), toggled in Settings → General → "Show advanced features". A UI preference rather than a config field: it only changes what is shown; nothing is deleted and existing data keeps working.
- **Hidden when off:**
  - Settings → Pipeline and Routines.
  - Card panel and create-issue dialog: the Pipeline picker and Spec intake (pipeline *progress* on cards that already have stages stays visible).
  - Sidebar: "Add board" in the project menu, and the ⚡ global-captain button.
  - Navbar / command bar: "Spawn Orchestrator" (the global captain).
- The sidebar's orphan-workspace node is labelled **"Other workspaces"** instead of "Orchestrator"; it lists quick-chat workspaces that belong to no project.
- **Landing:** with no project, `/` shows a welcome screen ("Start with a project" → create-project dialog with repo picker, or "Quick chat without a project"). With projects it still opens the last one.

## Not changed

SpecKit pages, routines and pipelines keep working when reached directly or with the switch on. Removing dead code (`review` crate, `apps/macos`, `hosts` routes) and hiding agents that aren't installed remain ADR-029 follow-ups.

## Consequences

- A new user sees projects, the project's captain, the board and Merge.
- Power features are one checkbox away; the switch is per browser.
