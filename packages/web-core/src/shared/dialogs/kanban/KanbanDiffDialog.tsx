import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowSquareOutIcon,
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  ColumnsIcon,
  RowsIcon,
  SidebarSimpleIcon,
  SpinnerIcon,
  TextAlignLeftIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { DiffStats } from 'shared/types';
import { Dialog, DialogContent, DialogTitle } from '@vibe/ui/components/Dialog';
import { cn } from '@/shared/lib/utils';
import { sortDiffs } from '@/shared/lib/fileTreeUtils';
import { useDiffStream } from '@/shared/hooks/useDiffStream';
import { ReviewProvider } from '@/shared/hooks/ReviewProvider';
import {
  ChangesViewContext,
  type ScrollToFileCallback,
} from '@/shared/hooks/useChangesView';
import { useWorkspaceDiffStore } from '@/shared/stores/useWorkspaceDiffStore';
import { useDiffViewStore } from '@/shared/stores/useDiffViewStore';
import { useUiPreferencesStore } from '@/shared/stores/useUiPreferencesStore';
import { useFileInViewStore } from '@/shared/stores/useFileInViewStore';
import { ChangesPanelContainer } from '@/pages/workspaces/ChangesPanelContainer';

export interface KanbanDiffTarget {
  issueId: string;
  issueKey: string;
  issueTitle: string;
  workspaceId: string;
  workspaceName?: string | null;
}

interface KanbanDiffDialogProps {
  target: KanbanDiffTarget | null;
  onOpenChange: (open: boolean) => void;
  onOpenWorkspace: (issueId: string, workspaceId: string) => void;
}

const EMPTY_COMMENTS = [] as never[];
const EMPTY_NORMALIZED = [] as never[];
const EMPTY_FILES: string[] = [];
const noopGetCommentsForFile = () => EMPTY_NORMALIZED;
const noopGetCommentCountForFile = () => 0;
const noopGetFilesWithComments = () => EMPTY_FILES;
const noopGetFirstCommentLine = () => null;
const noopSetShowGitHubComments = () => {};

function splitFilePath(path: string): { name: string; dir: string } {
  const idx = path.lastIndexOf('/');
  if (idx === -1) return { name: path, dir: '' };
  return { name: path.slice(idx + 1), dir: path.slice(0, idx) };
}

/**
 * Project-level diff viewer modal so users can inspect workspace code changes
 * directly from a Kanban card without leaving the board.
 */
