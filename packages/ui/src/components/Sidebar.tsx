import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { SidebarBar } from './SidebarBar';
import { SidebarBucketBar } from './SidebarBucketBar';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import { SidebarSeparator } from './SidebarSeparator';
import { SidebarProjectTree } from './SidebarProjectTree';
import { SidebarProjectCards } from './SidebarProjectCards';
import type { CaptainState, ProjectTasksData } from './outliner/types';
import type { SidebarProject } from './outliner/types';
import type {
  OutlinerWorkspace,
  WorkspaceProjectMembership,
} from './outliner/types';

export type { WorkspaceProjectMembership } from './outliner/types';

interface SidebarProps {
  /** All projects to render at the root of the tree. */
  projects: readonly SidebarProject[];
  /** Project id whose destination the user is currently on, if any. */
  activeProjectId: string | null;
  /** Active (non-archived) workspaces, fed into each project's tree. */
  workspaces: OutlinerWorkspace[];
  /** Archived workspaces. */
  archivedWorkspaces?: OutlinerWorkspace[];
  /** Kept out of the tree (project captains) but shown in the attention
   *  inbox when blocked. */
  attentionOnlyWorkspaces?: OutlinerWorkspace[];
  /** Dismisses finished/failed items from the attention inbox. */
  onMarkSeen?: (ids: string[]) => void;
  /** issue id → workspace working on it (card status dot). */
  workspaceByIssueId?: ReadonlyMap<string, OutlinerWorkspace>;
  /** project id → its captain's state (captain row). */
  captainByProject?: ReadonlyMap<string, CaptainState>;
  /** local_workspace_id → set of project ids (for tree grouping). */
  membership: WorkspaceProjectMembership;
  /** Workspace id whose destination the user is currently on, if any. */
  activeWorkspaceId: string | null;
  tasksByProject?: ReadonlyMap<string, ProjectTasksData>;
  loadingTasksProjectIds?: ReadonlySet<string>;
  activeIssueId?: string | null;
  onTasksExpansionChange?: (projectId: string, isOpen: boolean) => void;
  onSelectIssue?: (
    projectId: string,
    issueId: string,
    parentIssueId?: string | null
  ) => void;
  isLoadingProjects?: boolean;
  isLoadingWorkspaces?: boolean;
  onSelectWorkspace: (id: string) => void;
  /** Collapse-by-default (2026-08-07): opens the project's kanban board when
   *  the open-page icon is clicked on a project row or Tasks section. Row
   *  clicks toggle expand/collapse. */
  onOpenProjectPage?: (projectId: string) => void;
  /** Opens the flat workspaces dashboard when the open-page icon is clicked
   *  on a Workspaces section row. */
  onOpenWorkspacesPage?: (projectId: string) => void;
  /** Opens the most-recent workspace under the Orchestrator (Unassigned)
   *  pseudo-project when its ⚡ icon is clicked. */
  onOpenLastWorkspace?: () => void;
  /** ADR-015: opens `CreateRemoteProjectDialog` with `parentId` set so the
   *  new project is created as a child board of the supplied project id. */
  onCreateChildBoard?: (parentId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onManageRepos?: (projectId: string) => void;
  onArchiveWorkspace?: (workspaceId: string) => void;
  onDeleteWorkspace?: (workspaceId: string) => void;
  /** ADR-016: opens the per-project orchestrator-prompt editor pane.
   *  Triggered by the tree's `+` menu item and the prompt row's click. */
  onSelectOrchestratorPrompt?: (projectId: string) => void;
  /** ADR-016: project id whose prompt editor is currently open. Drives
   *  the rendered row's `aria-current` and active styling. */
  activeProjectPromptId?: string | null;

  /** When >1 issues are selected, disable card drag-and-drop in the tree.
   * Mirrors KanbanCard's `dragDisabled={isMultiSelectActive}` (PLAN §7.5). */
  isMultiSelectActive?: boolean;

  /** Right-aligned actions for the Projects section header (e.g. create-project button). */
  headerActions?: ReactNode;
  /** Bottom bar content (e.g. Notifications / Settings buttons), rendered in
   *  a shared SidebarBar pinned to the bottom. */
  bottomActions?: ReactNode;
  railHeader?: ReactNode;
  railNav?: ReactNode;
  railFooter?: ReactNode;
  className?: string;
}

export function Sidebar({
  projects,
  activeProjectId,
  activeProjectPromptId,
  workspaces,
  archivedWorkspaces = [],
  membership,
  activeWorkspaceId,
  tasksByProject,
  loadingTasksProjectIds,
  activeIssueId,
  onTasksExpansionChange,
  onSelectIssue,
  isLoadingProjects,
  isLoadingWorkspaces,
  onSelectWorkspace,
  onOpenProjectPage,
  onOpenWorkspacesPage,
  onOpenLastWorkspace,
  onCreateChildBoard,
  onDeleteProject,
  onManageRepos,
  onArchiveWorkspace,
  onDeleteWorkspace,
  onSelectOrchestratorPrompt,
  isMultiSelectActive,
  headerActions,
  bottomActions,
  railHeader,
  railNav,
  railFooter,
  className,
  attentionOnlyWorkspaces,
  onMarkSeen,
  workspaceByIssueId,
  captainByProject,
}: SidebarProps) {
  const { t } = useTranslation('common');
  const titleId = useId();
  const hasRail = Boolean(railHeader || railNav || railFooter);
  return (
    <aside
      aria-label={t('common:ui.primarySidebar')}
      className={cn(
        'flex h-full shrink-0 overflow-hidden border-r border-border bg-secondary',
        hasRail
          ? 'w-[304px] flex-row'
          : 'w-[256px] flex-col gap-2 px-2 pt-2 pb-2',
        className
      )}
    >
      {hasRail && (
        <div className="flex w-[64px] shrink-0 flex-col items-center border-r border-border bg-primary px-1 py-2.5">
          {railHeader && (
            <div className="mb-3 flex flex-col items-center">{railHeader}</div>
          )}
          {railNav && (
            <nav
              aria-label="Primary navigation"
              className="flex w-full flex-col items-center gap-1.5"
            >
              {railNav}
            </nav>
          )}
          {railFooter && (
            <div className="mt-auto flex w-full flex-col items-center gap-1.5 pt-2">
              {railFooter}
            </div>
          )}
        </div>
      )}

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-2 overflow-hidden',
          hasRail && 'px-2.5 pt-2.5 pb-2'
        )}
      >
        <SidebarBucketBar
          workspaces={workspaces}
          attentionOnlyWorkspaces={attentionOnlyWorkspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
          onMarkSeen={onMarkSeen}
        />

        <SidebarSeparator />

        <SidebarSectionHeader
          title={t('appBar.projects')}
          titleId={titleId}
          actions={headerActions}
        />

        {hasRail ? (
          <SidebarProjectCards
            projects={projects}
            activeProjectId={activeProjectId}
            workspaces={workspaces}
            archivedWorkspaces={archivedWorkspaces}
            membership={membership}
            activeWorkspaceId={activeWorkspaceId}
            tasksByProject={tasksByProject}
            workspaceByIssueId={workspaceByIssueId}
            captainByProject={captainByProject}
            loadingTasksProjectIds={loadingTasksProjectIds}
            activeIssueId={activeIssueId}
            isLoading={isLoadingProjects || isLoadingWorkspaces}
            onSelectWorkspace={onSelectWorkspace}
            onSelectIssue={onSelectIssue}
            onOpenProjectPage={onOpenProjectPage}
            onCreateChildBoard={onCreateChildBoard}
            onDeleteProject={onDeleteProject}
            onManageRepos={onManageRepos}
            onSelectOrchestratorPrompt={onSelectOrchestratorPrompt}
          />
        ) : (
          <SidebarProjectTree
            projects={projects}
            activeProjectId={activeProjectId}
            activeProjectPromptId={activeProjectPromptId}
            workspaces={workspaces}
            archivedWorkspaces={archivedWorkspaces}
            membership={membership}
            activeWorkspaceId={activeWorkspaceId}
            tasksByProject={tasksByProject}
            workspaceByIssueId={workspaceByIssueId}
            captainByProject={captainByProject}
            loadingTasksProjectIds={loadingTasksProjectIds}
            activeIssueId={activeIssueId}
            onTasksExpansionChange={onTasksExpansionChange}
            onSelectIssue={onSelectIssue}
            isLoading={isLoadingProjects || isLoadingWorkspaces}
            onSelectWorkspace={onSelectWorkspace}
            onOpenProjectPage={onOpenProjectPage}
            onOpenWorkspacesPage={onOpenWorkspacesPage}
            onOpenLastWorkspace={onOpenLastWorkspace}
            onCreateChildBoard={onCreateChildBoard}
            onDeleteProject={onDeleteProject}
            onManageRepos={onManageRepos}
            onArchiveWorkspace={onArchiveWorkspace}
            onDeleteWorkspace={onDeleteWorkspace}
            onSelectOrchestratorPrompt={onSelectOrchestratorPrompt}
            isMultiSelectActive={isMultiSelectActive}
            ariaLabelledBy={titleId}
          />
        )}

        {!hasRail && bottomActions && (
          <SidebarBar
            aria-label={t('sidebar.bottomBarLabel')}
            className="mt-auto pt-2"
          >
            {bottomActions}
          </SidebarBar>
        )}
      </div>
    </aside>
  );
}
