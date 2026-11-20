import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { handleApiResponse } from '@/shared/lib/api';
import { SettingsCheckbox } from '../SettingsComponents';
import { errorText, type Notice } from './pluginNotice';

type Candidate = {
  name: string;
  sources: ('claude_code' | 'codex')[];
  exists: boolean;
};

const SOURCE_LABEL = { claude_code: 'Claude Code', codex: 'Codex' } as const;
const button =
  'rounded-sm border border-border px-3 py-1.5 text-sm text-normal hover:bg-secondary disabled:opacity-50';

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
        <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-3.5">
          {busy && !candidates && (
            <p className="text-sm text-low">
              {t('settings.plugins.import.loading')}
            </p>
          )}
          {candidates && candidates.length === 0 && (
            <p className="text-sm text-low">
              {t('settings.plugins.import.empty')}
            </p>
          )}
          {candidates && candidates.length > 0 && (
            <div className="space-y-2.5">
              <p className="text-sm font-medium text-high">
                {t('settings.plugins.import.pick')}
              </p>
              <SettingsCheckbox
                id="import-all"
                label={t('settings.plugins.import.all')}
                checked={
                  free.length > 0 &&
                  free.every((candidate) => selected.includes(candidate.name))
                }
                disabled={!free.length}
                onChange={(checked) =>
                  setSelected(
                    checked ? free.map((candidate) => candidate.name) : []
                  )
                }
              />
              {candidates.map((candidate) => (
                <SettingsCheckbox
                  key={candidate.name}
                  id={`import-${candidate.name}`}
                  label={`${candidate.name}${
                    candidate.exists
                      ? ` ${t('settings.plugins.import.exists')}`
                      : ''
                  }`}
                  description={candidate.sources
                    .map((source) => SOURCE_LABEL[source])
                    .join(', ')}
                  disabled={candidate.exists}
                  checked={selected.includes(candidate.name)}
                  onChange={(checked) =>
                    setSelected(
                      checked
                        ? [...selected, candidate.name]
                        : selected.filter((name) => name !== candidate.name)
                    )
                  }
                />
              ))}
              <div className="pt-1">
                <button
                  type="button"
                  className={button}
                  disabled={busy || !selected.length}
                  onClick={() => void doImport()}
                >
                  {t('settings.plugins.import.action')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
