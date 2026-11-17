import {
  ArchiveIcon,
  DotsThreeIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../DropdownMenu';
import { DIM_ROW, HOVER_ROW, TINT_ROW, tintStyle } from './layout';
import { WorkspaceActivityText } from '../WorkspaceActivityText';
import { TreeRow } from './TreeRow';
import { formatRelativeElapsed } from './format';
import type { LeafNode, TreeNodeRenderProps } from './types';

/**
 * Gmail-style workspace leaf: name + relative-elapsed on the first line,
 * file/diff stats on a second small line so long names don't crowd the
 * right edge of a narrow sidebar. Visuals (bold active, muted secondary
 * line, color tokens) are intentionally identical to the ADR-006
 * WorkspaceOutliner leaf.
 *
 * TreeRow owns geometry; we only supply the 2-line content. The taller
 * rowHeight (40px) lets TreeRow's items-center vertically center the
 * column.
 */
export function OutlinerLeafNode({
  node,
  style,
  dragHandle,
  activeWorkspaceId,
  tintColor,
  dimmed,
  onArchiveWorkspace,
  onDeleteWorkspace,
}: TreeNodeRenderProps<LeafNode> & {
  activeWorkspaceId?: string | null;
  tintColor?: string | null;
  dimmed?: boolean;
  onArchiveWorkspace?: (workspaceId: string) => void;
  onDeleteWorkspace?: (workspaceId: string) => void;
}) {
  const { t } = useTranslation('common');
  const ws = node.data.workspace;
  const hasMenu = Boolean(onArchiveWorkspace || onDeleteWorkspace);
  const isActive = ws.id === activeWorkspaceId;
  const elapsed = formatRelativeElapsed(ws.latestProcessCompletedAt);

  return (
    <TreeRow
      node={node}
      style={style}
      dragHandle={dragHandle}
      isActive={isActive}
      rowClassName={cn(
        `group/leaf text-sm leading-tight ${TINT_ROW}`,
        isActive
          ? `text-high font-semibold ${HOVER_ROW}`
          : `text-normal font-light ${HOVER_ROW} hover:text-high`,
        dimmed && DIM_ROW
      )}
    >
      <div className="flex w-full min-w-0 items-center gap-1 [contain:inline-size]">
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0">
        <span
          className="flex min-w-0 items-baseline gap-1.5"
          style={tintStyle(tintColor)}
        >
          <span className="truncate">{ws.name}</span>
          {elapsed && (
            <span className="shrink-0 text-xs text-low">{elapsed}</span>
          )}
        </span>
        <WorkspaceActivityText
          filesChanged={ws.filesChanged}
          linesAdded={ws.linesAdded}
          linesRemoved={ws.linesRemoved}
        />
      </div>
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t('sidebar.workspaceActions', 'Workspace actions')}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                'shrink-0 rounded-sm p-0.5 text-low hover:bg-tertiary hover:text-high',
                'opacity-0 focus:opacity-100 focus:outline-none group-hover/leaf:opacity-100 data-[state=open]:opacity-100'
              )}
            >
              <DotsThreeIcon className="size-4" weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onClick={(e) => e.stopPropagation()}
          >
            {onArchiveWorkspace && (
              <DropdownMenuItem
                onSelect={() => onArchiveWorkspace(ws.id)}
              >
                <ArchiveIcon className="size-4" weight="regular" aria-hidden />
                {ws.isArchived
                  ? t('sidebar.unarchiveWorkspace', 'Unarchive')
                  : t('sidebar.archiveWorkspace', 'Archive')}
              </DropdownMenuItem>
            )}
            {onDeleteWorkspace && (
              <DropdownMenuItem
                className="text-error"
                onSelect={() => onDeleteWorkspace(ws.id)}
              >
                <TrashIcon className="size-4" weight="regular" aria-hidden />
                {t('sidebar.deleteWorkspace', 'Delete workspace…')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      </div>
    </TreeRow>
  );
}
