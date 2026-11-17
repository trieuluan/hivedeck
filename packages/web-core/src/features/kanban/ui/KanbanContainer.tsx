import {
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useProjects } from '@/shared/hooks/useProjects';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useWorkspacesContext } from '@/shared/hooks/useWorkspacesContext';
import { useActions } from '@/shared/hooks/useActions';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useIsMobile } from '@/shared/hooks/useIsMobile';
import { cn } from '@/shared/lib/utils';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import {
  useUiPreferencesStore,
  resolveKanbanProjectState,
  KANBAN_PROJECT_VIEW_IDS,
  type KanbanFilterState,
  type KanbanSortField,
} from '@/shared/stores/useUiPreferencesStore';
import {
  useKanbanFilters,
  PRIORITY_ORDER,
} from '../model/hooks/useKanbanFilters';
import { type BulkUpdateIssueItem } from '@/shared/lib/remoteApi';
import { persistIssues, persistIssueSwap } from '@/shared/lib/persistIssues';
import {
  ArrowLeftIcon,
  CaretLeftIcon,
  PlusIcon,
  DotsThreeIcon,
} from '@phosphor-icons/react';
import {
  isDoneStatus,
  useCollapsedStatuses,
} from '../model/useCollapsedStatuses';
import { useFlipCards } from '../model/useFlipCards';
import { Actions } from '@/shared/actions';
import {
  buildKanbanIssueComposerKey,
  closeKanbanIssueComposer,
  type ProjectIssueCreateOptions,
  useKanbanIssueComposer,
} from '@/shared/stores/useKanbanIssueComposerStore';
// ADR-019: User entity excised — no UserWithProfile import needed.
import {
  KanbanProvider,
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  type DropResult,
} from '@vibe/ui/components/KanbanBoard';
import { DragDropContext } from '@hello-pangea/dnd';
import { KanbanCardContent } from '@vibe/ui/components/KanbanCardContent';
import { ShipIssueButton } from './ShipIssueButton';
import { KanbanWorkspaceDispatch } from '@vibe/ui/components/KanbanWorkspaceDispatch';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/shared/lib/api';
import {
  IssueWorkspaceCard,
  type WorkspaceWithStats,
  type WorkspacePr,
} from '@vibe/ui/components/IssueWorkspaceCard';
import { resolveRelationshipsForIssue } from '@/shared/lib/resolveRelationships';
import { KanbanFilterBar } from '@vibe/ui/components/KanbanFilterBar';
import { ViewNavTabs } from '@vibe/ui/components/ViewNavTabs';
import { IssueListView } from '@vibe/ui/components/IssueListView';
import { CommandBarDialog } from '@/shared/dialogs/command-bar/CommandBarDialog';
import { KanbanFiltersDialog } from '@/shared/dialogs/kanban/KanbanFiltersDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@vibe/ui/components/Dropdown';
import { SearchableTagDropdownContainer } from '@/shared/components/SearchableTagDropdownContainer';
import type { Issue, IssuePriority } from 'shared/remote-types';
import { PROJECT_WORKSPACES_SHAPE } from 'shared/remote-types';
import { refreshShapeSource } from '@/shared/lib/electric/collections';
import { useIssueMultiSelect } from '@/shared/hooks/useIssueMultiSelect';
import { useIssueSelectionStore } from '@/shared/stores/useIssueSelectionStore';
import { BulkActionBarContainer } from './BulkActionBarContainer';
import { computeKanbanMove } from '../model/computeKanbanMove';
import { buildKanbanMoveUpdates } from '../model/buildKanbanMoveUpdates';
import { createSyncGuard } from '../model/syncGuard';
import { buildProjectBreadcrumb } from '../model/buildProjectBreadcrumb';
import type { BreadcrumbEntry } from '../model/buildProjectBreadcrumb';
import {
  useKanbanDragHandler,
  type KanbanDragHandler,
  type KanbanMove,
} from '@/shared/components/ui-new/containers/KanbanDragHandlerContext';

const areStringSetsEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
};

const areKanbanFiltersEqual = (
  left: KanbanFilterState,
  right: KanbanFilterState
): boolean => {
  if (left.searchQuery.trim() !== right.searchQuery.trim()) {
    return false;
  }

  if (!areStringSetsEqual(left.priorities, right.priorities)) {
    return false;
  }

  if (!areStringSetsEqual(left.tagIds, right.tagIds)) {
    return false;
  }

  return (
    left.sortField === right.sortField &&
    left.sortDirection === right.sortDirection
  );
};

function LoadingState() {
  const { t } = useTranslation('common');
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-low">{t('states.loading')}</p>
    </div>
  );
}

/**
 * Renders the project breadcrumb inside the kanban header. Extracted from
 * the prior inline IIFE in `KanbanContainer` so the JSX stays linear and
 * the render logic is unit-addressable. Last segment is plain text;
 * earlier segments are buttons that call `onNavigateProject(id)`; segments
 * are separated by `/`. When `entries` is empty, `fallback` is shown
 * instead (the single-project / data-not-yet-loaded case).
 */
function ProjectBreadcrumb({
  entries,
  fallback,
  onNavigateProject,
}: {
  entries: readonly BreadcrumbEntry[];
  fallback: string;
  onNavigateProject: (id: string) => void;
}) {
  if (entries.length === 0) {
    return <>{fallback}</>;
  }
  return (
    <>
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        return (
          <span key={entry.id} className="inline-flex items-center">
            {index > 0 && <span className="px-half text-low">/</span>}
            {isLast ? (
              <span className="truncate">{entry.name}</span>
            ) : (
              <button
                type="button"
                className="text-low hover:text-normal truncate cursor-pointer"
                onClick={() => onNavigateProject(entry.id)}
              >
                {entry.name}
              </button>
            )}
          </span>
        );
      })}
    </>
  );
}

/**
 * KanbanContainer displays the kanban board using data from ProjectContext
 * (per-project issues/statuses/tags) plus the flat ProjectProvider
 * (project list). Must be rendered within both ProjectProvider layers
 * — the per-project one (issues) AND the flat one (project list).
 */
