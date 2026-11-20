import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckIcon,
  DownloadSimpleIcon,
  SpinnerIcon,
  TerminalWindowIcon,
  XIcon,
} from '@phosphor-icons/react';
import { handleApiResponse } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { errorText, type Notice } from './pluginNotice';
import { PluginAvatar } from './PluginAvatar';

type Candidate = {
  name: string;
  sources: ('claude_code' | 'codex')[];
  exists: boolean;
};

const SOURCE_LABEL = { claude_code: 'Claude Code', codex: 'Codex' } as const;

const SOURCE_BADGE_CLASS = {
  claude_code: 'border-brand/25 bg-brand/10 text-brand',
  codex:
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
} as const;

const request = async <T,>(path: string, init?: RequestInit): Promise<T> =>
  handleApiResponse<T>(await fetch(`/api/mcp-registry/${path}`, init));

export function ImportFromCli({
  notify,
  onImported,
  open,
  onOpenChange,
  hideTrigger = false,
}: {
  notify: (notice: Notice) => void;
  onImported: () => Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const { t } = useTranslation('settings');
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const free = candidates?.filter((candidate) => !candidate.exists) ?? [];
  const none = t('settings.plugins.none');

  const load = async () => {
    setBusy(true);
    try {
      setCandidates(await request<Candidate[]>('import-candidates'));
      setSelected([]);
    } catch (reason) {
      notify({ kind: 'error', text: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void load();
    } else {
      setCandidates(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const doImport = async () => {
    setBusy(true);
    try {
      const result = await request<{ imported: string[]; skipped: string[] }>(
        'import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names: selected }),
        }
      );
      setCandidates(null);
      setSelected([]);
      setOpen(false);
      await onImported();
      notify({
        kind: 'ok',
        text: t('settings.plugins.notice.imported', {
          imported: result.imported.join(', ') || none,
          skipped: result.skipped.join(', ') || none,
        }),
      });
    } catch (reason) {
      notify({ kind: 'error', text: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen && hideTrigger) {
    return null;
  }

  return (
    <div className="space-y-2.5">
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high"
        >
          <DownloadSimpleIcon
            className="h-3.5 w-3.5"
            weight="bold"
            aria-hidden
          />
          {t('settings.plugins.import.link')}
        </button>
      )}
      {isOpen && (
        <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-panel text-normal">
                <TerminalWindowIcon
                  className="h-3.5 w-3.5"
                  weight="duotone"
                  aria-hidden
                />
              </span>
              <span className="text-sm font-semibold text-high">
                {t('settings.plugins.import.pick')}
              </span>
              {candidates && candidates.length > 0 && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-2xs font-medium text-low">
                  {candidates.length} server
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {candidates && free.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const allSelected = free.every((c) =>
                      selected.includes(c.name)
                    );
                    setSelected(allSelected ? [] : free.map((c) => c.name));
                  }}
                  className="rounded-sm border border-border bg-panel px-2.5 py-1 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high"
                >
                  {free.every((c) => selected.includes(c.name))
                    ? 'Bỏ chọn tất cả'
                    : t('settings.plugins.import.all')}
                </button>
              )}
              <button
                type="button"
                aria-label="Đóng"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-low transition-colors hover:bg-secondary hover:text-high"
              >
                <XIcon className="h-3.5 w-3.5" weight="bold" aria-hidden />
              </button>
            </div>
          </div>

          {busy && !candidates && (
            <p className="flex items-center gap-2 py-2 text-xs text-low">
              <SpinnerIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t('settings.plugins.import.loading')}
            </p>
          )}
          {candidates && candidates.length === 0 && (
            <p className="rounded-sm border border-dashed border-border p-3 text-center text-xs text-low">
              {t('settings.plugins.import.empty')}
            </p>
          )}
          {candidates && candidates.length > 0 && (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {candidates.map((candidate) => {
                  const isSelected = selected.includes(candidate.name);
                  return (
                    <button
                      key={candidate.name}
                      type="button"
                      disabled={candidate.exists || busy}
                      onClick={() =>
                        setSelected(
                          isSelected
                            ? selected.filter((name) => name !== candidate.name)
                            : [...selected, candidate.name]
                        )
                      }
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-md border p-2.5 text-left transition-colors',
                        candidate.exists
                          ? 'cursor-not-allowed border-border/60 bg-secondary/10 opacity-60'
                          : isSelected
                            ? 'border-brand/70 bg-brand/[0.08]'
                            : 'border-border bg-panel/60 hover:bg-secondary/40'
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <PluginAvatar name={candidate.name} size="sm" />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-high">
                              {candidate.name}
                            </span>
                            {candidate.exists && (
                              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-2xs text-low">
                                {t('settings.plugins.import.exists')}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {candidate.sources.map((source) => (
                              <span
                                key={source}
                                className={cn(
                                  'inline-flex items-center rounded border px-1.5 py-0.5 text-2xs font-medium',
                                  SOURCE_BADGE_CLASS[source]
                                )}
                              >
                                {SOURCE_LABEL[source]}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                          isSelected
                            ? 'border-brand bg-brand text-white'
                            : 'border-border bg-secondary/60'
                        )}
                      >
                        {isSelected && (
                          <CheckIcon className="h-3 w-3" weight="bold" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                <span className="text-2xs text-low">
                  Chỉ sao chép sang HiveDeck, không sửa config CLI gốc.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high"
                  >
                    Huỷ
                  </button>
                  <button
                    type="button"
                    disabled={busy || !selected.length}
                    onClick={() => void doImport()}
                    className="inline-flex items-center gap-1.5 rounded-sm bg-brand px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-brand/90 disabled:opacity-50"
                  >
                    <DownloadSimpleIcon
                      className="h-3.5 w-3.5"
                      weight="bold"
                      aria-hidden
                    />
                    {t('settings.plugins.import.action')}
                    {selected.length > 0 ? ` (${selected.length})` : ''}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
