import type {
  AggregatedWorkGroup,
  DisplayEntry,
} from '@/shared/hooks/useConversationHistory/types';
import { isAgentErrorText } from './describeAgentError';

/**
 * Collapse the work inside finished turns (tool calls, thinking, notes the
 * agent wrote between steps) into one row, so a turn reads as: your message,
 * "worked · 12 steps · 3 files", the final answer. The running turn stays
 * expanded so you can follow it live.
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
    const settled =
      turnIndex < turns.length - 1 || options.collapseLastTurn;
    if (!settled) {
      result.push(...turn);
      return;
    }

    // The last answer stays visible; earlier answers are progress notes.
    let lastAnswer = -1;
    turn.forEach((entry, index) => {
      if (kindOf(entry) === 'answer') lastAnswer = index;
    });
    const workEnd = lastAnswer === -1 ? turn.length : lastAnswer;

    let run: WorkItem[] = [];
    const flush = () => {
      if (run.length >= 2) result.push(makeGroup(run));
      else result.push(...run);
      run = [];
    };
    turn.forEach((entry, index) => {
      const kind = kindOf(entry);
      const collapsible =
        index < workEnd && (kind === 'work' || kind === 'answer');
      if (collapsible) {
        run.push(entry as WorkItem);
      } else {
        flush();
        result.push(entry);
      }
    });
    flush();
  });
  return result;
}
