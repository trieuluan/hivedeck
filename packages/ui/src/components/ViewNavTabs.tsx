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
  hiddenStatuses: ViewNavStatus[];
  selectedStatusId: string | null;
  onStatusSelect: (statusId: string | null) => void;
  activeCount?: number;
  className?: string;
}

export function ViewNavTabs({
  activeView,
  onViewChange,
  hiddenStatuses,
  selectedStatusId,
  onStatusSelect,
  activeCount,
  className,
}: ViewNavTabsProps) {
  const { t } = useTranslation("common");
  const isActiveTab = activeView === "kanban";
  const isAllTab = activeView === "list" && selectedStatusId === null;

  const pillClass = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
      active
        ? "border-brand/50 bg-brand/15 text-brand"
        : "border-border/70 bg-secondary/40 text-low hover:bg-secondary hover:text-normal",
    );

  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
    >
      {/* Active (Kanban) tab */}
      <button
        type="button"
        onClick={() => {
          onViewChange("kanban");
          onStatusSelect(null);
        }}
        className={pillClass(isActiveTab)}
      >
        <span>{t("kanban.viewTabs.active")}</span>
        {typeof activeCount === "number" && (
          <span
            className={cn(
              "rounded px-1.5 py-0.2 text-[10px] tabular-nums",
              isActiveTab ? "bg-brand/20 text-brand" : "bg-primary/70 text-low",
            )}
          >
            {activeCount}
          </span>
        )}
      </button>

      {/* Hidden / terminal status tabs (Done, Cancelled, etc.) */}
      {hiddenStatuses.map((status) => {
        const isStatusActive =
          activeView === "list" && selectedStatusId === status.id;
        return (
          <button
            key={status.id}
            type="button"
            onClick={() => {
              onViewChange("list");
              onStatusSelect(status.id);
            }}
            className={pillClass(isStatusActive)}
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
                  "rounded px-1.5 py-0.2 text-[10px] tabular-nums",
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

      {/* All (List) tab */}
      <button
        type="button"
        onClick={() => {
          onViewChange("list");
          onStatusSelect(null);
        }}
        className={pillClass(isAllTab)}
      >
        <span>{t("kanban.viewTabs.all")}</span>
      </button>
    </div>
  );
}
