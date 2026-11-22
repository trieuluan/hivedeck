import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import type { PriorityLevel } from "./PriorityIcon";
import { InputField } from "./InputField";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { PrimaryButton } from "./PrimaryButton";
import { ButtonGroup, ButtonGroupItem } from "./IconButtonGroup";

export interface KanbanFilterTag {
  id: string;
  name: string;
  color: string;
}

export interface KanbanFilterState<TSortField extends string = string> {
  searchQuery: string;
  priorities: PriorityLevel[];
  tagIds: string[];
  sortField: TSortField;
  sortDirection: "asc" | "desc";
}

export interface KanbanProjectViewIds {
  TEAM: string;
  PERSONAL: string;
}

const DEFAULT_KANBAN_PROJECT_VIEW_IDS: KanbanProjectViewIds = {
  TEAM: "team",
  PERSONAL: "personal",
};

export interface RenderKanbanFiltersDialogProps<
  TTag extends KanbanFilterTag = KanbanFilterTag,
  TSortField extends string = string,
> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: TTag[];
  projectId: string;
  filters: KanbanFilterState<TSortField>;
  showSubIssues: boolean;
  showWorkspaces: boolean;
  onPrioritiesChange: (priorities: PriorityLevel[]) => void;
  onTagsChange: (tagIds: string[]) => void;
  onSortChange: (sortField: TSortField, sortDirection: "asc" | "desc") => void;
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

interface KanbanFilterBarProps<
  TTag extends KanbanFilterTag = KanbanFilterTag,
  TSortField extends string = string,
> {
  isFiltersDialogOpen: boolean;
  onFiltersDialogOpenChange: (open: boolean) => void;
  tags: TTag[];
  activeViewId: string;
  onViewChange: (viewId: string) => void;
  viewIds?: KanbanProjectViewIds;
  projectId: string;
  filters: KanbanFilterState<TSortField>;
  showSubIssues: boolean;
  showWorkspaces: boolean;
  hasActiveFilters: boolean;
  onSearchQueryChange: (searchQuery: string) => void;
  onPrioritiesChange: (priorities: PriorityLevel[]) => void;
  onTagsChange: (tagIds: string[]) => void;
  onSortChange: (sortField: TSortField, sortDirection: "asc" | "desc") => void;
  onShowSubIssuesChange: (show: boolean) => void;
  onShowWorkspacesChange: (show: boolean) => void;
  hideBlocked: boolean;
  onHideBlockedChange: (hide: boolean) => void;
  onlyWithWorkspace?: boolean;
  onOnlyWithWorkspaceChange?: (value: boolean) => void;
  withWorkspaceCount?: number;
  finishedCleanableCount?: number;
  isCleaningFinished?: boolean;
  onCleanupFinished?: () => void;
  onClearFilters: () => void;
  onCreateIssue: () => void;
  shouldAnimateCreateButton: boolean;
  isMobile?: boolean;
  renderFiltersDialog?: (
    props: RenderKanbanFiltersDialogProps<TTag, TSortField>,
  ) => ReactNode;
}

export function KanbanFilterBar<
  TTag extends KanbanFilterTag = KanbanFilterTag,
  TSortField extends string = string,
