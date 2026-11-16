// The orchestrator is HiveDeck's own captain (ADR-030): a headed Claude Code
// session launched with `--agent hivedeck-captain`, whose instructions ship in
// this repo (`assets/captain/captain.md`, overridable at
// `~/.hivedeck/captain.md`) and whose MCP tools come from this backend's
// `/mcp` endpoint — see `orchestrator_executor_config` in
// crates/server/src/routes/workspaces/create.rs. The `/loop` body this file
// composes is only the SHORT per-tick pointer; the behavior lives in
// captain.md.
//
// ADR-016: the per-tick prompt body (project / board orchestrator prompt) is NOT
// embedded here — it's fetched live by the MCP tool `get_orchestrator_prompt`
// (crates/mcp/src/task_server/tools/orchestrator_prompt.rs) on every tick. Editing
// the prompt in the sidebar editor applies without restarting the orchestrator
// session. See docs/ADR/ADR-016-board-orchestrator-prompts.md for the cross-repo
// contract the captain implements.
//
// This file also owns the spawn-dialog OPTIONS: the toggleable directives the
// operator picks for a run. Each directive is emitted as a thin FLAG (its `id`) in
// a byte-exact "Directives enabled for this run" block appended to the end of the
// spawn prompt; the "Directives" section of `assets/captain/captain.md` defines
// what each flag does — keep the ids in sync.

export interface OrchestratorDirective {
  /** Stable id; the localStorage key, i18n namespace, AND the flag passed to the
   *  agent. The agent instructions define this id's behavior. */
  id: string;
  /** i18n key in tasks.json (`spawnOrchestrator.options.<id>.label`). */
  labelKey: string;
  /** i18n key in tasks.json (`spawnOrchestrator.options.<id>.description`). */
  descriptionKey: string;
  /** Whether the checkbox is ticked by default for a fresh operator. */
  defaultEnabled: boolean;
}

// To add a future directive: append an entry here (with i18n label/description under
// `spawnOrchestrator.options.<id>` in tasks.json) AND define its behavior in the
// agent instructions keyed by the same `id`. Nothing behavioral belongs in this file.
export const ORCHESTRATOR_DIRECTIVES: OrchestratorDirective[] = [
  {
    id: 'auto-unblock',
    labelKey: 'spawnOrchestrator.options.auto-unblock.label',
    descriptionKey: 'spawnOrchestrator.options.auto-unblock.description',
    defaultEnabled: false,
  },
  {
    id: 'auto-answer-questions',
    labelKey: 'spawnOrchestrator.options.auto-answer-questions.label',
    descriptionKey:
      'spawnOrchestrator.options.auto-answer-questions.description',
    defaultEnabled: false,
  },
  {
    id: 'telegram-fanout',
    labelKey: 'spawnOrchestrator.options.telegram-fanout.label',
    descriptionKey: 'spawnOrchestrator.options.telegram-fanout.description',
    defaultEnabled: false,
  },
  {
    id: 'nudge-stuck',
    labelKey: 'spawnOrchestrator.options.nudge-stuck.label',
    descriptionKey: 'spawnOrchestrator.options.nudge-stuck.description',
    defaultEnabled: false,
  },
];

/** The orchestrator's ACTIVE cadence — the interval the `/loop` timer is armed at.
 *  The agent adapts its own cron afterwards (5m active ↔ 30m idle). */
export const ORCHESTRATOR_LOOP_INTERVAL = '5m';

/**
 * Compose the `/loop`-wrapped spawn prompt for the captain session
 * (`claude --agent hivedeck-captain`). It arms the timer at
 * {@link ORCHESTRATOR_LOOP_INTERVAL} with a SHORT per-tick pointer; the full
 * behavior (owner first, watch, dispatch, plan, report) lives in
 * `assets/captain/captain.md`, so `/loop` can re-submit the pointer each tick
 * and survive context compaction over a long run.
 *
 * Enabled directive FLAGS are appended as a "Directives enabled for this run"
 * block ENDING the prompt, in declaration order so the prompt is stable.
 */
export function composeOrchestratorPrompt(
  enabledIds: ReadonlySet<string>
): string {
  const base =
    `/loop ${ORCHESTRATOR_LOOP_INTERVAL} Run one tick as the HiveDeck captain, ` +
    `following your instructions in order: owner messages first, then watch ` +
    `active cards, dispatch from Todo, plan new goals, and end with your report.`;
  const picked = ORCHESTRATOR_DIRECTIVES.filter((d) => enabledIds.has(d.id));
  if (picked.length === 0) return base;
  const flags = picked.map((d) => `- ${d.id}`).join('\n');
  return (
    `${base}\n\nDirectives enabled for this run — apply each one's behavior as ` +
    `defined in your instructions:\n${flags}`
  );
}

const DIRECTIVE_STORAGE_KEY = 'vk:orchestrator-directives';

/** Default enabled-state map derived from the directive declarations. */
export function defaultDirectiveState(): Record<string, boolean> {
  return Object.fromEntries(
    ORCHESTRATOR_DIRECTIVES.map((d) => [d.id, d.defaultEnabled])
  );
}

/**
 * Load persisted checkbox state, merging stored values over the declared defaults so
 * newly-added directives keep their default until the operator touches them.
 */
export function loadDirectiveState(): Record<string, boolean> {
  const defaults = defaultDirectiveState();
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(DIRECTIVE_STORAGE_KEY);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as Record<string, boolean>;
    for (const d of ORCHESTRATOR_DIRECTIVES) {
      if (typeof stored[d.id] === 'boolean') defaults[d.id] = stored[d.id];
    }
  } catch {
    // Corrupt/unparseable value — fall back to defaults.
  }
  return defaults;
}

/** Persist the operator's checkbox state for the next spawn. */
export function saveDirectiveState(state: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DIRECTIVE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode/quota) — non-fatal.
  }
}
