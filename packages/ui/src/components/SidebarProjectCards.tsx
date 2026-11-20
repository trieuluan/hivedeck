import { useMemo, useState } from "react";
import {
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  DotsThreeIcon,
  FolderIcon,
  FolderSimpleIcon,
  PlusIcon,
  SpinnerIcon,
  TrashIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { isDoneStatusName } from "./outliner/buildTreeData";
import type {
  CaptainState,
  OutlinerWorkspace,
  ProjectTasksData,
  SidebarProject,
  WorkspaceProjectMembership,
} from "./outliner/types";

export interface SidebarProjectCardsProps {
  projects: readonly SidebarProject[];
  activeProjectId: string | null;
  workspaces: OutlinerWorkspace[];
  archivedWorkspaces?: OutlinerWorkspace[];
  membership: WorkspaceProjectMembership;
  activeWorkspaceId: string | null;
  tasksByProject?: ReadonlyMap<string, ProjectTasksData>;
  loadingTasksProjectIds?: ReadonlySet<string>;
  workspaceByIssueId?: ReadonlyMap<string, OutlinerWorkspace>;
  captainByProject?: ReadonlyMap<string, CaptainState>;
  activeIssueId?: string | null;
  isLoading?: boolean;
  onSelectWorkspace: (id: string) => void;
  onSelectIssue?: (
    projectId: string,
    issueId: string,
    parentIssueId?: string | null,
  ) => void;
  onOpenProjectPage?: (projectId: string) => void;
  onCreateChildBoard?: (parentId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onManageRepos?: (projectId: string) => void;
  onSelectOrchestratorPrompt?: (projectId: string) => void;
}

export function SidebarProjectCards({
  projects,
  activeProjectId,
  workspaces,
  archivedWorkspaces = [],
  membership,
  activeWorkspaceId,
  tasksByProject,
  loadingTasksProjectIds,
  workspaceByIssueId,
  captainByProject,
  activeIssueId,
  isLoading,
  onSelectWorkspace,
  onSelectIssue,
  onOpenProjectPage,
  onCreateChildBoard,
  onDeleteProject,
  onManageRepos,
  onSelectOrchestratorPrompt,
}: SidebarProjectCardsProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(activeProjectId ? [activeProjectId] : []),
  );
  const [standaloneOpen, setStandaloneOpen] = useState(false);

  const rootProjects = useMemo(
    () =>
      projects
        .filter((p) => !p.parentId)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
    [projects],
  );

  const standaloneWorkspaces = useMemo(() => {
    return [...workspaces, ...archivedWorkspaces].filter((ws) => {
      if (ws.kind === "orchestrator" || ws.kind === "recurrent") return false;
      const memberProjects = membership.get(ws.id);
      return !memberProjects || memberProjects.size === 0;
    });
  }, [archivedWorkspaces, membership, workspaces]);

  const toggleExpanded = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading && projects.length === 0) {
    return (
      <div className="flex items-center justify-center py-6">
        <SpinnerIcon className="size-icon-sm animate-spin text-low" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
      {rootProjects.map((project) => {
        const isActive = project.id === activeProjectId;
        const isExpanded = isActive || expandedProjects.has(project.id);
        const captain = captainByProject?.get(project.id);
        const captainStatus =
          captain === "running"
            ? {
                label: "Đang chạy",
                pillClass:
                  "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25",
                dotClass: "bg-emerald-400 animate-pulse",
              }
            : captain === "watching"
              ? {
                  label: "Đang chạy",
                  pillClass:
                    "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25",
                  dotClass: "bg-emerald-400",
                }
              : captain === "waiting"
                ? {
                    label: "Chờ duyệt",
                    pillClass:
                      "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25",
                    dotClass: "bg-amber-400 animate-pulse",
                  }
                : captain === "error"
                  ? {
                      label: "Lỗi",
                      pillClass:
                        "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25",
                      dotClass: "bg-rose-400",
                    }
                  : {
                      label: "Đã dừng",
                      pillClass: "bg-secondary text-low hover:text-normal",
                      dotClass: "bg-low/60",
                    };
        const tasksData = tasksByProject?.get(project.id);
        const isTasksLoading = loadingTasksProjectIds?.has(project.id) ?? false;

        const statusMap = new Map(
          (tasksData?.statuses ?? []).map((s) => [s.id, s]),
        );
        const issues = tasksData?.issues ?? [];

        const openIssues: Array<(typeof issues)[number]> = [];
        let doneCount = 0;
        let cancelledCount = 0;
        for (const issue of issues) {
          if (issue.parent_issue_id) continue;
          const st = statusMap.get(issue.status_id);
          const name = st?.name ?? "";
          if (/^cancel/i.test(name.trim())) {
            cancelledCount += 1;
          } else if (st?.is_terminal || isDoneStatusName(name)) {
            doneCount += 1;
          } else {
            openIssues.push(issue);
          }
        }

        const hasExpandedItems =
          (isTasksLoading && issues.length === 0) ||
          openIssues.length > 0 ||
          doneCount > 0 ||
          cancelledCount > 0;

        const accentColor = project.color?.trim() || null;

        return (
          <div
            key={project.id}
            className={cn(
              "rounded-xl border p-2.5 transition-colors",
              isActive
                ? !accentColor && "border-brand/70 bg-brand/[0.06]"
                : "border-border/80 bg-overlay/70 hover:border-border-strong",
            )}
            style={
              isActive && accentColor
                ? {
                    borderColor: `hsl(${accentColor} / 0.65)`,
                    backgroundColor: `hsl(${accentColor} / 0.08)`,
                  }
                : undefined
            }
          >
            {/* Card header */}
            <div className="flex items-center justify-between gap-1.5">
              <button
                type="button"
                onClick={() => onOpenProjectPage?.(project.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <FolderIcon
                  className={cn(
                    "size-4 shrink-0",
                    !accentColor && (isActive ? "text-brand" : "text-low"),
                  )}
                  style={
                    accentColor ? { color: `hsl(${accentColor})` } : undefined
                  }
                  weight="duotone"
                />
                <span className="truncate text-sm font-semibold text-high">
                  {project.name}
                </span>
              </button>

              <div className="flex items-center gap-0.5 shrink-0">
                {hasExpandedItems && (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(project.id)}
                    className="rounded p-1 text-low hover:bg-secondary hover:text-normal"
                    aria-label="Thu gọn / mở rộng"
                  >
                    {isExpanded ? (
                      <CaretDownIcon className="size-3" weight="bold" />
                    ) : (
                      <CaretRightIcon className="size-3" weight="bold" />
                    )}
                  </button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="rounded p-1 text-low hover:bg-secondary hover:text-normal"
                      aria-label="Tùy chọn project"
                    >
                      <DotsThreeIcon className="size-3.5" weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    <DropdownMenuItem
                      onSelect={() => onOpenProjectPage?.(project.id)}
                    >
                      <FolderIcon className="size-3.5 mr-2" />
                      Mở Board
                    </DropdownMenuItem>
                    {onCreateChildBoard && (
                      <DropdownMenuItem
                        onSelect={() => onCreateChildBoard(project.id)}
                      >
                        <PlusIcon className="size-3.5 mr-2" />
                        Tạo board con
                      </DropdownMenuItem>
                    )}
                    {onSelectOrchestratorPrompt && (
                      <DropdownMenuItem
                        onSelect={() => onSelectOrchestratorPrompt(project.id)}
                      >
                        Prompt Thuyền trưởng
                      </DropdownMenuItem>
                    )}
                    {onManageRepos && (
                      <DropdownMenuItem
                        onSelect={() => onManageRepos(project.id)}
                      >
                        Quản lý Repositories
                      </DropdownMenuItem>
                    )}
                    {onDeleteProject && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => onDeleteProject(project.id)}
                          className="text-error focus:text-error"
                        >
                          <TrashIcon className="size-3.5 mr-2" />
                          Xóa Project
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Captain status row */}
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-low">
              <span>Captain:</span>
              <button
                type="button"
                onClick={() => onOpenProjectPage?.(project.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                  captainStatus.pillClass,
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    captainStatus.dotClass,
                  )}
                />
                <span>{captainStatus.label}</span>
              </button>
            </div>

            {/* Expanded items */}
            {isExpanded && hasExpandedItems && (
              <div className="mt-2.5 flex flex-col gap-1 border-t border-border/60 pt-2">
                {isTasksLoading && issues.length === 0 ? (
                  <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] text-low">
                    <SpinnerIcon className="size-3 animate-spin" />
                    <span>Đang tải...</span>
                  </div>
                ) : (
                  <>
                    {openIssues.slice(0, 6).map((issue) => {
                      const linkedWs = workspaceByIssueId?.get(issue.id);
                      const isRowActive =
                        issue.id === activeIssueId ||
                        (linkedWs && linkedWs.id === activeWorkspaceId);
                      const isWsRunning = linkedWs?.isRunning ?? false;
                      return (
                        <button
                          key={issue.id}
                          type="button"
                          onClick={() =>
                            onSelectIssue?.(project.id, issue.id, null)
                          }
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                            isRowActive
                              ? "bg-brand/15 text-high font-medium"
                              : "text-normal hover:bg-secondary/70",
                          )}
                        >
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              isWsRunning
                                ? "bg-emerald-400 animate-pulse"
                                : isRowActive
                                  ? "bg-brand"
                                  : "bg-brand/70",
                            )}
                          />
                          <span className="truncate">
                            {issue.simple_id} · {issue.title}
                          </span>
                        </button>
                      );
                    })}
                    {openIssues.length > 6 && (
                      <button
                        type="button"
                        onClick={() => onOpenProjectPage?.(project.id)}
                        className="px-2 py-0.5 text-left text-[11px] text-low hover:text-brand"
                      >
                        +{openIssues.length - 6} issue khác...
                      </button>
                    )}

                    {(doneCount > 0 || cancelledCount > 0) && (
                      <div className="mt-0.5 flex flex-col gap-0.5">
                        {doneCount > 0 && (
                          <button
                            type="button"
                            onClick={() => onOpenProjectPage?.(project.id)}
                            className="flex items-center justify-between rounded-md px-2 py-1 text-[11px] text-low hover:bg-secondary/50 hover:text-normal"
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <CheckCircleIcon
                                className="size-3.5 text-emerald-400"
                                weight="fill"
                              />
                              <span>Done ({doneCount})</span>
                            </span>
                          </button>
                        )}
                        {cancelledCount > 0 && (
                          <button
                            type="button"
                            onClick={() => onOpenProjectPage?.(project.id)}
                            className="flex items-center justify-between rounded-md px-2 py-1 text-[11px] text-low hover:bg-secondary/50 hover:text-normal"
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <XCircleIcon
                                className="size-3.5 text-low/70"
                                weight="fill"
                              />
                              <span>Cancelled ({cancelledCount})</span>
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Standalone workspaces collapsible footer */}
      {standaloneWorkspaces.length > 0 && (
        <div className="mt-1 border-t border-border/70 pt-2">
          <button
            type="button"
            onClick={() => setStandaloneOpen((prev) => !prev)}
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-low hover:bg-secondary/60 hover:text-normal"
          >
            {standaloneOpen ? (
              <CaretDownIcon className="size-3 shrink-0" weight="bold" />
            ) : (
              <CaretRightIcon className="size-3 shrink-0" weight="bold" />
            )}
            <span>Workspace khác ({standaloneWorkspaces.length})</span>
          </button>
          {standaloneOpen && (
            <div className="mt-1 flex flex-col gap-0.5 pl-2">
              {standaloneWorkspaces.map((ws) => (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => onSelectWorkspace(ws.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                    ws.id === activeWorkspaceId
                      ? "bg-brand/15 text-high font-medium"
                      : "text-low hover:bg-secondary/60 hover:text-normal",
                  )}
                >
                  <FolderSimpleIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{ws.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
