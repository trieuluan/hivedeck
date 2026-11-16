import { describe, expect, it } from 'vitest';
import {
  ORCHESTRATOR_DIRECTIVES,
  ORCHESTRATOR_LOOP_INTERVAL,
  composeOrchestratorPrompt,
} from './orchestratorOptions';

// The byte-exact directives-block header — a contract with agents/orchestrator.md.
// Tests key off this distinguishing phrase (present only when the block itself is
// appended).
const DIRECTIVES_BLOCK_HEADER =
  "apply each one's behavior as defined in your instructions";

describe('orchestrator directives', () => {
  it('registers nudge-stuck as an opt-in directive', () => {
    const d = ORCHESTRATOR_DIRECTIVES.find((x) => x.id === 'nudge-stuck');
    expect(d).toBeDefined();
    expect(d?.defaultEnabled).toBe(false);
  });

  it('emits the nudge-stuck flag when enabled', () => {
    const prompt = composeOrchestratorPrompt(new Set(['nudge-stuck']));
    expect(prompt).toContain('- nudge-stuck');
    expect(prompt).toContain(DIRECTIVES_BLOCK_HEADER);
  });

  it('emits no directives block when none are enabled', () => {
    const prompt = composeOrchestratorPrompt(new Set());
    expect(prompt).not.toContain(DIRECTIVES_BLOCK_HEADER);
    expect(prompt).not.toContain('- nudge-stuck');
  });
});

describe('composeOrchestratorPrompt — single-loop per-tick pointer', () => {
  it('arms the /loop timer at the configured interval', () => {
    const prompt = composeOrchestratorPrompt(new Set());
    expect(prompt.startsWith(`/loop ${ORCHESTRATOR_LOOP_INTERVAL} `)).toBe(
      true
    );
  });

  it('points at the captain instructions, not an external plugin', () => {
    const prompt = composeOrchestratorPrompt(new Set());
    // The session runs as HiveDeck's own captain (ADR-030); the pointer defers
    // to its instructions and names the tick order.
    expect(prompt).toContain('HiveDeck captain');
    expect(prompt).toContain('owner messages first');
    expect(prompt).not.toContain('vibe-kanban-indie');
  });

  it('never references the retired sweeper agent', () => {
    const prompt = composeOrchestratorPrompt(new Set(['telegram-fanout']));
    // No sub-agent named `sweeper` exists; a brief that spawns one would fail
    // on the first tick.
    expect(prompt.toLowerCase()).not.toContain('sweeper');
  });

  it('does NOT embed launcher concerns the agent resolves itself', () => {
    const prompt = composeOrchestratorPrompt(new Set(['telegram-fanout']));
    // Agent selection is the launcher's job (`orchestrator_executor_config`
    // + the container pass `--agent`/`--agents`); the /loop body carries none.
    expect(prompt).not.toContain('CLAUDE_PLUGIN_ROOT');
    expect(prompt).not.toContain('orchestrator.prompt.md');
    expect(prompt).not.toContain('--agent');
  });
});
