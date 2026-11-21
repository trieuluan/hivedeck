import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkIcon, PlayIcon } from "@phosphor-icons/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./Select";
import { cn } from "../lib/cn";
import { ConfirmDialog } from "./ConfirmDialog";

export interface DispatchWorkspaceOption {
  id: string;
  name: string | null;
  /** Project the workspace is linked to. Used to scope the dropdown to the
   *  current card's project. */
  projectId?: string;
}

export interface KanbanWorkspaceDispatchProps {
  workspaces: DispatchWorkspaceOption[];
  disabled?: boolean;
  onDispatch: (workspaceId: string) => void;
  onLink?: (workspaceId: string) => void;
  className?: string;
  /** Workspaces already linked to this card — shown with a "(running here)" hint. */
  currentWorkspaceIds?: ReadonlySet<string>;
  /** Hide the selector when the linked card has reached a terminal (Done) status.
   *  Workspace history remains reachable through the card's workspace list. */
  issueStatusIsDone?: boolean;
  /** Current card's project id. When provided, only workspaces linked to this
   *  project are listed. */
  currentProjectId?: string;
}

/**
 * Compact per-card dispatch control: pick one of the existing workspaces from
 * a dropdown and press play to run this issue in that workspace's session
 * (dispatches via `POST /api/issues/{id}/dispatch-to-workspace`). Disabled
 * when there are no workspaces to choose from.
 *
 * The selector is hidden entirely when the card is Done, but the rest of the
 * workspace UI (history, linked workspace cards) stays visible.
 */
export function KanbanWorkspaceDispatch({
  workspaces,
  disabled,
  onDispatch,
  onLink,
  className,
  currentWorkspaceIds,
  issueStatusIsDone,
  currentProjectId,
}: KanbanWorkspaceDispatchProps) {
  const { t } = useTranslation("common");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const availableWorkspaces = useMemo(() => {
    if (!currentProjectId) return workspaces;
    return workspaces.filter((w) => w.projectId === currentProjectId);
  }, [workspaces, currentProjectId]);

  if (issueStatusIsDone) {
    return null;
  }

  const value = availableWorkspaces.some(
    (workspace) => workspace.id === selectedId,
  )
    ? selectedId
    : availableWorkspaces[0]?.id;
  const empty = availableWorkspaces.length === 0;
  const isLinked = !!value && !!currentWorkspaceIds?.has(value);

  const handleLink = async () => {
    if (!value || !onLink) return;

    const result = await ConfirmDialog.show({
      title: t("kanban.linkWorkspaceConfirmTitle"),
      message: t("kanban.linkWorkspaceConfirmMessage"),
      confirmText: t("kanban.linkWorkspaceConfirm"),
      cancelText: t("confirm.defaultCancel"),
    });
    if (result === "confirmed") {
      onLink(value);
    }
  };

  return (
    <div
      className={cn("flex items-center gap-half min-w-0", className)}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <Select
        value={value}
        onValueChange={setSelectedId}
        disabled={disabled || empty}
      >
        <SelectTrigger
          className="h-7 min-w-0 flex-1 rounded border border-border/70 bg-secondary/45 px-2 py-0 text-xs text-normal data-[placeholder]:text-low hover:bg-secondary/75 transition-colors"
          aria-label={t("kanban.selectWorkspace")}
        >
          <SelectValue placeholder={t("kanban.selectWorkspace")} />
        </SelectTrigger>
        <SelectContent>
          {availableWorkspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              {workspace.name ?? workspace.id}
              {currentWorkspaceIds?.has(workspace.id)
                ? ` (${t("kanban.currentWorkspace")})`
                : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        disabled={disabled || empty || !value || (!isLinked && !onLink)}
        onClick={() => value && (isLinked ? onDispatch(value) : handleLink())}
        className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded border border-border/70 bg-secondary/60 px-2 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={t(
          isLinked ? "kanban.dispatchIssue" : "kanban.linkThisWorkspace",
        )}
        title={t(
          isLinked ? "kanban.dispatchIssue" : "kanban.linkThisWorkspace",
        )}
      >
        {isLinked ? (
          <PlayIcon className="size-3 shrink-0" weight="fill" />
        ) : (
          <LinkIcon className="size-3 shrink-0" />
        )}
        <span>
          {t(
            isLinked
              ? "kanban.dispatchIssueShort"
              : "kanban.linkThisWorkspaceShort",
            {
              defaultValue: isLinked ? "Run" : "Link",
            },
          )}
        </span>
      </button>
    </div>
  );
}
