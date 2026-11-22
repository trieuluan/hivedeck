"use client";

import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn";

export type ViewNavMode = "kanban" | "list";

export type ViewNavStatus = {
  id: string;
  name: string;
  color?: string;
  count?: number;
};

export interface ViewNavTabsProps {
  activeView: ViewNavMode;
  onViewChange: (view: ViewNavMode) => void;
  statuses: ViewNavStatus[];
  selectedStatusId: string | null;
  onStatusSelect: (statusId: string | null) => void;
  className?: string;
}

export function ViewNavTabs({
  activeView,
  onViewChange,
  statuses,
  selectedStatusId,
  onStatusSelect,
  className,
}: ViewNavTabsProps) {
  const { t } = useTranslation("common");

  const controlClass = (active: boolean) =>
    cn(
      "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
      active
        ? "border-brand/50 bg-brand/15 text-brand"
        : "border-border/70 bg-secondary/40 text-low hover:bg-secondary hover:text-normal",
    );

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div
        role="group"
        aria-label={t("kanban.viewTabs.viewSwitcher", "View switcher")}
        className="flex min-w-0 items-center gap-1.5"
      >
        <button
          type="button"
          aria-pressed={activeView === "kanban"}
          onClick={() => onViewChange("kanban")}
          className={controlClass(activeView === "kanban")}
        >
          {t("kanban.viewTabs.board", "Board")}
        </button>
        <button
          type="button"
          aria-pressed={activeView === "list"}
          onClick={() => onViewChange("list")}
          className={controlClass(activeView === "list")}
        >
          {t("kanban.viewTabs.list", "List")}
        </button>
      </div>

      <div
        role="group"
        aria-label={t("kanban.viewTabs.statusFilter", "Status filter")}
        className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-1"
      >
        <button
          type="button"
          aria-pressed={selectedStatusId === null}
          onClick={() => onStatusSelect(null)}
          className={controlClass(selectedStatusId === null)}
        >
          <span>{t("kanban.viewTabs.all", "All")}</span>
        </button>

        {statuses.map((status) => {
          const isStatusActive = selectedStatusId === status.id;
          return (
            <button
              key={status.id}
              type="button"
              aria-pressed={isStatusActive}
              onClick={() => onStatusSelect(status.id)}
              className={controlClass(isStatusActive)}
            >
              {status.color && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `hsl(${status.color})` }}
                />
              )}
              <span>{status.name}</span>
              {typeof status.count === "number" && (
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] tabular-nums",
                    isStatusActive
                      ? "bg-brand/20 text-brand"
                      : "bg-primary/70 text-low",
                  )}
                >
                  {status.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
