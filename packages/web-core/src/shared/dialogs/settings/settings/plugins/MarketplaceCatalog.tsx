import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react';
import { handleApiResponse } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { SettingsCard } from '../SettingsComponents';
import type { InstalledPlugin, PluginView } from 'shared/types';
import { PluginAvatar } from './PluginAvatar';

export type CatalogPlugin = {
  name: string;
  description: string;
  version: string | null;
  icon?: string | null;
  logo?: string | null;
  author?: string | null;
  source: unknown;
  marketplace: string;
  tags: string[];
  components: string[];
  install_source: string | null;
  install_commit: string | null;
};

type Catalog = { plugins: CatalogPlugin[]; warnings: string[] };

const actionButtonClass =
  'inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1 text-xs font-medium text-normal hover:bg-secondary hover:text-high disabled:opacity-50 transition-colors';

export function MarketplacePluginCard({
  plugin,
  installed,
  canInstall,
  components,
  expanded,
  onToggleDetails,
  onInstall,
}: {
  plugin: CatalogPlugin;
  installed: boolean;
  canInstall: boolean;
  components: string[];
  expanded: boolean;
  onToggleDetails: () => void;
  onInstall: () => void;
}) {
  const { t } = useTranslation('settings');
  const description = plugin.description.trim();
  const detailId =
    `marketplace-plugin-${plugin.marketplace}-${plugin.name}`.replace(
      /[^a-zA-Z0-9_-]/g,
      '-'
    );
  const subtitle = plugin.author
    ? t('settings.plugins.marketplace.byAuthor', { author: plugin.author })
    : plugin.marketplace;

  return (
    <article
      className={cn(
        'flex flex-col justify-between gap-2.5 rounded-md border border-border bg-secondary/20 p-3 transition-colors',
        'hover:bg-secondary/40',
        expanded && 'md:col-span-2 bg-secondary/35'
      )}
    >
      <div className="space-y-2.5">
        <div className="flex items-start gap-3">
          <PluginAvatar
            name={plugin.name}
            icon={plugin.icon}
            logo={plugin.logo}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-sm font-medium text-high">
                {plugin.name}
              </h4>
              {installed && (
                <CheckCircleIcon
                  className="h-3.5 w-3.5 shrink-0 text-success"
                  weight="fill"
                  aria-hidden="true"
                />
              )}
            </div>
            <p className="truncate text-xs text-low">{subtitle}</p>
          </div>
          {installed ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-success/25 bg-success/10 px-2 py-1 text-xs font-medium text-success">
              <CheckCircleIcon
                className="h-3.5 w-3.5"
                weight="fill"
                aria-hidden="true"
              />
              {t('settings.plugins.marketplace.installed')}
            </span>
          ) : (
            <button
              type="button"
              className={cn(
                actionButtonClass,
                'shrink-0 bg-panel hover:bg-secondary'
              )}
              disabled={!canInstall}
              onClick={onInstall}
            >
              <PlusIcon
                className="h-3.5 w-3.5"
                weight="bold"
                aria-hidden="true"
              />
              {t('settings.plugins.marketplace.install')}
            </button>
          )}
        </div>

        <p
          className={cn(
            'text-xs leading-relaxed',
            description ? 'text-normal' : 'italic text-low',
            !expanded && 'line-clamp-2'
          )}
        >
          {description || t('settings.plugins.marketplace.noDescription')}
        </p>
      </div>

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1 text-2xs">
            {components.length === 0 && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-low">
                {t('settings.plugins.marketplace.unknown')}
              </span>
            )}
            {components.map((component) => (
              <span
                key={component}
                className="rounded bg-secondary px-1.5 py-0.5 text-low"
              >
                {component}
                {component === 'hooks'
                  ? ` · ${t('settings.plugins.marketplace.claudeOnly')}`
                  : ['mcpServers', 'skills'].includes(component)
                    ? ` · ${t('settings.plugins.marketplace.allClis')}`
                    : ''}
              </span>
            ))}
          </div>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={onToggleDetails}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-low hover:text-high transition-colors"
          >
            {expanded
              ? t('settings.plugins.marketplace.hideDetails')
              : t('settings.plugins.marketplace.details')}
            <CaretDownIcon
              className={cn(
                'h-3 w-3 transition-transform',
                expanded && 'rotate-180'
              )}
              weight="bold"
              aria-hidden="true"
            />
          </button>
        </div>

        {expanded && (
          <div
            id={detailId}
            className="space-y-2.5 border-t border-border/70 pt-2.5"
          >
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 break-all text-xs text-low sm:grid-cols-[auto_1fr]">
              <dt className="font-medium text-normal">
                {t('settings.plugins.marketplace.source')}
              </dt>
              <dd>
                {typeof plugin.source === 'string'
                  ? plugin.source
                  : JSON.stringify(plugin.source)}
              </dd>
              <dt className="font-medium text-normal">
                {t('settings.plugins.marketplace.marketplaceLabel')}
              </dt>
              <dd>{plugin.marketplace}</dd>
              <dt className="font-medium text-normal">
                {t('settings.plugins.marketplace.version')}
              </dt>
              <dd>{plugin.version ?? '—'}</dd>
              {plugin.tags.length > 0 && (
                <>
                  <dt className="font-medium text-normal">
                    {t('settings.plugins.marketplace.tagsLabel')}
                  </dt>
                  <dd className="break-words">{plugin.tags.join(', ')}</dd>
                </>
              )}
            </dl>
            <div className="flex justify-end">
              <button
                type="button"
                className={actionButtonClass}
                disabled={!canInstall || installed}
                onClick={onInstall}
              >
                {installed
                  ? t('settings.plugins.marketplace.installed')
                  : t('settings.plugins.marketplace.install')}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export function MarketplaceCatalog({
  plugins,
  onInstall,
  previews,
}: {
  plugins: PluginView[] | null;
  onInstall: (source: string, commit: string | null, key: string) => void;
  previews: Record<string, InstalledPlugin>;
}) {
  const { t } = useTranslation('settings');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
    if (!term) return catalog?.plugins ?? [];
    return (catalog?.plugins ?? []).filter((plugin) =>
      [
        plugin.name,
        plugin.description,
        plugin.author ?? '',
        plugin.marketplace,
        ...plugin.tags,
      ].some((value) => value.toLocaleLowerCase().includes(term))
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
          className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-sm text-normal hover:bg-secondary disabled:opacity-50"
        >
          <ArrowsClockwiseIcon
            className={cn('h-3.5 w-3.5', loading && 'animate-spin')}
            aria-hidden="true"
          />
          {t('settings.plugins.marketplace.refresh')}
        </button>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-low"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            aria-label={t('settings.plugins.marketplace.search')}
            placeholder={t('settings.plugins.marketplace.search')}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(50);
            }}
            className="w-full rounded-sm border border-border bg-panel py-1.5 pl-8 pr-8 text-sm text-high placeholder:text-low focus:outline-none focus:ring-1 focus:ring-brand"
          />
          {query && (
            <button
              type="button"
              aria-label={t('settings.plugins.marketplace.clearSearch')}
              onClick={() => {
                setQuery('');
                setLimit(50);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-low hover:text-high"
            >
              <XIcon className="h-3.5 w-3.5" weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>
        {catalog && (
          <span
            className="shrink-0 rounded-sm bg-secondary px-2 py-1 text-xs text-low"
            aria-live="polite"
          >
            {t('settings.plugins.marketplace.count', {
              count: filtered.length,
            })}
          </span>
        )}
      </div>

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
      {catalog && filtered.length === 0 && (
        <p className="rounded-sm border border-dashed border-border p-4 text-center text-sm text-low">
          {t('settings.plugins.marketplace.empty')}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {filtered.slice(0, limit).map((plugin, index) => {
          const key = `${plugin.marketplace}:${plugin.name}`;
          const rowKey = `${key}:${index}`;
          const preview = previews[key];
          const installedPlugin = plugins?.find(
            (item) => item.name === (preview?.name ?? plugin.name)
          );
          const installed = !!installedPlugin;
          const actual = preview ?? installedPlugin;
          const components = actual
            ? [
                ...(actual.mcp.length ? ['mcpServers'] : []),
                ...(actual.skills.length ? ['skills'] : []),
                ...actual.unsupported,
              ]
            : plugin.components;
          return (
            <MarketplacePluginCard
              key={rowKey}
              plugin={plugin}
              installed={installed}
              canInstall={Boolean(plugin.install_source && plugins)}
              components={components}
              expanded={expandedKey === rowKey}
              onToggleDetails={() =>
                setExpandedKey((current) =>
                  current === rowKey ? null : rowKey
                )
              }
              onInstall={() =>
                plugin.install_source &&
                onInstall(plugin.install_source, plugin.install_commit, key)
              }
            />
          );
        })}
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