export function KanbanDiffDialog({
  target,
  onOpenChange,
  onOpenWorkspace,
}: KanbanDiffDialogProps) {
  const open = Boolean(target);
  const workspaceId = target?.workspaceId ?? null;
  const { diffs, isInitialized, error } = useDiffStream(workspaceId, open);

  const mode = useDiffViewStore((s) => s.mode);
  const setMode = useDiffViewStore((s) => s.setMode);
  const wrapText = useDiffViewStore((s) => s.wrapText);
  const setWrapText = useDiffViewStore((s) => s.setWrapText);

  const expanded = useUiPreferencesStore((s) => s.expanded);
  const setExpandedAll = useUiPreferencesStore((s) => s.setExpandedAll);
  const fileInView = useFileInViewStore((s) => s.fileInView);

  const [showFileList, setShowFileList] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const scrollToFileRef = useRef<ScrollToFileCallback | null>(null);

  const sortedDiffs = useMemo(() => sortDiffs(diffs), [diffs]);

  const diffPathsList = useMemo(
    () => sortedDiffs.map((d) => d.newPath || d.oldPath || '').filter(Boolean),
    [sortedDiffs]
  );

  const diffPaths = useMemo(() => new Set(diffPathsList), [diffPathsList]);

  const diffStats: DiffStats = useMemo(
    () => ({
      files_changed: diffs.length,
      lines_added: diffs.reduce((sum, d) => sum + (d.additions ?? 0), 0),
      lines_removed: diffs.reduce((sum, d) => sum + (d.deletions ?? 0), 0),
    }),
    [diffs]
  );

  const allCollapsed = useMemo(() => {
    if (diffPathsList.length === 0) return false;
    return diffPathsList.every((p) => expanded[`diff:${p}`] === false);
  }, [diffPathsList, expanded]);

  const handleToggleCollapseAll = useCallback(() => {
    if (diffPathsList.length === 0) return;
    const keys = diffPathsList.map((p) => `diff:${p}`);
    setExpandedAll(keys, allCollapsed);
  }, [diffPathsList, allCollapsed, setExpandedAll]);

  const registerScrollToFile = useCallback(
    (cb: ScrollToFileCallback | null) => {
      scrollToFileRef.current = cb;
    },
    []
  );

  const scrollToFile = useCallback((path: string, lineNumber?: number) => {
    setSelectedFile(path);
    scrollToFileRef.current?.(path, lineNumber);
  }, []);

  const changesViewContextValue = useMemo(
    () => ({
      selectedFilePath: selectedFile,
      selectedLineNumber: null,
      selectFile: scrollToFile,
      scrollToFile,
      viewFileInChanges: scrollToFile,
      diffPaths,
      findMatchingDiffPath: (text: string) =>
        diffPaths.has(text) ? text : null,
      registerScrollToFile,
    }),
    [selectedFile, scrollToFile, diffPaths, registerScrollToFile]
  );

  useEffect(() => {
    if (!open) {
      setSelectedFile(null);
      useWorkspaceDiffStore.getState().clearWorkspaceDiffData();
      return;
    }

    useWorkspaceDiffStore.getState().setWorkspaceDiffData({
      diffs,
      diffPaths,
      diffStats,
      gitHubComments: EMPTY_COMMENTS,
      isGitHubCommentsLoading: false,
      showGitHubComments: false,
      setShowGitHubComments: noopSetShowGitHubComments,
      getGitHubCommentsForFile: noopGetCommentsForFile,
      getGitHubCommentCountForFile: noopGetCommentCountForFile,
      getFilesWithGitHubComments: noopGetFilesWithComments,
      getFirstCommentLineForFile: noopGetFirstCommentLine,
    });
  }, [open, diffs, diffPaths, diffStats]);

  useEffect(() => {
    return () => {
      useWorkspaceDiffStore.getState().clearWorkspaceDiffData();
    };
  }, []);

  const activePath = fileInView ?? selectedFile;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="flex h-[85vh] w-[min(94vw,80rem)] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-secondary/30 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {target && (
              <>
                <span className="shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-ibm-plex-mono text-xs font-medium text-normal">
                  {target.issueKey}
                </span>
                <div className="min-w-0">
                  <DialogTitle className="truncate text-sm font-semibold text-high">
                    {target.issueTitle}
                  </DialogTitle>
                  {target.workspaceName && (
                    <p className="truncate text-xs text-low">
                      {target.workspaceName}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {isInitialized && !error && (
              <div className="hidden items-center gap-1.5 rounded border border-border/70 bg-panel px-2 py-1 text-xs font-ibm-plex-mono lg:flex">
                <span className="text-emerald-400">
                  +{diffStats.lines_added}
                </span>
                <span className="text-rose-400">
                  -{diffStats.lines_removed}
                </span>
                <span className="text-low">
                  · {diffStats.files_changed} file
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowFileList((prev) => !prev)}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded border px-2 text-xs font-medium transition-colors',
                showFileList
                  ? 'border-border bg-secondary text-high'
                  : 'border-border/70 bg-panel text-low hover:bg-secondary hover:text-normal'
              )}
              title="Hiện / ẩn danh sách file"
            >
              <SidebarSimpleIcon className="size-3.5" />
              <span className="hidden md:inline">Files</span>
            </button>

            <button
              type="button"
              onClick={() => setWrapText(!wrapText)}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded border px-2 text-xs font-medium transition-colors',
                wrapText
                  ? 'border-brand/60 bg-brand/15 text-brand'
                  : 'border-border/70 bg-panel text-low hover:bg-secondary hover:text-normal'
              )}
              title="Xuống dòng tự động (Wrap text)"
            >
              <TextAlignLeftIcon className="size-3.5" />
              <span className="hidden md:inline">Wrap</span>
            </button>

            <button
              type="button"
              onClick={handleToggleCollapseAll}
              disabled={diffPathsList.length === 0}
              className="inline-flex h-7 items-center gap-1 rounded border border-border/70 bg-panel px-2 text-xs font-medium text-low transition-colors hover:bg-secondary hover:text-normal disabled:opacity-40"
              title={allCollapsed ? 'Mở tất cả file' : 'Thu gọn tất cả file'}
            >
              {allCollapsed ? (
                <ArrowsOutLineVerticalIcon className="size-3.5" />
              ) : (
                <ArrowsInLineVerticalIcon className="size-3.5" />
              )}
              <span className="hidden xl:inline">
                {allCollapsed ? 'Mở hết' : 'Thu gọn'}
              </span>
            </button>

            <div className="inline-flex items-center rounded border border-border/80 bg-panel p-0.5">
              <button
                type="button"
                onClick={() => setMode('unified')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors',
                  mode === 'unified'
                    ? 'bg-secondary text-high'
                    : 'text-low hover:text-normal'
                )}
                title="Unified view"
              >
                <RowsIcon className="size-3.5" />
                <span className="hidden sm:inline">Unified</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('split')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors',
                  mode === 'split'
                    ? 'bg-secondary text-high'
                    : 'text-low hover:text-normal'
                )}
                title="Split view"
              >
                <ColumnsIcon className="size-3.5" />
                <span className="hidden sm:inline">Split</span>
              </button>
            </div>

            {target && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onOpenWorkspace(target.issueId, target.workspaceId);
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded border border-border/80 bg-secondary/50 px-2.5 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high"
              >
                <ArrowSquareOutIcon className="size-3.5" />
                <span className="hidden sm:inline">Mở workspace</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded p-1.5 text-low transition-colors hover:bg-secondary hover:text-normal"
              aria-label="Đóng"
            >
              <XIcon className="size-4" weight="bold" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden bg-primary">
          {!target ? null : error ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-rose-400">
              Không thể tải diff: {error}
            </div>
          ) : !isInitialized ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-low">
              <SpinnerIcon className="size-4 animate-spin" />
              <span>Đang tải diff...</span>
            </div>
          ) : diffs.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-low">
              Không có thay đổi code nào trong workspace này.
            </div>
          ) : (
            <>
              {showFileList && (
                <aside className="hidden w-64 shrink-0 flex-col border-r border-border/70 bg-secondary/20 md:flex">
                  <div className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-low">
                    Changed files ({sortedDiffs.length})
                  </div>
                  <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                    {sortedDiffs.map((diff) => {
                      const path = diff.newPath || diff.oldPath || '';
                      if (!path) return null;
                      const { name, dir } = splitFilePath(path);
                      const isActive = activePath === path;
                      return (
                        <button
                          key={path}
                          type="button"
                          onClick={() => scrollToFile(path)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors',
                            isActive
                              ? 'bg-secondary text-high'
                              : 'text-normal hover:bg-secondary/50'
                          )}
                          title={path}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium">
                              {name}
                            </div>
                            {dir && (
                              <div className="truncate text-[10px] text-low">
                                {dir}
                              </div>
                            )}
                          </div>
                          <div className="shrink-0 font-ibm-plex-mono text-[10px] tabular-nums">
                            {(diff.additions ?? 0) > 0 && (
                              <span className="text-emerald-400">
                                +{diff.additions}
                              </span>
                            )}
                            {(diff.deletions ?? 0) > 0 && (
                              <span className="ml-1 text-rose-400">
                                -{diff.deletions}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </aside>
              )}

              <div className="min-w-0 flex-1 overflow-hidden">
                <ChangesViewContext.Provider value={changesViewContextValue}>
                  <ReviewProvider workspaceId={target.workspaceId}>
                    <ChangesPanelContainer
                      className="h-full"
                      workspaceId={target.workspaceId}
                    />
                  </ReviewProvider>
                </ChangesViewContext.Provider>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