export function KanbanContainer() {
  const isMobile = useIsMobile();
  const { t } = useTranslation('common');
  const appNavigation = useAppNavigation();
  const routeState = useCurrentKanbanRouteState();

  // Get data from contexts (set up by WorkspacesLayout)
  const {
    projectId,
    issues,
    statuses,
    tags,
    issueTags,
    issueRelationships,
    getTagObjectsForIssue,
    getTagsForIssue,
    getPullRequestsForIssue,
    getWorkspacesForIssue,
    getRelationshipsForIssue,
    updateIssue,
    issuesById,
    insertIssueTag,
    removeIssueTag,
    insertTag,
    pullRequests,
    isLoading: projectLoading,
  } = useProjectContext();

  // Flat projects layer.
  const { data: projects } = useProjects();
  const { activeWorkspaces } = useWorkspaceContext();
  const { workspaces: remoteWorkspaces } = useWorkspacesContext();

  // Get project name by finding the project matching current projectId
  const projectName = projects.find((p) => p.id === projectId)?.name ?? '';
  const { isCollapsed: isColumnCollapsed, setCollapsed: setColumnCollapsed } =
    useCollapsedStatuses(projectId);
  // Cards slide to their new place when they change column or order.
  const boardRef = useRef<HTMLDivElement>(null);
  useFlipCards(boardRef);

  const selectedKanbanIssueId = routeState.issueId;
  // Sub-issue board mode (2026-08-07): when on the sub-board route, the
  // board is filtered to show only the children of the parent issue. The
  // regular KanbanContainer UI (columns, drag-and-drop, etc.) is reused —
  // only the candidate issue set is narrowed.
  const parentIssueId = routeState.parentIssueId;
  const boardIssues = useMemo(
    () =>
      parentIssueId
        ? issues.filter((i) => i.parent_issue_id === parentIssueId)
        : issues,
    [issues, parentIssueId]
  );
  const issueComposerKey = useMemo(
    () => buildKanbanIssueComposerKey(routeState.hostId, projectId),
    [routeState.hostId, projectId]
  );
  const issueComposer = useKanbanIssueComposer(issueComposerKey);
  const isIssueComposerOpen = issueComposer !== null;
  const openIssue = useCallback(
    (issueId: string) => {
      if (isIssueComposerOpen) {
        closeKanbanIssueComposer(issueComposerKey);
      }

      // On the sub-board, selecting a card stays on the sub-board (keeps the
      // parent filter) and just swaps the open child via the `?issue=` search
      // param. Otherwise navigate to the main issue route.
      if (parentIssueId) {
        appNavigation.goToProjectIssueSubBoard(
          projectId,
          parentIssueId,
          issueId
        );
      } else {
        appNavigation.goToProjectIssue(projectId, issueId);
      }
    },
    [
      isIssueComposerOpen,
      issueComposerKey,
      appNavigation,
      projectId,
      parentIssueId,
    ]
  );
  const openIssueWorkspace = useCallback(
    (issueId: string, workspaceAttemptId: string) => {
      appNavigation.goToProjectIssueWorkspace(
        projectId,
        issueId,
        workspaceAttemptId
      );
    },
    [appNavigation, projectId]
  );
  // Get setter and executor from ActionsContext
  const {
    setDefaultCreateStatusId,
    executeAction,
    openPrioritySelection,
    createIssue,
  } = useActions();
  const startCreate = useCallback(
    (options?: ProjectIssueCreateOptions) => {
      void createIssue(options);
    },
    [createIssue]
  );
  const openProjectsGuide = useCallback(() => {
    executeAction(Actions.ProjectsGuide);
  }, [executeAction]);

  const projectViewSelection = useUiPreferencesStore(
    (s) => s.kanbanProjectViewSelections[projectId]
  );
  const projectViewPreferencesById = useUiPreferencesStore(
    (s) => s.kanbanProjectViewPreferences[projectId]
  );
  const setKanbanProjectView = useUiPreferencesStore(
    (s) => s.setKanbanProjectView
  );
  const setKanbanProjectViewFilters = useUiPreferencesStore(
    (s) => s.setKanbanProjectViewFilters
  );
  const setKanbanProjectViewShowSubIssues = useUiPreferencesStore(
    (s) => s.setKanbanProjectViewShowSubIssues
  );
  const setKanbanProjectViewShowWorkspaces = useUiPreferencesStore(
    (s) => s.setKanbanProjectViewShowWorkspaces
  );
  const setKanbanProjectViewHideBlocked = useUiPreferencesStore(
    (s) => s.setKanbanProjectViewHideBlocked
  );
  const clearKanbanProjectViewPreferences = useUiPreferencesStore(
    (s) => s.clearKanbanProjectViewPreferences
  );
  const resolvedProjectState = useMemo(
    () => resolveKanbanProjectState(projectViewSelection),
    [projectViewSelection]
  );
  const {
    activeViewId,
    filters: defaultKanbanFilters,
    showSubIssues: defaultShowSubIssues,
    showWorkspaces: defaultShowWorkspaces,
    hideBlocked: defaultHideBlocked,
  } = resolvedProjectState;
  const projectViewPreferences = projectViewPreferencesById?.[activeViewId];
  const kanbanFilters = projectViewPreferences?.filters ?? defaultKanbanFilters;
  const showSubIssues =
    projectViewPreferences?.showSubIssues ?? defaultShowSubIssues;
  const showWorkspaces =
    projectViewPreferences?.showWorkspaces ?? defaultShowWorkspaces;
  const hideBlocked = projectViewPreferences?.hideBlocked ?? defaultHideBlocked;

  const hasActiveFilters = useMemo(
    () =>
      !areKanbanFiltersEqual(kanbanFilters, defaultKanbanFilters) ||
      showSubIssues !== defaultShowSubIssues ||
      showWorkspaces !== defaultShowWorkspaces ||
      hideBlocked !== defaultHideBlocked,
    [
      kanbanFilters,
      defaultKanbanFilters,
      showSubIssues,
      defaultShowSubIssues,
      showWorkspaces,
      defaultShowWorkspaces,
      hideBlocked,
      defaultHideBlocked,
    ]
  );
  const shouldAnimateCreateButton = issues.length === 0;

  // Compute resolved status IDs for the blocked filter.
  // A blocking issue is considered resolved when it's in a terminal column —
  // the backend marks those explicitly via `is_terminal` (reordering columns
  // can no longer change which one is "done").
  const doneStatusIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of statuses) {
      if (s.is_terminal) ids.add(s.id);
    }
    return ids;
  }, [statuses]);

  // Sub-issue board (parentIssueId set): every candidate already has a
  // `parent_issue_id`. The `showSubIssues` filter DROPS exactly those, so if
  // the user has it off (the default) the board would be empty. Force it on
  // here so the children always pass through the filter pipeline.
  const effectiveShowSubIssues = showSubIssues || !!parentIssueId;

  const { filteredIssues } = useKanbanFilters({
    issues: boardIssues,
    issueTags,
    issueRelationships,
    issuesById,
    doneStatusIds,
    filters: kanbanFilters,
    showSubIssues: effectiveShowSubIssues,
    hideBlocked,
  });

  const setKanbanSearchQuery = useCallback(
    (searchQuery: string) => {
      setKanbanProjectViewFilters(projectId, activeViewId, {
        ...kanbanFilters,
        searchQuery,
      });
    },
    [activeViewId, kanbanFilters, projectId, setKanbanProjectViewFilters]
  );

  const setKanbanPriorities = useCallback(
    (priorities: IssuePriority[]) => {
      setKanbanProjectViewFilters(projectId, activeViewId, {
        ...kanbanFilters,
        priorities,
      });
    },
    [activeViewId, kanbanFilters, projectId, setKanbanProjectViewFilters]
  );

  const setKanbanTags = useCallback(
    (tagIds: string[]) => {
      setKanbanProjectViewFilters(projectId, activeViewId, {
        ...kanbanFilters,
        tagIds,
      });
    },
    [activeViewId, kanbanFilters, projectId, setKanbanProjectViewFilters]
  );

  const setKanbanSort = useCallback(
    (sortField: KanbanSortField, sortDirection: 'asc' | 'desc') => {
      setKanbanProjectViewFilters(projectId, activeViewId, {
        ...kanbanFilters,
        sortField,
        sortDirection,
      });
    },
    [activeViewId, kanbanFilters, projectId, setKanbanProjectViewFilters]
  );

  const setShowSubIssues = useCallback(
    (show: boolean) => {
      setKanbanProjectViewShowSubIssues(projectId, activeViewId, show);
    },
    [activeViewId, projectId, setKanbanProjectViewShowSubIssues]
  );

  const setShowWorkspaces = useCallback(
    (show: boolean) => {
      setKanbanProjectViewShowWorkspaces(projectId, activeViewId, show);
    },
    [activeViewId, projectId, setKanbanProjectViewShowWorkspaces]
  );

  const setHideBlocked = useCallback(
    (hide: boolean) => {
      setKanbanProjectViewHideBlocked(projectId, activeViewId, hide);
    },
    [activeViewId, projectId, setKanbanProjectViewHideBlocked]
  );

  const clearKanbanFilters = useCallback(() => {
    clearKanbanProjectViewPreferences(projectId, activeViewId);
  }, [activeViewId, clearKanbanProjectViewPreferences, projectId]);

  const handleKanbanProjectViewChange = useCallback(
    (viewId: string) => {
      setKanbanProjectView(projectId, viewId);
    },
    [projectId, setKanbanProjectView]
  );
  const kanbanViewMode = useUiPreferencesStore((s) => s.kanbanViewMode);
  const listViewStatusFilter = useUiPreferencesStore(
    (s) => s.listViewStatusFilter
  );
  const setKanbanViewMode = useUiPreferencesStore((s) => s.setKanbanViewMode);
  const setListViewStatusFilter = useUiPreferencesStore(
    (s) => s.setListViewStatusFilter
  );
  // Reset view mode when navigating projects
  const prevProjectIdRef = useRef<string | null>(null);

  // Track when drag-drop sync is in progress to prevent flicker
  const isSyncingCountRef = useRef(0);

  // Single source of truth for `sortField === 'sort_order'`. Used by the
  // swap branch gate, the move branch gate (P4-B1), and the
  // `positionalReorderEnabled` prop. Plain string compare — no memo.
  const isManualSort = kanbanFilters.sortField === 'sort_order';

  useEffect(() => {
    if (
      prevProjectIdRef.current !== null &&
      prevProjectIdRef.current !== projectId
    ) {
      setKanbanViewMode('kanban');
      setListViewStatusFilter(null);
    }

    prevProjectIdRef.current = projectId;
  }, [projectId, setKanbanViewMode, setListViewStatusFilter]);

  // Sort all statuses for display settings
  const sortedStatuses = useMemo(
    () => [...statuses].sort((a, b) => a.sort_order - b.sort_order),
    [statuses]
  );

  // Filter statuses: visible (non-hidden) for kanban, hidden for tabs
  const visibleStatuses = useMemo(
    () => sortedStatuses.filter((s) => !s.hidden),
    [sortedStatuses]
  );

  // Map status ID to 1-based column index for sort_order calculation
  const statusColumnIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    visibleStatuses.forEach((status, index) => {
      map.set(status.id, index + 1);
    });
    return map;
  }, [visibleStatuses]);

  const hiddenStatuses = useMemo(
    () => sortedStatuses.filter((s) => s.hidden),
    [sortedStatuses]
  );

  const defaultCreateStatusId = useMemo(() => {
    if (kanbanViewMode === 'kanban') {
      return visibleStatuses[0]?.id;
    }
    if (listViewStatusFilter) {
      return listViewStatusFilter;
    }
    return sortedStatuses[0]?.id;
  }, [kanbanViewMode, visibleStatuses, listViewStatusFilter, sortedStatuses]);

  // Update default create status for command bar based on current tab
  useEffect(() => {
    setDefaultCreateStatusId(defaultCreateStatusId);
  }, [defaultCreateStatusId, setDefaultCreateStatusId]);

  // Get statuses to display in list view (all or filtered to one)
  const listViewStatuses = useMemo(() => {
    if (listViewStatusFilter) {
      return sortedStatuses.filter((s) => s.id === listViewStatusFilter);
    }
    return sortedStatuses;
  }, [sortedStatuses, listViewStatusFilter]);

  // Track items as arrays of IDs grouped by status
  const [items, setItems] = useState<Record<string, string[]>>({});
  // Items mirror, used by the move handler to compute the next state
  // outside the React updater (the previous implementation mutated a `let`
  // inside the setItems updater, which is fragile under concurrent React).
  const itemsRef = useRef<Record<string, string[]>>({});
  itemsRef.current = items;
  const [isFiltersDialogOpen, setIsFiltersDialogOpen] = useState(false);

  // Sync items from filtered issues when they change
  useEffect(() => {
    // Skip rebuild during drag-drop sync to prevent flicker
    if (isSyncingCountRef.current > 0) {
      return;
    }

    const { sortField, sortDirection } = kanbanFilters;
    const grouped: Record<string, string[]> = {};

    for (const status of statuses) {
      // Filter issues for this status
      let statusIssues = filteredIssues.filter(
        (i) => i.status_id === status.id
      );

      // Sort within column based on user preference
      statusIssues = [...statusIssues].sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'priority':
            comparison =
              (a.priority ? PRIORITY_ORDER[a.priority] : Infinity) -
              (b.priority ? PRIORITY_ORDER[b.priority] : Infinity);
            break;
          case 'created_at':
            comparison =
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime();
            break;
          case 'updated_at':
            comparison =
              new Date(a.updated_at).getTime() -
              new Date(b.updated_at).getTime();
            break;
          case 'title':
            comparison = a.title.localeCompare(b.title);
            break;
          case 'sort_order':
          default:
            comparison = a.sort_order - b.sort_order;
        }
        return sortDirection === 'desc' ? -comparison : comparison;
      });

      grouped[status.id] = statusIssues.map((i) => i.id);
    }
    setItems(grouped);
  }, [filteredIssues, statuses, kanbanFilters]);

  // Full-Issue Record intentionally stays local: rendering needs fields beyond
  // the shared drag lookup projection.
  const issueMap = useMemo(() => {
    const map: Record<string, (typeof issues)[0]> = {};
    for (const issue of issues) {
      map[issue.id] = issue;
    }
    return map;
  }, [issues]);

  // Sub-issue expansion on the board (2026-08-07): parent cards that have
  // children show an expandable "↳ N" badge; expanding reveals the children
  // inline. Computed from the FULL issues list (not the filtered one) so the
  // badge appears even when the Sub-issues filter hides standalone sub-issue
  // cards. A sub-issue lives under its parent regardless of which status
  // column the child itself sits in.
  const childrenByParentId = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      const pid = issue.parent_issue_id;
      if (!pid) continue;
      const arr = map.get(pid);
      if (arr) arr.push(issue);
      else map.set(pid, [issue]);
    }
    for (const arr of map.values()) {
      arr.sort(
        (a, b) =>
          (a.parent_issue_sort_order ?? 0) - (b.parent_issue_sort_order ?? 0)
      );
    }
    return map;
  }, [issues]);

  const statusById = useMemo(() => {
    const map = new Map<string, (typeof statuses)[number]>();
    for (const s of statuses) map.set(s.id, s);
    return map;
  }, [statuses]);

  const [expandedSubIssueParents, setExpandedSubIssueParents] = useState<
    Set<string>
  >(() => new Set());
  const toggleSubIssuesExpanded = useCallback((parentId: string) => {
    setExpandedSubIssueParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }, []);

  const localWorkspacesById = useMemo(() => {
    const map = new Map<string, (typeof activeWorkspaces)[number]>();

    for (const workspace of activeWorkspaces) {
      map.set(workspace.id, workspace);
    }

    return map;
  }, [activeWorkspaces]);

  // Map local workspace id -> project id so the per-card dispatch dropdown
  // only offers workspaces linked to the current project.
  const workspaceProjectIdByLocalId = useMemo(() => {
    const map = new Map<string, string>();

    for (const workspace of remoteWorkspaces) {
      if (workspace.local_workspace_id) {
        map.set(workspace.local_workspace_id, workspace.project_id);
      }
    }

    return map;
  }, [remoteWorkspaces]);

  const queryClient = useQueryClient();

  // Every dispatchable workspace (active, with a local id) for the per-card
  // quick-dispatch dropdown. Orchestrator/recurrent workspaces are excluded:
  // dispatching a card into them would corrupt their orchestration loop.
  const dispatchWorkspaces = useMemo(
    () =>
      activeWorkspaces
        .filter(
          (workspace) =>
            !!workspace.id &&
            workspace.kind !== 'orchestrator' &&
            workspace.kind !== 'recurrent'
        )
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          projectId: workspaceProjectIdByLocalId.get(workspace.id),
        })),
    [activeWorkspaces, workspaceProjectIdByLocalId]
  );

  const handleDispatchIssueToWorkspace = useCallback(
    async (issueId: string, workspaceId: string) => {
      try {
        await workspacesApi.dispatchIssueToWorkspace(issueId, workspaceId);
        // A dispatch touches many disparate caches (board, workspace session,
        // execution processes, branch status, the issue's Workspaces section),
        // all keyed differently. Scoping to a subset would leave stale UI; the
        // local SQLite backing store makes a full invalidation cheap.
        await queryClient.invalidateQueries();
      } catch (error) {
        ConfirmDialog.show({
          title: t('common:error'),
          message: error instanceof Error ? error.message : String(error),
          confirmText: t('common:ok'),
          showCancelButton: false,
        });
      }
    },
    [queryClient, t, projectId]
  );

  const handleLinkIssueWorkspace = useCallback(
    async (issueId: string, workspaceId: string) => {
      try {
        await workspacesApi.linkToIssue(workspaceId, projectId, issueId);
        refreshShapeSource(PROJECT_WORKSPACES_SHAPE, { project_id: projectId });
        await queryClient.invalidateQueries();
      } catch (error) {
        ConfirmDialog.show({
          title: t('common:error'),
          message: error instanceof Error ? error.message : String(error),
          confirmText: t('common:ok'),
          showCancelButton: false,
        });
      }
    },
    [queryClient, t, projectId]
  );

  const prsByWorkspaceId = useMemo(() => {
    const map = new Map<string, WorkspacePr[]>();

    for (const pr of pullRequests) {
      if (!pr.workspace_id) continue;

      const prs = map.get(pr.workspace_id) ?? [];
      prs.push({
        number: pr.number,
        url: pr.url,
        status: pr.status as 'open' | 'merged' | 'closed',
      });
      map.set(pr.workspace_id, prs);
    }

    return map;
  }, [pullRequests]);

  // Phase 1 cockpit: an In Review card with a live workspace gets a Merge
  // button that ships the work and moves the card to Done.
  const reviewStatusId = useMemo(
    () =>
      statuses.find((s) => s.name.trim().toLowerCase() === 'in review')?.id ??
      null,
    [statuses]
  );
  const doneStatusId = useMemo(
    () =>
      statuses.find((s) => s.name.trim().toLowerCase() === 'done')?.id ?? null,
    [statuses]
  );
  const renderShipButton = (issue: { id: string; status_id: string }) => {
    if (!reviewStatusId || !doneStatusId) return null;
    if (issue.status_id !== reviewStatusId) return null;
    const live = getWorkspacesForIssue(issue.id).filter(
      (w) =>
        !w.archived &&
        !!w.local_workspace_id &&
        localWorkspacesById.has(w.local_workspace_id)
    );
    const workspace = live[live.length - 1];
    const localId = workspace?.local_workspace_id;
    if (!localId) return null;
    return (
      <ShipIssueButton
        workspaceId={localId}
        onShipped={() => updateIssue(issue.id, { status_id: doneStatusId })}
        onOpenWorkspace={() => openIssueWorkspace(issue.id, localId)}
      />
    );
  };

  const workspacesByIssueId = useMemo(() => {
    if (!showWorkspaces) {
      return new Map<string, WorkspaceWithStats[]>();
    }

    const map = new Map<string, WorkspaceWithStats[]>();

    for (const issue of issues) {
      const nonArchivedWorkspaces = getWorkspacesForIssue(issue.id)
        .filter(
          (workspace) =>
            !workspace.archived &&
            !!workspace.local_workspace_id &&
            localWorkspacesById.has(workspace.local_workspace_id)
        )
        .map((workspace) => {
          const localWorkspace = localWorkspacesById.get(
            workspace.local_workspace_id!
          );

          return {
            id: workspace.id,
            localWorkspaceId: workspace.local_workspace_id,
            name: workspace.name,
            archived: workspace.archived,
            filesChanged: workspace.files_changed ?? 0,
            linesAdded: workspace.lines_added ?? 0,
            linesRemoved: workspace.lines_removed ?? 0,
            prs: prsByWorkspaceId.get(workspace.id) ?? [],
            owner: null,
            updatedAt: workspace.updated_at,
            isRunning: localWorkspace?.isRunning,
            hasPendingApproval: localWorkspace?.hasPendingApproval,
            hasRunningDevServer: localWorkspace?.hasRunningDevServer,
            hasUnseenActivity: localWorkspace?.hasUnseenActivity,
            latestProcessCompletedAt: localWorkspace?.latestProcessCompletedAt,
            latestProcessStatus: localWorkspace?.latestProcessStatus,
          };
        });

      if (nonArchivedWorkspaces.length > 0) {
        map.set(issue.id, nonArchivedWorkspaces);
      }
    }

    return map;
  }, [
    showWorkspaces,
    issues,
    getWorkspacesForIssue,
    localWorkspacesById,
    prsByWorkspaceId,
  ]);

  // Calculate sort_order based on column index and issue position
  // Formula: 1000 * [COLUMN_INDEX] + [ISSUE_INDEX] (both 1-based)
  const calculateSortOrder = useCallback(
    (statusId: string, issueIndex: number): number => {
      const columnIndex = statusColumnIndexMap.get(statusId) ?? 1;
      return 1000 * columnIndex + (issueIndex + 1);
    },
    [statusColumnIndexMap]
  );

  // Fire the REST + shape refresh. `isSyncingCountRef` gates the items-rebuild
  // effect so the optimistic local order isn't trampled by a slow shape
  // sync; decremented in both branches once the shape refresh resolves (or
  // the catch runs). On failure we just log + force a shape refresh — the
  // failed bulkUpdateIssues left the backend untouched, so the next shape
  // sync restores authoritative state.
  //
  // P4-BUG1: a 10s safety net decrements the counter if `onSettled` never
  // fires (network drop, suspended tab). Without it the counter would stay
  // >0 forever and the items-rebuild effect would freeze the board.
  const applyKanbanMove = useCallback(
    (updates: BulkUpdateIssueItem[], projectIdArg: string) => {
      isSyncingCountRef.current += 1;
      const guard = createSyncGuard({
        decrement: () => {
          isSyncingCountRef.current -= 1;
        },
      });
      persistIssues(updates, projectIdArg, {
        onError: (err) =>
          console.error('Failed to bulk update sort order:', err),
        onSettled: guard.bind(() => {
          isSyncingCountRef.current -= 1;
        }),
      });
    },
    []
  );

  // Move-based handler. Called from two paths:
  //   1. The shared custom drag system via KanbanDragHandlerProvider.
  //      Cross-surface drops land here when the drop target resolves
  //      to a bare-UUID kanban column (column move → append).
  //   2. The legacy list-view adapter (IssueListView) which still uses
  //      hello-pangea for positional reordering inside columns.
  // Thin orchestrator: guard → compute next state → build updates →
  // apply (REST + shape refresh).
  const handleKanbanMove = useCallback(
    (move: KanbanMove) => {
      const { swapWithIssueId } = move;
      // Same-column SWAP of two cards: exchange their status_id +
      // sort_order optimistically (no round-trip flash — the visual
      // preview already reordered the DOM, so committing immediately in
      // the local items map prevents the "updated → old → correct" flicker
      // the user saw on successful swaps).
      // Only same-status swaps are reachable: the drag controller filters
      // card candidates by `data-drop-target-status === source.statusId`,
      // so a and b necessarily share the same column. The cross-status
      // branch below is defensive against a future controller change.
      if (swapWithIssueId) {
        // P4-D2: gate the swap on the single `isManualSort` const. Under
        // priority/created_at/title sort, swapping two cards touches only
        // sort_order — the active sort field would re-derive order on the
        // next shape sync, so the swap is a no-op for the user.
        if (!isManualSort) return;
        const a = issueMap[move.issueId];
        const b = issueMap[swapWithIssueId];
        if (!a || !b) return;
        if (move.swapWithIssueId === move.issueId) return;
        // Defensive: a cross-status swap is not implementable here (we
        // would need to rewrite both `status_id` and the new column's
        // neighbouring sort_orders). The controller never produces one,
        // so just bail.
        if (a.status_id !== b.status_id) return;
        setItems((prev) => {
          const next = { ...prev };
          const aCol = [...(next[a.status_id] ?? [])];
          const ai = aCol.indexOf(a.id);
          const bi = aCol.indexOf(b.id);
          if (ai !== -1 && bi !== -1) {
            [aCol[ai], aCol[bi]] = [aCol[bi], aCol[ai]];
            next[a.status_id] = aCol;
          }
          return next;
        });
        isSyncingCountRef.current += 1;
        // P4-BUG1: same 10s safety net as the move branch — a swap
        // whose `bulkUpdateIssues` never settles must NOT freeze the
        // items-rebuild gate.
        const guard = createSyncGuard({
          decrement: () => {
            isSyncingCountRef.current -= 1;
          },
        });
        persistIssueSwap(a, b, projectId, {
          onError: (err) => console.error('[dnd] kanban swap failed:', err),
          onSettled: guard.bind(() => {
            isSyncingCountRef.current -= 1;
          }),
        });
        return;
      }

      const { fromStatusId: from, toStatusId: to } = move;
      // Same-status drop is a no-op when EITHER:
      //   (a) no explicit insertion index is supplied — the custom DnD
      //       controller never produces a same-status column target (it
      //       filters cards by `data-drop-target-status === source.statusId`),
      //       so the only same-status-with-index path is the legacy
      //       list-view adapter — a positional reorder inside the same
      //       column.
      //   (b) the sort field is non-positional (priority/created_at/
      //       title). Under non-manual sort a same-status list-view
      //       reorder (explicit index) would otherwise fire a useless
      //       `{status_id: to}` write (to === from) and hold the
      //       items-rebuild gate open for 10s. The legacy adapter only
      //       emits an explicit index when its `onDragEnd` ran; bail
      //       here so the commit short-circuits before the gate holds
      //       and the backend round-trips a no-op (P5-E1).
      if (from === to && (move.index === undefined || !isManualSort)) return;

      // P4-B1: under non-manual sort, the column is ordered by a
      // non-positional field (priority/created_at/title). The custom
      // drop controller's resolved slot is OPTIMISTIC — the next shape
      // sync re-derives order from the active sort. Drop the index so
      // `computeKanbanMove` appends, and ask `buildKanbanMoveUpdates`
      // for a status-only update (no sort_order rewrite).
      const effectiveMove = isManualSort ? move : { ...move, index: undefined };

      const newItems = computeKanbanMove(itemsRef.current, effectiveMove);
      setItems(newItems);

      const updates = buildKanbanMoveUpdates({
        newItems,
        move,
        isManualSort,
        calculateSortOrder,
        statusColumnIndexMap,
      });

      applyKanbanMove(updates, projectId);
    },
    [
      projectId,
      calculateSortOrder,
      statusColumnIndexMap,
      applyKanbanMove,
      issueMap,
      isManualSort,
    ]
  );

  // Legacy list-view adapter (positional reorder still uses
  // hello-pangea). Translates the DropResult into a KanbanMove.
  const handleLegacyListDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;
      const fromStatusId = result.source.droppableId;
      const toStatusId = result.destination.droppableId;
      if (
        fromStatusId === toStatusId &&
        result.source.index === result.destination.index
      ) {
        return;
      }
      handleKanbanMove({
        issueId: result.draggableId,
        fromStatusId,
        toStatusId,
        index: result.destination.index,
      });
    },
    [handleKanbanMove]
  );

  // Register the move-based handler with the SharedAppLayout bridge so the
  // shared DragProvider can delegate kanban-internal drops back here.
  //
  // The handler is registered ONCE on mount and reads the latest
  // `handleKanbanMove` through a ref. This is deliberate: handler identity
  // churns whenever `statuses` refetches via the ~30s fallback poll
  // (the chained `useMemo`s — `sortedStatuses` → `visibleStatuses` →
  // `statusColumnIndexMap` → `calculateSortOrder` — produce fresh
  // identities even for content-equal data), and re-registering on every
  // churn means the bridge cleanup nulls `kanbanHandlerRef.current` and
  // the next run sets it back. The ref pattern keeps the bridge handler
  // stable for the component's lifetime and always invokes the
  // freshest closure.
  const handleKanbanMoveRef = useRef(handleKanbanMove);
  handleKanbanMoveRef.current = handleKanbanMove;
  const { registerHandler: registerKanbanHandler } = useKanbanDragHandler();
  useEffect(() => {
    const stableHandler: KanbanDragHandler = (move) =>
      handleKanbanMoveRef.current(move);
    return registerKanbanHandler(stableHandler);
  }, [registerKanbanHandler]);

  // Multi-select support
  const {
    selectedIssueIds,
    isMultiSelectActive,
    handleIssueClick,
    handleCheckboxChange,
    clearSelection,
  } = useIssueMultiSelect();
  const setOrderedIssueIds = useIssueSelectionStore(
    (s) => s.setOrderedIssueIds
  );
  const setAnchor = useIssueSelectionStore((s) => s.setAnchor);

  // Compute ordered issue IDs for range selection
  const orderedIssueIds = useMemo(() => {
    const statusOrder =
      kanbanViewMode === 'kanban' ? visibleStatuses : listViewStatuses;
    return statusOrder.flatMap((status) => items[status.id] ?? []);
  }, [kanbanViewMode, visibleStatuses, listViewStatuses, items]);

  // Keep the store's ordered IDs in sync
  useEffect(() => {
    setOrderedIssueIds(orderedIssueIds);
  }, [orderedIssueIds, setOrderedIssueIds]);

  // Clear multi-selection when project or view mode changes
  useEffect(() => {
    clearSelection();
  }, [projectId, kanbanViewMode, clearSelection]);

  // Keep anchor in sync with the currently opened issue (e.g. from URL on
  // page load) so Shift/Cmd+Click on another issue includes it.
  useEffect(() => {
    if (selectedKanbanIssueId) {
      setAnchor(selectedKanbanIssueId);
    }
  }, [selectedKanbanIssueId, setAnchor]);

  const handleCardClick = useCallback(
    (issueId: string, e?: MouseEvent) => {
      if (e && (e.metaKey || e.ctrlKey || e.shiftKey)) {
        handleIssueClick(issueId, e);
      } else {
        if (selectedIssueIds.size > 0) {
          clearSelection();
        }
        // Set as anchor so Shift+Click from this issue works
        setAnchor(issueId);
        openIssue(issueId);
      }
    },
    [
      openIssue,
      handleIssueClick,
      selectedIssueIds.size,
      clearSelection,
      setAnchor,
    ]
  );

  const handleAddTask = useCallback(
    (statusId?: string) => {
      const createPayload = {
        statusId: statusId ?? defaultCreateStatusId,
      };
      startCreate(createPayload);
    },
    [defaultCreateStatusId, startCreate]
  );

  // Inline editing callbacks for kanban cards
  // When multi-select is active, apply to all selected issues
  const handleCardPriorityClick = useCallback(
    (issueId: string) => {
      const ids = isMultiSelectActive ? [...selectedIssueIds] : [issueId];
      openPrioritySelection(projectId, ids);
    },
    [projectId, openPrioritySelection, selectedIssueIds, isMultiSelectActive]
  );

  const handleCardMoreActionsClick = useCallback(
    (issueId: string) => {
      const ids = isMultiSelectActive ? [...selectedIssueIds] : [issueId];
      CommandBarDialog.show({
        page: 'issueActions',
        projectId,
        issueIds: ids,
      });
    },
    [projectId, selectedIssueIds, isMultiSelectActive]
  );

  const handleCardTagToggle = useCallback(
    (issueId: string, tagId: string) => {
      const currentIssueTags = getTagsForIssue(issueId);
      const existing = currentIssueTags.find((it) => it.tag_id === tagId);
      if (existing) {
        removeIssueTag(existing.id);
      } else {
        insertIssueTag({ issue_id: issueId, tag_id: tagId });
      }
    },
    [getTagsForIssue, insertIssueTag, removeIssueTag]
  );

  const getResolvedRelationshipsForIssue = useCallback(
    (issueId: string) =>
      resolveRelationshipsForIssue(
        issueId,
        getRelationshipsForIssue(issueId),
        issuesById
      ),
    [getRelationshipsForIssue, issuesById]
  );

  const handleCreateTag = useCallback(
    (data: { name: string; color: string }): string => {
      const { data: newTag } = insertTag({
        project_id: projectId,
        name: data.name,
        color: data.color,
      });
      return newTag.id;
    },
    [insertTag, projectId]
  );

  const isLoading = projectLoading;

  const breadcrumb = useMemo(
    () => buildProjectBreadcrumb(projects, projectId),
    [projects, projectId]
  );

  // Keyboard: j / k move between cards (top to bottom, left to right
  // across unfolded columns), Enter opens the highlighted card.
  const [keyboardIssueId, setKeyboardIssueId] = useState<string | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!['j', 'k', 'Enter'].includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]'
        )
      ) {
        return;
      }
      const order = visibleStatuses
        .filter((status) => !isColumnCollapsed(status))
        .flatMap((status) => items[status.id] ?? []);
      if (order.length === 0) return;
      if (event.key === 'Enter') {
        if (!keyboardIssueId) return;
        event.preventDefault();
        openIssue(keyboardIssueId);
        return;
      }
      event.preventDefault();
      const current = keyboardIssueId ? order.indexOf(keyboardIssueId) : -1;
      const nextIndex =
        event.key === 'j'
          ? Math.min(order.length - 1, current + 1)
          : Math.max(0, current - 1);
      const nextId = order[nextIndex] ?? null;
      setKeyboardIssueId(nextId);
      if (nextId) {
        document
          .querySelector(`[data-dnd-card-issue-id="${nextId}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visibleStatuses, isColumnCollapsed, items, keyboardIssueId, openIssue]);

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="flex flex-col h-full space-y-base">
      <div
        className={cn(
          'px-double pt-double space-y-base',
          isMobile && 'px-base pt-base'
        )}
      >
        <div className="flex items-center gap-half">
          <h2 className={cn('text-2xl font-medium', isMobile && 'text-lg')}>
            <ProjectBreadcrumb
              entries={breadcrumb}
              fallback={projectName}
              onNavigateProject={(id) => appNavigation.goToProject(id)}
            />
          </h2>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-half rounded-sm text-low hover:text-normal hover:bg-secondary transition-colors"
                aria-label={t('common:ui.projectMenu')}
              >
                <DotsThreeIcon className="size-icon-sm" weight="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openProjectsGuide}>
                {t('kanban.openProjectsGuide', 'Projects guide')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => executeAction(Actions.ProjectSettings)}
              >
                {t('kanban.editProjectSettings', 'Edit project settings')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          className={cn(
            'flex items-start gap-base',
            isMobile ? 'flex-col' : 'flex-wrap'
          )}
        >
          <ViewNavTabs
            activeView={kanbanViewMode}
            onViewChange={setKanbanViewMode}
            hiddenStatuses={hiddenStatuses}
            selectedStatusId={listViewStatusFilter}
            onStatusSelect={setListViewStatusFilter}
          />
          <KanbanFilterBar
            isFiltersDialogOpen={isFiltersDialogOpen}
            onFiltersDialogOpenChange={setIsFiltersDialogOpen}
            tags={tags}
            activeViewId={activeViewId}
            onViewChange={handleKanbanProjectViewChange}
            viewIds={KANBAN_PROJECT_VIEW_IDS}
            projectId={projectId}
            filters={kanbanFilters}
            showSubIssues={showSubIssues}
            showWorkspaces={showWorkspaces}
            hasActiveFilters={hasActiveFilters}
            onSearchQueryChange={setKanbanSearchQuery}
            onPrioritiesChange={setKanbanPriorities}
            onTagsChange={setKanbanTags}
            onSortChange={setKanbanSort}
            onShowSubIssuesChange={setShowSubIssues}
            onShowWorkspacesChange={setShowWorkspaces}
            hideBlocked={hideBlocked}
            onHideBlockedChange={setHideBlocked}
            onClearFilters={clearKanbanFilters}
            onCreateIssue={handleAddTask}
            shouldAnimateCreateButton={shouldAnimateCreateButton}
            renderFiltersDialog={(props) => <KanbanFiltersDialog {...props} />}
            isMobile={isMobile}
          />
        </div>
      </div>

      {parentIssueId && (
        <div className="flex shrink-0 items-center gap-base border-b border-border px-double py-half">
          <button
            type="button"
            onClick={() =>
              appNavigation.goToProjectIssue(projectId, parentIssueId)
            }
            className="flex items-center gap-half rounded-sm p-half text-low hover:bg-secondary hover:text-normal transition-colors"
            aria-label={t('kanban.subIssueBoardBack')}
          >
            <ArrowLeftIcon className="size-icon-sm" weight="bold" />
          </button>
          <div className="flex min-w-0 items-center gap-half text-sm">
            <span className="shrink-0 text-low">{projectName}</span>
            <span className="shrink-0 text-low">/</span>
            <span className="shrink-0 font-ibm-plex-mono text-low">
              {issuesById.get(parentIssueId)?.simple_id ?? ''}
            </span>
            <span className="truncate text-normal">
              {issuesById.get(parentIssueId)?.title ??
                t('kanban.subIssueBoardTitle')}
            </span>
          </div>
        </div>
      )}

      {kanbanViewMode === 'kanban' ? (
        visibleStatuses.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-low">{t('kanban.noVisibleStatuses')}</p>
          </div>
        ) : (
          <div ref={boardRef} className="flex-1 overflow-x-auto px-double">
            <KanbanProvider
              className="min-w-full"
              style={{
                // Empty columns stay narrow so the ones with cards get room.
                gridTemplateColumns: visibleStatuses
                  .map((status) =>
                    isColumnCollapsed(status)
                      ? '44px'
                      : (items[status.id]?.length ?? 0) > 0
                        ? 'minmax(240px, 2fr)'
                        : 'minmax(130px, 1fr)'
                  )
                  .join(' '),
              }}
            >
              {visibleStatuses.map((status) => {
                const issueIds = items[status.id] ?? [];
                const statusIsDone = isDoneStatus(status);

                if (isColumnCollapsed(status)) {
                  // Folded column: a narrow strip that still accepts drops.
                  return (
                    <KanbanBoard key={status.id}>
                      <button
                        type="button"
                        onClick={() => setColumnCollapsed(status.id, false)}
                        className="sticky top-0 z-20 flex h-full min-h-40 w-full flex-col items-center gap-2 border-y bg-secondary py-base text-low hover:text-normal hover:bg-panel transition-colors"
                        aria-expanded={false}
                        aria-label={t('kanban.expandColumn', {
                          name: status.name,
                          count: issueIds.length,
                        })}
                        title={t('kanban.expandColumn', {
                          name: status.name,
                          count: issueIds.length,
                        })}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: `hsl(${status.color})` }}
                        />
                        <span className="text-sm [writing-mode:vertical-rl]">
                          {status.name}
                        </span>
                        <span className="text-xs tabular-nums">
                          {issueIds.length}
                        </span>
                      </button>
                      <KanbanCards
                        id={status.id}
                        activeProjectId={projectId}
                        issueIds={[]}
                        positionalReorderEnabled={false}
                      >
                        {null}
                      </KanbanCards>
                    </KanbanBoard>
                  );
                }

                return (
                  <KanbanBoard key={status.id}>
                    <KanbanHeader>
                      <div className="group/col border-t sticky border-b top-0 z-20 flex shrink-0 items-center gap-1 p-base bg-secondary">
                        <div className="flex min-w-0 items-center gap-2">
                          <div
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: `hsl(${status.color})` }}
                          />
                          <p
                            className="m-0 truncate whitespace-nowrap text-sm"
                            title={status.name}
                          >
                            {status.name}
                          </p>
                          {issueIds.length > 0 && (
                            <span className="text-xs text-low tabular-nums">
                              {issueIds.length}
                            </span>
                          )}
                        </div>
                        {statusIsDone && (
                          <button
                            type="button"
                            onClick={() => setColumnCollapsed(status.id, true)}
                            className="absolute right-9 top-1/2 -translate-y-1/2 p-half rounded-sm bg-secondary text-low opacity-0 group-hover/col:opacity-100 focus-visible:opacity-100 hover:text-normal hover:bg-panel transition"
                            aria-label={t('kanban.collapseColumn', {
                              name: status.name,
                            })}
                            title={t('kanban.collapseColumn', {
                              name: status.name,
                            })}
                          >
                            <CaretLeftIcon
                              className="size-icon-xs"
                              weight="bold"
                            />
                          </button>
                        )}
                        {!parentIssueId && (
                          <button
                            type="button"
                            onClick={() => handleAddTask(status.id)}
                            className="absolute right-base top-1/2 -translate-y-1/2 p-half rounded-sm bg-secondary text-low opacity-0 group-hover/col:opacity-100 focus-visible:opacity-100 hover:text-normal hover:bg-panel transition"
                            aria-label={t('common:ui.addTask')}
                          >
                            <PlusIcon className="size-icon-xs" weight="bold" />
                          </button>
                        )}
                      </div>
                    </KanbanHeader>
                    <KanbanCards
                      id={status.id}
                      activeProjectId={projectId}
                      issueIds={issueIds}
                      positionalReorderEnabled={isManualSort}
                    >
                      {issueIds.map((issueId) => {
                        const issue = issueMap[issueId];
                        if (!issue) return null;
                        const issueWorkspaces =
                          workspacesByIssueId.get(issue.id) ?? [];
                        const workspaceIdsShownOnCard = new Set(
                          issueWorkspaces.map((workspace) => workspace.id)
                        );
                        const issueCardPullRequests = getPullRequestsForIssue(
                          issue.id
                        ).filter((pr) => {
                          if (!pr.workspace_id) {
                            return true;
                          }

                          // If this PR is already visible under a workspace card,
                          // do not render it again at the issue level.
                          return !workspaceIdsShownOnCard.has(pr.workspace_id);
                        });

                        const subIssueChildren =
                          childrenByParentId.get(issue.id) ?? [];
                        const isSubIssuesExpanded = expandedSubIssueParents.has(
                          issue.id
                        );

                        return (
                          <KanbanCard
                            key={issue.id}
                            source={{
                              kind: 'issue-move',
                              issueId: issue.id,
                              projectId,
                              statusId: issue.status_id,
                            }}
                            name={issue.title}
                            className={cn(
                              'group',
                              keyboardIssueId === issue.id &&
                                'ring-2 ring-brand/60 ring-offset-1 ring-offset-primary'
                            )}
                            onClick={(e) => handleCardClick(issue.id, e)}
                            isOpen={selectedKanbanIssueId === issue.id}
                            isMobile={isMobile}
                            isSelected={selectedIssueIds.has(issue.id)}
                            dragDisabled={isMultiSelectActive}
                          >
                            <KanbanCardContent
                              displayId={issue.simple_id}
                              title={issue.title}
                              description={issue.description}
                              priority={issue.priority}
                              tags={getTagObjectsForIssue(issue.id)}
                              pullRequests={issueCardPullRequests}
                              relationships={resolveRelationshipsForIssue(
                                issue.id,
                                getRelationshipsForIssue(issue.id),
                                issuesById
                              )}
                              isSubIssue={!!issue.parent_issue_id}
                              subIssueCount={subIssueChildren.length}
                              isSubIssuesExpanded={isSubIssuesExpanded}
                              onToggleSubIssues={() =>
                                toggleSubIssuesExpanded(issue.id)
                              }
                              onOpenSubBoard={() =>
                                appNavigation.goToProjectIssueSubBoard(
                                  projectId,
                                  issue.id
                                )
                              }
                              isMobile={isMobile}
                              onPriorityClick={(e) => {
                                e.stopPropagation();
                                handleCardPriorityClick(issue.id);
                              }}
                              onMoreActionsClick={() =>
                                handleCardMoreActionsClick(issue.id)
                              }
                              footer={renderShipButton(issue)}
                              compact={statusIsDone}
                              tagEditProps={{
                                allTags: tags,
                                selectedTagIds: getTagsForIssue(issue.id).map(
                                  (it) => it.tag_id
                                ),
                                onTagToggle: (tagId) =>
                                  handleCardTagToggle(issue.id, tagId),
                                onCreateTag: handleCreateTag,
                                renderTagEditor: ({
                                  allTags,
                                  selectedTagIds,
                                  onTagToggle,
                                  onCreateTag,
                                  trigger,
                                }) => (
                                  <SearchableTagDropdownContainer
                                    tags={allTags}
                                    selectedTagIds={selectedTagIds}
                                    onTagToggle={onTagToggle}
                                    onCreateTag={onCreateTag}
                                    disabled={false}
                                    contentClassName=""
                                    trigger={trigger}
                                  />
                                ),
                              }}
                            />
                            {/* Inline sub-issues (expanded). Rendered under the
                                parent card, each row opens that sub-issue. */}
                            {isSubIssuesExpanded &&
                              subIssueChildren.length > 0 && (
                                <div className="mt-half flex flex-col gap-half border-l-2 border-border pl-half">
                                  {subIssueChildren.map((child) => {
                                    const childStatus = statusById.get(
                                      child.status_id
                                    );
                                    return (
                                      <button
                                        key={child.id}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openIssue(child.id);
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        className="flex w-full items-center gap-half rounded-sm px-half py-half text-left text-sm text-normal hover:bg-secondary transition-colors"
                                      >
                                        <span
                                          aria-hidden="true"
                                          className="size-2 shrink-0 rounded-full"
                                          style={{
                                            backgroundColor: `hsl(${childStatus?.color ?? '0 0% 60%'})`,
                                          }}
                                        />
                                        <span className="shrink-0 font-ibm-plex-mono text-sm text-low">
                                          {child.simple_id}
                                        </span>
                                        <span className="truncate">
                                          {child.title}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            {issueWorkspaces.length > 0 && (
                              <div className="mt-base flex flex-col gap-half">
                                {issueWorkspaces.map((workspace) => (
                                  <IssueWorkspaceCard
                                    key={workspace.id}
                                    workspace={workspace}
                                    onClick={
                                      workspace.localWorkspaceId
                                        ? () =>
                                            openIssueWorkspace(
                                              issue.id,
                                              workspace.localWorkspaceId!
                                            )
                                        : undefined
                                    }
                                    showOwner={false}
                                    showStatusBadge={false}
                                    showNoPrText={false}
                                  />
                                ))}
                              </div>
                            )}
                            {dispatchWorkspaces.length > 0 && (
                              <div className="mt-half">
                                <KanbanWorkspaceDispatch
                                  workspaces={dispatchWorkspaces}
                                  currentWorkspaceIds={workspaceIdsShownOnCard}
                                  issueStatusIsDone={
                                    statusById.get(issue.status_id)
                                      ?.is_terminal ?? false
                                  }
                                  currentProjectId={projectId}
                                  onDispatch={(workspaceId) =>
                                    handleDispatchIssueToWorkspace(
                                      issue.id,
                                      workspaceId
                                    )
                                  }
                                  onLink={(workspaceId) =>
                                    handleLinkIssueWorkspace(
                                      issue.id,
                                      workspaceId
                                    )
                                  }
                                />
                              </div>
                            )}
                          </KanbanCard>
                        );
                      })}
                    </KanbanCards>
                  </KanbanBoard>
                );
              })}
            </KanbanProvider>
          </div>
        )
      ) : (
        <div className="flex-1 overflow-y-auto px-double">
          <KanbanProvider className="!block !w-full">
            <DragDropContext onDragEnd={handleLegacyListDragEnd}>
              <IssueListView
                statuses={listViewStatuses}
                items={items}
                issueMap={issueMap}
                getTagObjectsForIssue={getTagObjectsForIssue}
                getResolvedRelationshipsForIssue={
                  getResolvedRelationshipsForIssue
                }
                onIssueClick={handleCardClick}
                selectedIssueId={selectedKanbanIssueId}
                selectedIssueIds={selectedIssueIds}
                isMultiSelectActive={isMultiSelectActive}
                onIssueCheckboxChange={handleCheckboxChange}
              />
            </DragDropContext>
          </KanbanProvider>
        </div>
      )}

      {isMultiSelectActive && <BulkActionBarContainer projectId={projectId} />}
    </div>
  );
}
