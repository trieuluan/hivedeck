import { useState } from 'react';
import {
  ArchiveIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
} from '@phosphor-icons/react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@vibe/ui/components/Popover';
import { formatRelativeTime } from '@/shared/lib/date';
import { cn } from '@/shared/lib/utils';

export interface ArchivedWorkspaceItem {
  id: string;
  name: string;
  branch?: string;
  updatedAt?: string;
  linesAdded?: number;
  linesRemoved?: number;
  latestProcessStatus?: 'running' | 'completed' | 'failed' | 'killed';
  prStatus?: 'open' | 'merged' | 'closed' | 'unknown';
}

export interface ArchivedWorkspacesChipProps {
  items: ArchivedWorkspaceItem[];
  onOpen: (localWorkspaceId: string) => void;
}

function getStatusBadge(item: ArchivedWorkspaceItem): {
  label: string;
  className: string;
} {
  if (item.prStatus === 'merged') {
    return {
      label: '✓ Đã merge',
      className: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300',
    };
  }
  if (
    item.latestProcessStatus === 'failed' ||
    item.latestProcessStatus === 'killed'
  ) {
    return {
      label: '✕ Lỗi',
      className: 'border-rose-500/35 bg-rose-500/15 text-rose-300',
    };
  }
  return {
    label: 'Lưu trữ',
    className: 'border-border/70 bg-secondary/70 text-low',
  };
}

export function ArchivedWorkspacesChip({
  items,
  onOpen,
}: ArchivedWorkspacesChipProps) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  if (items.length === 1) {
    const single = items[0];
    return (
      <button
        type="button"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(single.id);
        }}
        className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-border/50 bg-secondary/30 px-2 py-1 text-[11px] text-low transition-colors hover:bg-secondary/60 hover:text-normal"
        title="Mở workspace đã lưu trữ"
      >
        <ArchiveIcon className="size-3 shrink-0" weight="bold" />
        <span>1 workspace đã lưu trữ</span>
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-border/50 bg-secondary/30 px-2 py-1 text-[11px] text-low transition-colors hover:bg-secondary/60 hover:text-normal"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <ArchiveIcon className="size-3 shrink-0" weight="bold" />
          <span>{items.length} workspace đã lưu trữ</span>
          <CaretDownIcon
            className="size-2.5 shrink-0 opacity-80"
            weight="bold"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="z-[10001] w-[min(21rem,calc(100vw-2rem))] p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border/70 px-3 py-2 text-xs font-semibold text-high">
          Workspace đã lưu trữ ({items.length})
        </div>
        <div className="max-h-64 divide-y divide-border/50 overflow-y-auto">
          {items.map((item) => {
            const badge = getStatusBadge(item);
            const hasDiff =
              (item.linesAdded ?? 0) > 0 || (item.linesRemoved ?? 0) > 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  onOpen(item.id);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-xs font-medium text-normal">
                      {item.name}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none',
                        badge.className
                      )}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-low">
                    {item.branch && (
                      <span className="truncate font-ibm-plex-mono">
                        {item.branch}
                      </span>
                    )}
                    {hasDiff && (
                      <span className="shrink-0 font-ibm-plex-mono tabular-nums">
                        <span className="text-success">
                          +{item.linesAdded ?? 0}
                        </span>{' '}
                        <span className="text-error">
                          -{item.linesRemoved ?? 0}
                        </span>
                      </span>
                    )}
                    {item.updatedAt && (
                      <span className="shrink-0">
                        · {formatRelativeTime(item.updatedAt)}
                      </span>
                    )}
                  </div>
                </div>
                <ArrowSquareOutIcon
                  className="size-3.5 shrink-0 text-low"
                  weight="bold"
                />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
