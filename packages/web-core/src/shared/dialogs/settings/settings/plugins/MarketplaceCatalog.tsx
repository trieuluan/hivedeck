import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { handleApiResponse } from '@/shared/lib/api';
import { SettingsCard } from '../SettingsComponents';

type CatalogPlugin = {
  name: string;
  description: string;
  version: string | null;
  source: unknown;
  marketplace: string;
  tags: string[];
  components: string[];
};

type Catalog = { plugins: CatalogPlugin[]; warnings: string[] };

export function MarketplaceCatalog() {
  const { t } = useTranslation('settings');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);

  const load = useCallback(async (refresh: boolean, signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/agent-extensions/marketplace${refresh ? '?refresh=true' : ''}`,
        { signal }
      );
      const data = await handleApiResponse<Catalog>(response);
      if (!signal?.aborted) setCatalog(data);
    } catch {
      if (!signal?.aborted) setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return (catalog?.plugins ?? []).filter((plugin) =>
      [plugin.name, plugin.description, ...plugin.tags].some((value) =>
        value.toLocaleLowerCase().includes(term)
      )
    );
  }, [catalog, query]);

  return (
    <SettingsCard
      title={t('settings.plugins.marketplace.title')}
      description={t('settings.plugins.marketplace.description')}
      headerAction={
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="rounded-sm border border-border px-3 py-1.5 text-sm text-normal hover:bg-secondary disabled:opacity-50"
        >
          {t('settings.plugins.marketplace.refresh')}
        </button>
      }
    >
      <label className="block text-sm text-normal">
        {t('settings.plugins.marketplace.search')}
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(50);
          }}
          className="mt-1 w-full rounded-sm border border-border bg-panel px-3 py-2 text-sm text-high"
        />
      </label>
      {loading && (
        <p role="status" className="text-sm text-low">
          {t('settings.plugins.marketplace.loading')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {t('settings.plugins.marketplace.error')}
        </p>
      )}
      {catalog?.warnings.map((warning) => (
        <p key={warning} role="status" className="text-sm text-error">
          {warning}
        </p>
      ))}
      {catalog && (
        <p className="text-xs text-low" aria-live="polite">
          {t('settings.plugins.marketplace.count', { count: filtered.length })}
        </p>
      )}
      {catalog && filtered.length === 0 && (
        <p className="text-sm text-low">
          {t('settings.plugins.marketplace.empty')}
        </p>
      )}
      <div className="space-y-2">
        {filtered.slice(0, limit).map((plugin, index) => (
          <details
            key={`${plugin.marketplace}:${plugin.name}:${index}`}
            className="rounded-sm border border-border p-3"
          >
            <summary className="cursor-pointer text-sm font-medium text-high">
              {plugin.name}
              <span className="mt-1 block text-sm font-normal text-low">
                {plugin.description}
              </span>
              <span className="mt-2 flex flex-wrap gap-1 text-xs font-normal">
              {plugin.components.length === 0 && (
                <span className="rounded-sm bg-secondary px-2 py-1">
                  {t('settings.plugins.marketplace.unknown')}
                </span>
              )}
              {plugin.components.map((component) => (
                <span
                  key={component}
                  className="rounded-sm bg-secondary px-2 py-1"
                >
                  {component}
                  {component === 'hooks'
                    ? ` · ${t('settings.plugins.marketplace.claudeOnly')}`
                    : ['mcpServers', 'skills'].includes(component)
                      ? ` · ${t('settings.plugins.marketplace.allClis')}`
                      : ''}
                </span>
              ))}
              </span>
            </summary>
            <dl className="mt-3 space-y-1 break-all text-xs text-low">
              <div>
                <dt className="inline font-medium">
                  {t('settings.plugins.marketplace.source')}:{' '}
                </dt>
                <dd className="inline">
                  {typeof plugin.source === 'string'
                    ? plugin.source
                    : JSON.stringify(plugin.source)}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">Marketplace: </dt>
                <dd className="inline">{plugin.marketplace}</dd>
              </div>
              <div>
                <dt className="inline font-medium">
                  {t('settings.plugins.marketplace.version')}:{' '}
                </dt>
                <dd className="inline">{plugin.version ?? '—'}</dd>
              </div>
              {plugin.tags.length > 0 && (
                <div>
                  <dt className="inline font-medium">Tags: </dt>
                  <dd className="inline">{plugin.tags.join(', ')}</dd>
                </div>
              )}
            </dl>
          </details>
        ))}
      </div>
      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit(limit + 50)}
          className="rounded-sm border border-border px-3 py-1.5 text-sm text-normal hover:bg-secondary"
        >
          {t('settings.plugins.marketplace.more')}
        </button>
      )}
    </SettingsCard>
  );
}
