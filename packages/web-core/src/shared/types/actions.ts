import type { Icon } from '@phosphor-icons/react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  EditorType,
  ExecutionProcess,
  Workspace,
  WorkspaceKind,
  PatchType,
} from 'shared/types';
import type { Workspace as RemoteWorkspace } from 'shared/remote-types';
import type { DiffViewMode } from '@/shared/stores/useDiffViewStore';
import type { LayoutMode } from '@/shared/stores/useUiPreferencesStore';
import { RIGHT_MAIN_PANEL_MODES } from '@/shared/stores/useUiPreferencesStore';
import type { AppNavigation } from '@/shared/lib/routes/appNavigation';
import type { ProjectIssueCreateOptions } from '@/shared/stores/useKanbanIssueComposerStore';
import type { AppRuntime } from '@/shared/hooks/useAppRuntime';
import i18n from 'i18next';

// Portable type aliases (avoid importing from component containers)
export type LogEntry = Extract<
  PatchType,
  { type: 'STDOUT' } | { type: 'STDERR' }
>;

export type LogsPanelContent =
  | { type: 'process'; processId: string }
  | {
      type: 'tool';
      toolName: string;
      content: string;
      command: string | undefined;
    }
  | { type: 'terminal' };

// Special icon types for ContextBar
export type SpecialIconType = 'ide-icon' | 'copy-icon';
export type ActionIcon = Icon | SpecialIconType;

// Dev server state type for visibility context
export type DevServerState = 'stopped' | 'starting' | 'running' | 'stopping';

// Project mutations interface (registered by ProjectProvider consumers)
export interface ProjectMutations {
  removeIssue: (id: string) => void;
  duplicateIssue: (issueId: string) => void;
  getIssue: (issueId: string) => { simple_id: string } | undefined;
  /**
   * Open the lightweight create-issue modal for the current project. Resolves
   * with the newly-created issue id, or `null` if the user cancelled.
   * Lives on `ProjectMutations` because it needs ProjectContext data (statuses,
   * issues, insertIssue, etc.) — registered by `ProjectMutationsRegistration`
   * which is mounted INSIDE `ProjectProvider`.
   */
  createIssue: (options?: ProjectIssueCreateOptions) => Promise<string | null>;
  /**
   * Move cards to the project's Cancelled column, note the reason as a
   * comment, and archive their workspaces (branches are kept). Resolves to
   * false when the project has no Cancelled column.
   */
  cancelIssues: (
    issueIds: string[],
    reason: string,
    deleteWorkspaces?: boolean
  ) => Promise<boolean>;
}

// Workspace type for sidebar (minimal subset needed for workspace selection)
interface SidebarWorkspace {
  id: string;
  isRunning?: boolean;
  isPinned?: boolean;
  kind?: WorkspaceKind | null;
}

// Context provided to action executors (from React hooks)
export interface ActionExecutorContext {
  appRuntime: AppRuntime;
  currentHostId: string | null;
  appNavigation: AppNavigation;
  queryClient: QueryClient;
  selectWorkspace: (workspaceId: string) => void;
  activeWorkspaces: SidebarWorkspace[];
  archivedWorkspaces: SidebarWorkspace[];
  currentWorkspaceId: string | null;
  containerRef: string | null;
  runningDevServers: ExecutionProcess[];
  startDevServer: () => void;
  stopDevServer: () => void;
  // Logs panel state
  currentLogs: LogEntry[] | null;
  logsPanelContent: LogsPanelContent | null;
  // Command bar navigation
  openStatusSelection: (projectId: string, issueIds: string[]) => Promise<void>;
  openPrioritySelection: (
    projectId: string,
    issueIds: string[]
  ) => Promise<void>;
  openSubIssueSelection: (
    projectId: string,
    issueId: string,
    mode?: 'addChild' | 'setParent'
  ) => Promise<{ type: string } | undefined>;
  openWorkspaceSelection: (projectId: string, issueId: string) => Promise<void>;
  openRelationshipSelection: (
    projectId: string,
    issueId: string,
    relationshipType: 'blocking' | 'related' | 'has_duplicate',
    direction: 'forward' | 'reverse'
  ) => Promise<void>;
  // Kanban issue creation (delegates to ProjectMutations.createIssue when
  // mounted inside ProjectProvider; no-op otherwise).
  createIssue: (options?: ProjectIssueCreateOptions) => Promise<string | null>;
  // Default status for issue creation based on current kanban tab
  defaultCreateStatusId?: string;
  // Current kanban context (for project settings action)
  kanbanProjectId?: string;
  // Project mutations (registered when inside ProjectProvider)
  projectMutations?: ProjectMutations;
  // Remote workspaces (from Electric sync via WorkspacesContext)
  remoteWorkspaces: RemoteWorkspace[];
}

// Context for evaluating action visibility and state conditions
export interface ActionVisibilityContext {
  // Layout state
  layoutMode: LayoutMode;
  rightMainPanelMode:
    | (typeof RIGHT_MAIN_PANEL_MODES)[keyof typeof RIGHT_MAIN_PANEL_MODES]
    | null;
  isLeftSidebarVisible: boolean;
  isLeftMainPanelVisible: boolean;
  isRightSidebarVisible: boolean;
  isCreateMode: boolean;

  // Workspace state
  hasWorkspace: boolean;
  workspaceArchived: boolean;

  // Diff state
  hasDiffs: boolean;
  diffViewMode: DiffViewMode;
  isAllDiffsExpanded: boolean;