>({
  isFiltersDialogOpen,
  onFiltersDialogOpenChange,
  tags,
  activeViewId,
  onViewChange,
  viewIds = DEFAULT_KANBAN_PROJECT_VIEW_IDS,
  projectId,
  filters,
  showSubIssues,
  showWorkspaces,
  hasActiveFilters,
  onSearchQueryChange,
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
  finishedCleanableCount = 0,
  isCleaningFinished = false,
  onCleanupFinished,
  onClearFilters,
  onCreateIssue,
  shouldAnimateCreateButton,
  isMobile,
  renderFiltersDialog,
}: KanbanFilterBarProps<TTag, TSortField>) {
  const { t } = useTranslation("common");
  const [mobileSearchExpanded, setMobileSearchExpanded] = useState(false);

  const handleClearSearch = () => {
    onSearchQueryChange("");
  };

  return (
    <>
      {isMobile && mobileSearchExpanded ? (
        <div className="flex items-center gap-half">
          <button
            type="button"
            onClick={() => {
              onSearchQueryChange("");
              setMobileSearchExpanded(false);
            }}
            className="p-half rounded-sm text-low hover:text-normal hover:bg-secondary transition-colors shrink-0"
            aria-label={t("kanban.closeSearch", "Close search")}
          >
            <ArrowLeftIcon className="size-icon-sm" weight="bold" />
          </button>
          <InputField
            value={filters.searchQuery}
            onChange={onSearchQueryChange}
            placeholder={t("kanban.searchPlaceholder", "Search issues...")}
            variant="search"
            className="min-w-0 flex-1"
          />
        </div>
      ) : (
        <div
          className={cn(
            "flex min-w-0 items-center",
            isMobile ? "flex-wrap gap-half" : "flex-nowrap gap-1.5",
          )}
        >
          {/* HiveDeck has one user, so the Team / Personal switch is gone;
              a board left on Personal offers its way back. */}
          {activeViewId === viewIds.PERSONAL && (
            <ButtonGroup className="flex-wrap">
              <ButtonGroupItem onClick={() => onViewChange(viewIds.TEAM)}>
                {t("kanban.team", "Team")}
              </ButtonGroupItem>
            </ButtonGroup>
          )}

          {isMobile ? (
            <button
              type="button"
              onClick={() => setMobileSearchExpanded(true)}
              className={cn(
                "p-half transition-colors rounded-sm",
                filters.searchQuery
                  ? "text-brand hover:text-brand"
                  : "text-low hover:text-normal hover:bg-secondary",
              )}
              aria-label={t("kanban.searchPlaceholder", "Search issues...")}
            >
              <MagnifyingGlassIcon className="size-icon-sm" weight="bold" />
            </button>
          ) : (
            <InputField
              value={filters.searchQuery}
              onChange={onSearchQueryChange}
              placeholder={t("kanban.searchPlaceholder", "Search issues...")}
              variant="search"
              actionIcon={filters.searchQuery ? XIcon : undefined}
              onAction={handleClearSearch}
              className="min-w-[110px] w-[140px] xl:w-[190px] shrink max-w-full"
            />
          )}

          {(() => {
            const activeFilterCount =
              (filters.priorities.length > 0 ? 1 : 0) +
              (filters.tagIds.length > 0 ? 1 : 0) +
              (hideBlocked ? 1 : 0) +
              (onlyWithWorkspace ? 1 : 0);
            const triggerButton = (
              <button
                type="button"
                onClick={
                  renderFiltersDialog
                    ? undefined
                    : () => onFiltersDialogOpenChange(true)
                }
                className={cn(
                  "inline-flex h-7 shrink-0 whitespace-nowrap items-center gap-1 rounded-sm border px-2 text-xs font-medium transition-colors",
                  hasActiveFilters || activeFilterCount > 0
                    ? "border-brand/60 bg-brand/15 text-brand hover:bg-brand/20"
                    : "border-border/70 bg-secondary/40 text-low hover:text-normal hover:bg-secondary",
                )}
                aria-label={t("kanban.filters", "Open filters")}
                title={t("kanban.filters", "Open filters")}
              >
                <FunnelIcon className="size-3.5 shrink-0" weight="bold" />
                <span>Filter</span>
                {activeFilterCount > 0 && (
                  <span className="rounded bg-brand px-1 text-[10px] font-semibold text-white tabular-nums">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            );

            if (!renderFiltersDialog) return triggerButton;

            return (
              <Popover
                open={isFiltersDialogOpen}
                onOpenChange={onFiltersDialogOpenChange}
              >
                <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
                <PopoverContent
                  align="end"
                  sideOffset={8}
                  className="z-[9999] w-[min(23rem,calc(100vw-2rem))] p-0"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onInteractOutside={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (
                      target?.closest(
                        '[data-radix-popper-content-wrapper], [role="menu"]',
                      ) ||
                      document.querySelector(
                        '[role="menu"][data-state="open"], [data-radix-menu-content][data-state="open"]',
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                  onEscapeKeyDown={(event) => {
                    if (
                      document.querySelector(
                        '[role="menu"][data-state="open"], [data-radix-menu-content][data-state="open"]',
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  {renderFiltersDialog({
                    open: isFiltersDialogOpen,
                    onOpenChange: onFiltersDialogOpenChange,
                    projectId,
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
                    onlyWithWorkspace,
                    onOnlyWithWorkspaceChange,
                    withWorkspaceCount,
                    onClearFilters,
                    asPopover: true,
                  })}
                </PopoverContent>
              </Popover>
            );
          })()}

          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border/70 bg-secondary/40 text-low transition-colors hover:bg-secondary hover:text-normal"
              aria-label={t("kanban.clearFilters", "Clear filters")}
              title={t("kanban.clearFilters", "Clear filters")}
            >
              <XIcon className="size-3.5" weight="bold" />
            </button>
          )}

          {onCleanupFinished && finishedCleanableCount > 0 && (
            <button
              type="button"
              disabled={isCleaningFinished}
              onClick={onCleanupFinished}
              className="inline-flex h-7 shrink-0 whitespace-nowrap items-center gap-1 rounded-sm border border-rose-500/45 bg-rose-500/10 px-2 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              title={t("kanban.cleanupFinishedMenuItem", {
                count: finishedCleanableCount,
                defaultValue: "Dọn workspace đã xong ({{count}})",
              })}
            >
              <TrashIcon className="size-3.5 shrink-0" weight="bold" />
              <span>Dọn</span>
              <span className="rounded bg-rose-500/20 px-1 text-[10px] tabular-nums">
                {finishedCleanableCount}
              </span>
            </button>
          )}

          {isMobile ? (
            <button
              type="button"
              onClick={() => onCreateIssue()}
              className={cn(
                "rounded-sm p-half bg-brand hover:bg-brand-hover text-on-brand transition-colors",
                shouldAnimateCreateButton && "create-issue-attention",
              )}
              aria-label={t("kanban.newIssue", "New issue")}
            >
              <PlusIcon className="size-icon-sm" weight="bold" />
            </button>
          ) : (
            <PrimaryButton
              variant="secondary"
              value={t("kanban.newIssue", "New issue")}
              actionIcon={PlusIcon}
              onClick={() => onCreateIssue()}
              className={cn(
                "shrink-0 whitespace-nowrap",
                shouldAnimateCreateButton && "create-issue-attention",
              )}
            />
          )}
        </div>
      )}
    </>
  );
}
