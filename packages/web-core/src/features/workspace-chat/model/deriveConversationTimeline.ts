import { aggregateConsecutiveEntries } from '@/shared/lib/aggregateEntries';
import { collapseTurnWork } from './collapseTurnWork';
import type {
  DisplayEntry,
  PatchTypeWithKey,
} from '@/shared/hooks/useConversationHistory/types';

import {
  buildConversationRowsIncremental,
  type ConversationRow,
} from './conversation-row-model';

export interface DerivedConversationTimeline {
  readonly displayEntries: DisplayEntry[];
  readonly rows: ConversationRow[];
}

function isRenderableConversationEntry(entry: DisplayEntry): boolean {
  if (
    entry.type === 'NORMALIZED_ENTRY' &&
    typeof entry.content !== 'string' &&
    'entry_type' in entry.content
  ) {
    const entryType = entry.content.entry_type.type;
    if (
      entryType === 'system_message' &&
      isNoiseSystemMessage(entry.content.content)
    ) {
      return false;
    }
    return entryType !== 'next_action' && entryType !== 'token_usage_info';
  }

  return (
    entry.type === 'NORMALIZED_ENTRY' ||
    entry.type === 'STDOUT' ||
    entry.type === 'STDERR' ||
    entry.type === 'AGGREGATED_GROUP' ||
    entry.type === 'AGGREGATED_DIFF_GROUP' ||
    entry.type === 'AGGREGATED_THINKING_GROUP' ||
    entry.type === 'AGGREGATED_WORK_GROUP'
  );
}

/** Session bookkeeping some agents print as system messages. */
export function isNoiseSystemMessage(content: string): boolean {
  return /^system initialized with model\b/i.test(content.trim());
}

// Final UI-facing timeline step: aggregate display entries and build stable rows
// for virtualization, navigation, and scroll orchestration.

export function deriveConversationTimeline(
  entries: PatchTypeWithKey[],
  previousDisplayEntries: DisplayEntry[],
  previousRows: ConversationRow[],
  options: { collapseLastTurn: boolean } = { collapseLastTurn: false }
): DerivedConversationTimeline {
  const displayEntries = collapseTurnWork(
    aggregateConsecutiveEntries(entries).filter(isRenderableConversationEntry),
    {
      collapseLastTurn: options.collapseLastTurn,
      previous: previousDisplayEntries,
    }
  );

  const rows = buildConversationRowsIncremental(
    displayEntries,
    previousDisplayEntries,
    previousRows
  );

  return {
    displayEntries,
    rows,
  };
}
