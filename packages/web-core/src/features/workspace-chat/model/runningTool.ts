import type { DisplayEntry } from '@/shared/hooks/useConversationHistory/types';

type Item = { type: string; content?: unknown; entries?: unknown[] };

function isRunningTool(item: Item | undefined): boolean {
  if (!item || item.type !== 'NORMALIZED_ENTRY') return false;
  const entryType = (item.content as { entry_type?: unknown } | undefined)
    ?.entry_type as { type?: string; status?: { status?: string } } | undefined;
  return (
    entryType?.type === 'tool_use' && entryType.status?.status === 'created'
  );
}

/**
 * Whether the newest step is a tool call that hasn't finished (a command,
 * a build, a wait loop). While one runs, the agent is busy on its machine,
 * not waiting for the model, however long it takes.
 */
export function hasRunningTool(entries: DisplayEntry[]): boolean {
  let last = entries[entries.length - 1] as Item | undefined;
  // Grouped rows (work groups, read groups): look at their newest step.
  while (last && last.type !== 'NORMALIZED_ENTRY' && last.entries?.length) {
    last = last.entries[last.entries.length - 1] as Item;
  }
  return isRunningTool(last);
}