  // Dev server state
  editorType: EditorType | null;
  devServerState: DevServerState;
  runningDevServers: ExecutionProcess[];

  // Git panel state
  hasGitRepos: boolean;
  hasMultipleRepos: boolean;
  hasOpenPR: boolean;
  hasCommitsAhead: boolean;
  hasUnpushedCommits: boolean;
  hasUncommittedChanges: boolean;

  // Execution state
  isAttemptRunning: boolean;

  // Logs panel state
  logsPanelContent: LogsPanelContent | null;

  // Kanban state
  hasSelectedKanbanIssue: boolean;
  hasSelectedKanbanIssueParent: boolean;
  isCreatingIssue: boolean;
}

// Enum discriminant for action target types
export enum ActionTargetType {
  NONE = 'none',
  WORKSPACE = 'workspace',
  GIT = 'git',
  ISSUE = 'issue',
}

// Base properties shared by all actions
interface ActionBase {
  id: string;
  label: string | ((workspace?: Workspace) => string);
  icon: ActionIcon;
  shortcut?: string;
  variant?: 'default' | 'destructive';
  keywords?: string[];
  isVisible?: (ctx: ActionVisibilityContext) => boolean;
  isActive?: (ctx: ActionVisibilityContext) => boolean;
  isEnabled?: (ctx: ActionVisibilityContext) => boolean;
  getIcon?: (ctx: ActionVisibilityContext) => ActionIcon;
  getTooltip?: (ctx: ActionVisibilityContext) => string;
  getLabel?: (ctx: ActionVisibilityContext) => string;
}

// Global action (no target needed)
export interface GlobalActionDefinition extends ActionBase {
  requiresTarget: ActionTargetType.NONE;
  execute: (ctx: ActionExecutorContext) => Promise<void> | void;
}

// Workspace action (target required - validated by ActionsContext)
export interface WorkspaceActionDefinition extends ActionBase {
  requiresTarget: ActionTargetType.WORKSPACE;
  execute: (
    ctx: ActionExecutorContext,
    workspaceId: string
  ) => Promise<void> | void;
}

// Git action (requires workspace + repoId)
export interface GitActionDefinition extends ActionBase {
  requiresTarget: ActionTargetType.GIT;
  execute: (
    ctx: ActionExecutorContext,
    workspaceId: string,
    repoId: string
  ) => Promise<void> | void;
}

// Issue action (requires projectId + issueIds)
export interface IssueActionDefinition extends ActionBase {
  requiresTarget: ActionTargetType.ISSUE;
  execute: (
    ctx: ActionExecutorContext,
    projectId: string,
    issueIds: string[]
  ) => Promise<void> | void;
}

// Discriminated union
export type ActionDefinition =
  | GlobalActionDefinition
  | WorkspaceActionDefinition
  | GitActionDefinition
  | IssueActionDefinition;

// Divider markers
export const NavbarDivider = { type: 'divider' } as const;
export type NavbarItem = ActionDefinition | typeof NavbarDivider;
export const ContextBarDivider = { type: 'divider' } as const;
export type ContextBarItem = ActionDefinition | typeof ContextBarDivider;

// Action labels are written in English; other languages translate them via
// the `actions` namespace, keyed by the English text itself. English (no
// `actions` bundle) falls through to the label as written.
const ACTION_T_OPTIONS = {
  ns: 'actions',
  keySeparator: false,
  nsSeparator: false,
} as const;

export function translateActionLabel(label: string): string {
  const openIn = /^Open in (.+)$/.exec(label);
  if (openIn && !i18n.exists(label, ACTION_T_OPTIONS)) {
    return i18n.t('Open in {{name}}', {
      ...ACTION_T_OPTIONS,
      name: openIn[1],
      defaultValue: label,
    });
  }
  return i18n.t(label, { ...ACTION_T_OPTIONS, defaultValue: label });
}

// Helper to resolve dynamic label
export function resolveLabel(
  action: ActionDefinition,
  workspace?: Workspace
): string {
  return translateActionLabel(
    typeof action.label === 'function' ? action.label(workspace) : action.label
  );
}

// Helper to check if an icon is a special type
export function isSpecialIcon(icon: ActionIcon): icon is SpecialIconType {
  return icon === 'ide-icon' || icon === 'copy-icon';
}

// Pure action helper functions
export function isActionVisible(
  action: ActionDefinition,
  ctx: ActionVisibilityContext
): boolean {
  return action.isVisible ? action.isVisible(ctx) : true;
}

export function isActionActive(
  action: ActionDefinition,
  ctx: ActionVisibilityContext
): boolean {
  return action.isActive ? action.isActive(ctx) : false;
}

export function isActionEnabled(
  action: ActionDefinition,
  ctx: ActionVisibilityContext
): boolean {
  return action.isEnabled ? action.isEnabled(ctx) : true;
}

export function getActionIcon(
  action: ActionDefinition,
  ctx: ActionVisibilityContext
): ActionIcon {
  return action.getIcon ? action.getIcon(ctx) : action.icon;
}

export function getActionTooltip(
  action: ActionDefinition,
  ctx: ActionVisibilityContext
): string {
  return action.getTooltip
    ? translateActionLabel(action.getTooltip(ctx))
    : resolveLabel(action);
}

export function getActionLabel(
  action: ActionDefinition,
  ctx: ActionVisibilityContext,
  workspace?: Workspace
): string {
  return action.getLabel
    ? translateActionLabel(action.getLabel(ctx))
    : resolveLabel(action, workspace);
}
