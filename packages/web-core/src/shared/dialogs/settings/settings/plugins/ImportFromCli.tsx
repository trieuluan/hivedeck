import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
}: {
  notify: (notice: Notice) => void;
  onImported: () => Promise<void>;
}) {
  const { t } = useTranslation('settings');
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

  return (
    <details
      className="space-y-2"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
        else setCandidates(null);
      }}
    >
      <summary className="cursor-pointer text-sm text-low underline">
        {t('settings.plugins.import.link')}
      </summary>
      {busy && !candidates && (
        <p className="text-sm text-low">
          {t('settings.plugins.import.loading')}
        </p>
      )}
      {candidates && candidates.length === 0 && (
        <p className="text-sm text-low">{t('settings.plugins.import.empty')}</p>
      )}
      {candidates && candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-normal">
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
          <button
            type="button"
            className={button}
            disabled={busy || !selected.length}
            onClick={() => void doImport()}
          >
            {t('settings.plugins.import.action')}
          </button>
        </div>
      )}
    </details>
  );
}
