import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { cn } from "../lib/cn";

interface TerminalPanelTab {
  id: string;
  title: string;
}

interface TerminalPanelNewTabOption {
  id: string;
  label: string;
}

interface TerminalPanelProps {
  tabs: TerminalPanelTab[];
  activeTabId: string | null;
  renderTab: (tabId: string, isActive: boolean) => ReactNode;
  onSelectTab?: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  /** Kinds of tab the "+" menu can open (a shell, an agent CLI, …). */
  newTabOptions?: TerminalPanelNewTabOption[];
  onNewTab?: (optionId: string) => void;
}

export function TerminalPanel({
  tabs,
  activeTabId,
  renderTab,
  onSelectTab,
  onCloseTab,
  newTabOptions,
  onNewTab,
}: TerminalPanelProps) {
  const { t } = useTranslation();
  // Render only the active terminal. Inactive ones stay alive in the provider
  // (their xterm instance and WebSocket persist), so switching back re-attaches
  // the existing element rather than spawning a new session.
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      {(tabs.length > 1 || (onNewTab && newTabOptions?.length)) && (
        <div className="flex items-stretch gap-px shrink-0 border-b border-border bg-tertiary overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            return (
              <div
                key={tab.id}
                role="button"
                tabIndex={0}
                className={cn(
                  "group flex items-center gap-1 pl-base pr-1 py-half text-xs cursor-pointer border-r border-border shrink-0",
                  isActive
                    ? "bg-secondary text-normal"
                    : "text-low hover:text-normal",
                )}
                onClick={() => onSelectTab?.(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectTab?.(tab.id);
                  }
                }}
              >
                <span className="truncate max-w-[120px]">{tab.title}</span>
                {onCloseTab && (
                  <button
                    type="button"
                    title={t("common:ui.closeTerminal")}
                    aria-label={t("common:ui.closeTerminal")}
                    className="opacity-50 hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                  >
                    <XIcon className="size-icon-xs" weight="bold" />
                  </button>
                )}
              </div>
            );
          })}
          {onNewTab && newTabOptions && newTabOptions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title={t("common:ui.newTerminalTab")}
                  aria-label={t("common:ui.newTerminalTab")}
                  className="flex shrink-0 items-center px-base text-low hover:text-high"
                >
                  <PlusIcon className="size-icon-xs" weight="bold" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {newTabOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.id}
                    onSelect={() => onNewTab(option.id)}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 w-full">
        {activeTab && renderTab(activeTab.id, true)}
      </div>
    </div>
  );
}
