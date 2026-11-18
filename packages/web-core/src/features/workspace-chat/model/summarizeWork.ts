import type { AggregatedWorkGroup } from '@/shared/hooks/useConversationHistory/types';

/** What a run of steps did, by kind, for its one-line summary. */
export type WorkKind =
  | 'read'
  | 'search'
  | 'command'
  | 'edit'
  | 'web'
  | 'agent'
  | 'tool'
  | 'thinking';

/** Order the kinds read in: what it looked at, then what it did. */
export const WORK_KIND_ORDER: WorkKind[] = [
  'read',
  'search',
  'web',
  'command',
  'edit',
  'agent',
  'tool',
  'thinking',
];

type WorkItem = AggregatedWorkGroup['entries'][number];

function kindOfAction(action: string): Exclude<WorkKind, 'thinking'> {
  switch (action) {
    case 'file_read':
      return 'read';
    case 'search':
      return 'search';
    case 'command_run':
      return 'command';
    case 'file_edit':
      return 'edit';
    case 'web_fetch':
      return 'web';
    case 'task_create':
      return 'agent';
    default:
      return 'tool';
  }
}

/**
 * Count a run's steps by kind. Edits count distinct files; everything else
 * counts calls. Thinking counts once however many blocks there were.
 */
export function summarizeWork(
  entries: WorkItem[]
): Partial<Record<WorkKind, number>> {
  const counts: Partial<Record<WorkKind, number>> = {};
  const add = (kind: WorkKind, n = 1) => {
    counts[kind] = (counts[kind] ?? 0) + n;
  };
  const edited = new Set<string>();
  for (const entry of entries) {
    switch (entry.type) {
      case 'AGGREGATED_GROUP':
        add(kindOfAction(entry.aggregationType), entry.entries.length);
        break;
      case 'AGGREGATED_DIFF_GROUP':
        edited.add(entry.filePath);
        break;
      case 'AGGREGATED_THINKING_GROUP':
        counts.thinking = 1;
        break;
      case 'NORMALIZED_ENTRY': {
        const type = entry.content.entry_type;
        if (type.type === 'thinking') counts.thinking = 1;
        else if (type.type === 'tool_use') {
          const action = type.action_type;
          if (action.action === 'file_edit') edited.add(action.path);
          else add(kindOfAction(action.action));
        }
        break;
      }
      default:
        break;
    }
  }
  if (edited.size) counts.edit = edited.size;
  return counts;
}
