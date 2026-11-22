import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SortAscendingIcon,
  SortDescendingIcon,
  TagIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { IssuePriority, Tag } from 'shared/remote-types';
import { cn } from '@/shared/lib/utils';
import type {
  KanbanFilterState,
  KanbanSortField,
} from '@/shared/stores/useUiPreferencesStore';
import { Dialog, DialogContent } from '@vibe/ui/components/Dialog';
import { Switch } from '@vibe/ui/components/Switch';
import { PriorityFilterDropdown } from '@vibe/ui/components/PriorityFilterDropdown';
import {
  MultiSelectDropdown,
  type MultiSelectDropdownOption,
} from '@vibe/ui/components/MultiSelectDropdown';
import {
  PropertyDropdown,
  type PropertyDropdownOption,
} from '@vibe/ui/components/PropertyDropdown';

const SORT_OPTIONS: PropertyDropdownOption<KanbanSortField>[] = [
  { value: 'sort_order', label: 'Manual' },
  { value: 'priority', label: 'Priority' },
  { value: 'created_at', label: 'Created' },
  { value: 'updated_at', label: 'Updated' },
  { value: 'title', label: 'Title' },
];

const FILTER_SELECT_WRAPPER_CLASS =
  'min-w-0 [&_button]:w-full [&_button]:min-h-0 [&_button]:h-8 [&_button]:rounded [&_button]:border [&_button]:border-border/80 [&_button]:bg-secondary/40 [&_button]:px-2.5 [&_button]:py-0 [&_button]:text-xs [&_button]:font-medium [&_button:hover]:bg-secondary/70 [&_button>svg:last-child]:ml-auto';

interface KanbanFiltersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  tags: Tag[];
  filters: KanbanFilterState;
  showSubIssues: boolean;
  showWorkspaces: boolean;
  onPrioritiesChange: (priorities: IssuePriority[]) => void;
  onTagsChange: (tagIds: string[]) => void;
  onSortChange: (
    sortField: KanbanSortField,
    sortDirection: 'asc' | 'desc'
  ) => void;
  onShowSubIssuesChange: (show: boolean) => void;
  onShowWorkspacesChange: (show: boolean) => void;
  hideBlocked: boolean;
  onHideBlockedChange: (hide: boolean) => void;
  onlyWithWorkspace?: boolean;
  onOnlyWithWorkspaceChange?: (only: boolean) => void;
  withWorkspaceCount?: number;
  onClearFilters?: () => void;
  asPopover?: boolean;
}

