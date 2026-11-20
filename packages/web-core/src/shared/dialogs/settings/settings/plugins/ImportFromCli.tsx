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

type CandidateKind = 'mcp' | 'skill';

type CandidateSource =
  | 'claude_code'
  | 'codex'
  | 'opencode'
  | 'gemini'
  | 'cursor_agent'
  | 'copilot'
  | 'qwen_code'
  | 'amp'
  | 'droid';

type Candidate = {
  name: string;
  kind: CandidateKind;
  sources: CandidateSource[];
  exists: boolean;
  description?: string;
};

const SOURCE_LABEL: Record<CandidateSource, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini',
  cursor_agent: 'Cursor',
  copilot: 'Copilot',
  qwen_code: 'Qwen',
  amp: 'Amp',
  droid: 'Droid',
};

const SOURCE_BADGE_CLASS: Record<CandidateSource, string> = {
  claude_code: 'border-brand/25 bg-brand/10 text-brand',
  codex:
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  opencode: 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  gemini: 'border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  cursor_agent:
    'border-purple-500/25 bg-purple-500/10 text-purple-600 dark:text-purple-400',
  copilot:
    'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  qwen_code:
    'border-indigo-500/25 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  amp: 'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  droid: 'border-teal-500/25 bg-teal-500/10 text-teal-600 dark:text-teal-400',
};

const candidateKey = (c: Pick<Candidate, 'kind' | 'name'>) =>
  `${c.kind}:${c.name}`;

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
  const mcpCandidates =
    candidates?.filter((candidate) => candidate.kind !== 'skill') ?? [];
  const skillCandidates =
    candidates?.filter((candidate) => candidate.kind === 'skill') ?? [];
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
      const items = selected.map((key) => {
        const idx = key.indexOf(':');
        return {
          kind: key.slice(0, idx) as CandidateKind,
          name: key.slice(idx + 1),
        };
      });
      const result = await request<{ imported: string[]; skipped: string[] }>(
        'import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
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
                  {mcpCandidates.length} MCP · {skillCandidates.length} skill
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {candidates && free.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const allSelected = free.every((c) =>
                      selected.includes(candidateKey(c))
                    );
                    setSelected(
                      allSelected ? [] : free.map((c) => candidateKey(c))
                    );
                  }}
                  className="rounded-sm border border-border bg-panel px-2.5 py-1 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high"
                >
                  {free.every((c) => selected.includes(candidateKey(c)))
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
              <div className="space-y-4">
                {[
                  {
                    id: 'mcp',
                    title: `MCP Servers (${mcpCandidates.length})`,
                    items: mcpCandidates,
                  },
                  {
                    id: 'skill',
                    title: `Skills lẻ trên máy (${skillCandidates.length})`,
                    items: skillCandidates,
                  },
                ]
                  .filter((group) => group.items.length > 0)
                  .map((group) => (
                    <div key={group.id} className="space-y-2">
                      <div className="text-2xs font-semibold uppercase tracking-wide text-low">
                        {group.title}
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {group.items.map((candidate) => {
                          const key = candidateKey(candidate);
                          const isSelected = selected.includes(key);
                          return (
                            <button
                              key={key}
                              type="button"
                              disabled={candidate.exists || busy}
                              onClick={() =>
                                setSelected(
                                  isSelected
                                    ? selected.filter((item) => item !== key)
                                    : [...selected, key]
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
                                  {candidate.description && (
                                    <p className="line-clamp-1 text-2xs text-low">
                                      {candidate.description}
                                    </p>
                                  )}
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
                                  <CheckIcon
                                    className="h-3 w-3"
                                    weight="bold"
                                  />
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
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
