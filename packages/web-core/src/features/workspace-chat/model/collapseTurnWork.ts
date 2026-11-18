import type {
  AggregatedWorkGroup,
  DisplayEntry,
} from '@/shared/hooks/useConversationHistory/types';
import { isAgentErrorText } from './describeAgentError';
import { isAutoTickMessage } from './autoTick';

/**
 * Group the agent's tool work the way Claude Code does: every message the
 * agent writes stays visible, and each run of two or more steps between
 * those messages (reads, searches, commands, edits, thinking) becomes one
 * "worked · 5 steps · 2 files" row. While a turn is running, the run it is
 * still adding to stays expanded so you can follow it live.
 */

type Kind = 'user' | 'answer' | 'visible' | 'work';

const SCRIPT_TOOL_NAMES = new Set([
  'Setup Script',
  'Cleanup Script',
  'Archive Script',
  'Tool Install Script',
]);

type WorkItem = AggregatedWorkGroup['entries'][number];

function kindOf(entry: DisplayEntry): Kind {
  if (entry.type !== 'NORMALIZED_ENTRY') return 'work';
  const entryType = entry.content.entry_type;
  switch (entryType.type) {
    case 'user_message':
      return 'user';
    case 'assistant_message':
      return isAgentErrorText(entry.content.content) ? 'visible' : 'answer';
    case 'error_message':
    case 'user_feedback':
    case 'user_answered_questions':
    case 'loading':
      return 'visible';
    case 'tool_use': {
      const { action_type, status, tool_name } = entryType;
      if (status.status === 'pending_approval') return 'visible';
      if (action_type.action === 'plan_presentation') return 'visible';
      if (SCRIPT_TOOL_NAMES.has(tool_name)) return 'visible';
      return 'work';
    }
    default:
      return 'work';
  }
}

function countWork(entries: WorkItem[]): {
  toolCount: number;
  editedFiles: number;
} {
  let toolCount = 0;
  const files = new Set<string>();
  for (const entry of entries) {
    if (entry.type === 'AGGREGATED_GROUP') {
      toolCount += entry.entries.length;
    } else if (entry.type === 'AGGREGATED_DIFF_GROUP') {
      toolCount += entry.entries.length;
      files.add(entry.filePath);
    } else if (
      entry.type === 'NORMALIZED_ENTRY' &&
      entry.content.entry_type.type === 'tool_use'
    ) {
      toolCount += 1;
      const action = entry.content.entry_type.action_type;
      if (action.action === 'file_edit') files.add(action.path);
    }
  }
  return { toolCount, editedFiles: files.size };
}

export function collapseTurnWork(
  entries: DisplayEntry[],
  options: {
    /** Collapse the last turn too (nothing is running). */
    collapseLastTurn: boolean;
    /** Previous output, to reuse unchanged groups (stable references). */
    previous?: DisplayEntry[];
  }
): DisplayEntry[] {
  const previousGroups = new Map<string, AggregatedWorkGroup>();
  for (const entry of options.previous ?? []) {
    if (entry.type === 'AGGREGATED_WORK_GROUP') {
      previousGroups.set(entry.patchKey, entry);
    }
  }

  const makeGroup = (items: WorkItem[]): AggregatedWorkGroup => {
    const patchKey = `agg-work:${items[0]!.patchKey}`;
    const prev = previousGroups.get(patchKey);
    if (
      prev &&
      prev.entries.length === items.length &&
      prev.entries.every((item, index) => item === items[index])
    ) {
      return prev;
    }
    return {
      type: 'AGGREGATED_WORK_GROUP',
      entries: items,
      ...countWork(items),
      patchKey,
      executionProcessId: items[0]!.executionProcessId,
    };
  };

  // Split into turns: each starts at a user message (the first may not).
  const turns: DisplayEntry[][] = [];
  for (const entry of entries) {
    if (kindOf(entry) === 'user' || turns.length === 0) turns.push([]);
    turns[turns.length - 1]!.push(entry);
  }

  const result: DisplayEntry[] = [];
  turns.forEach((turn, turnIndex) => {
    const settled = turnIndex < turns.length - 1 || options.collapseLastTurn;

    // An older automatic captain turn folds whole (its report included):
    // only the newest report matters, the rest is history.
    const head = turn[0];
    const isOlderTick =
      turnIndex < turns.length - 1 &&
      head?.type === 'NORMALIZED_ENTRY' &&
      head.content.entry_type.type === 'user_message' &&
      isAutoTickMessage(head.content.content);
    if (settled && isOlderTick && turn.length > 1) {
      result.push(head);
      result.push(makeGroup(turn.slice(1) as WorkItem[]));
      return;
    }

    let run: WorkItem[] = [];
    const flush = () => {
      if (run.length >= 2) result.push(makeGroup(run));
      else result.push(...run);
      run = [];
    };
    for (const entry of turn) {
      if (kindOf(entry) === 'work') {
        run.push(entry as WorkItem);
      } else {
        flush();
        result.push(entry);
      }
    }
    // The run a live turn is still adding to stays open.
    if (settled) flush();
    else result.push(...run);
  });
  return result;
}
