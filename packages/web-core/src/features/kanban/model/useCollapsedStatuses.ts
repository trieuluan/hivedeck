import { useCallback, useState } from 'react';

/** A column that collects finished work (terminal, or named like "Done"). */
export function isDoneStatus(status: {
  name: string;
  is_terminal?: boolean;
}): boolean {
  return (
    Boolean(status.is_terminal) ||
    /^(done|complete|completed|close|closed|resolved|finished)$/i.test(
      status.name.trim()
    )
  );
}

const key = (projectId: string) => `hivedeck.kanban.collapsed.${projectId}`;

function load(projectId: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(key(projectId)) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/**
 * Which board columns are folded into a narrow strip. Done-like columns
 * start folded (finished work shouldn't crowd the board); the owner's
 * toggles are remembered per project.
 */
export function useCollapsedStatuses(projectId: string) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() =>
    load(projectId)
  );

  const isCollapsed = useCallback(
    (status: { id: string; name: string; is_terminal?: boolean }) =>
      overrides[status.id] ?? isDoneStatus(status),
    [overrides]
  );

  const setCollapsed = useCallback(
    (statusId: string, collapsed: boolean) => {
      setOverrides((prev) => {
        const next = { ...prev, [statusId]: collapsed };
        try {
          localStorage.setItem(key(projectId), JSON.stringify(next));
        } catch {
          // not persisted; fine
        }
        return next;
      });
    },
    [projectId]
  );

  return { isCollapsed, setCollapsed };
}