export function KanbanFiltersDialog({
  open,
  onOpenChange,
  tags,
  filters,
  showSubIssues,
  showWorkspaces,
  onPrioritiesChange,
  onTagsChange,
  onSortChange,
  onShowSubIssuesChange,
  onShowWorkspacesChange,
  hideBlocked,
  onHideBlockedChange,
  onlyWithWorkspace = false,
  onOnlyWithWorkspaceChange,
  withWorkspaceCount = 0,
  onClearFilters,
  asPopover = false,
}: KanbanFiltersDialogProps) {
  const { t } = useTranslation('common');

  const tagOptions: MultiSelectDropdownOption<string>[] = useCallback(
    () =>
      tags.map((tag) => ({
        value: tag.id,
        label: tag.name,
        renderOption: () => (
          <div className="flex items-center gap-base">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            {tag.name}
          </div>
        ),
      })),
    [tags]
  )();

  const toggleSortDirection = useCallback(() => {
    onSortChange(
      filters.sortField,
      filters.sortDirection === 'asc' ? 'desc' : 'asc'
    );
  }, [filters.sortDirection, filters.sortField, onSortChange]);

  const content = (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-high">
            {t('kanban.filters', 'Bộ lọc')}
          </h3>
          <p className="mt-0.5 text-xs text-low">
            {t(
              'kanban.filtersDescription',
              'Tùy chỉnh bộ lọc và sắp xếp cho board'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="rounded p-1 text-low transition-colors hover:bg-secondary hover:text-normal"
          aria-label="Đóng"
        >
          <XIcon className="size-4" weight="bold" />
        </button>
      </div>

      <div className="space-y-4 px-4 py-3">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-low">
            Lọc &amp; Sắp xếp
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className={FILTER_SELECT_WRAPPER_CLASS}>
              <PriorityFilterDropdown
                values={filters.priorities}
                onChange={onPrioritiesChange}
                iconOnly={false}
              />
            </div>
            {tags.length > 0 && (
              <div className={FILTER_SELECT_WRAPPER_CLASS}>
                <MultiSelectDropdown
                  values={filters.tagIds}
                  options={tagOptions}
                  onChange={onTagsChange}
                  icon={TagIcon}
                  label={t('kanban.tags', 'Tags')}
                  menuLabel={t('kanban.filterByTag', 'Filter by tag')}
                  iconOnly={false}
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className={cn('flex-1', FILTER_SELECT_WRAPPER_CLASS)}>
              <PropertyDropdown
                value={filters.sortField}
                options={SORT_OPTIONS}
                onChange={(field) => onSortChange(field, filters.sortDirection)}
                icon={
                  filters.sortDirection === 'asc'
                    ? SortAscendingIcon
                    : SortDescendingIcon
                }
                label={t('kanban.sortBy', 'Sắp xếp')}
              />
            </div>
            <button
              type="button"
              onClick={toggleSortDirection}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-border/80 bg-secondary/40 px-2.5 text-xs font-medium text-normal transition-colors hover:bg-secondary/70 hover:text-high"
            >
              {filters.sortDirection === 'asc' ? (
                <>
                  <SortAscendingIcon className="size-3.5" weight="bold" />
                  <span>Tăng dần</span>
                </>
              ) : (
                <>
                  <SortDescendingIcon className="size-3.5" weight="bold" />
                  <span>Giảm dần</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="border-t border-border/70 pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-low">
            Hiển thị
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center justify-between gap-2 rounded border border-border/70 bg-panel px-2.5 py-2">
              <span className="truncate text-xs font-medium text-normal">
                {t('kanban.subIssuesFilterLabel', 'Issue con')}
              </span>
              <Switch
                checked={showSubIssues}
                onCheckedChange={onShowSubIssuesChange}
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded border border-border/70 bg-panel px-2.5 py-2">
              <span className="truncate text-xs font-medium text-normal">
                {t('kanban.workspacesFilterLabel', 'Workspace')}
              </span>
              <Switch
                checked={showWorkspaces}
                onCheckedChange={onShowWorkspacesChange}
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded border border-border/70 bg-panel px-2.5 py-2">
              <span className="truncate text-xs font-medium text-normal">
                {t('kanban.hideBlockedFilterLabel', 'Ẩn bị chặn')}
              </span>
              <Switch
                checked={hideBlocked}
                onCheckedChange={onHideBlockedChange}
              />
            </div>

            {onOnlyWithWorkspaceChange && (
              <div
                className={cn(
                  'flex items-center justify-between gap-2 rounded border px-2.5 py-2 transition-colors',
                  onlyWithWorkspace
                    ? 'border-brand/60 bg-brand/10'
                    : 'border-border/70 bg-panel'
                )}
              >
                <span className="truncate text-xs font-medium text-normal">
                  Còn WS
                  {withWorkspaceCount > 0 ? ` (${withWorkspaceCount})` : ''}
                </span>
                <Switch
                  checked={onlyWithWorkspace}
                  onCheckedChange={onOnlyWithWorkspaceChange}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5">
        {onClearFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="text-xs font-medium text-low underline-offset-2 transition-colors hover:text-normal hover:underline"
          >
            Đặt lại
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="inline-flex h-7 items-center rounded bg-brand px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-hover"
        >
          Xong
        </button>
      </div>
    </div>
  );

  if (asPopover) {
    return content;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] p-0">{content}</DialogContent>
    </Dialog>
  );
}
