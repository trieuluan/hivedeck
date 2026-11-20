import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CodeIcon,
  CubeIcon,
  DatabaseIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  PaletteIcon,
  PlusIcon,
  PulseIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  StackIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react';
import { handleApiResponse } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { SettingsCard } from '../SettingsComponents';
import type { InstalledPlugin, PluginView } from 'shared/types';
import { PluginAvatar, resolvePluginSourceOwner } from './PluginAvatar';

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

const installButtonClass =
  'inline-flex shrink-0 items-center gap-1 rounded-sm border border-brand/50 bg-brand/[0.08] px-2.5 py-1 text-xs font-medium text-brand hover:border-brand hover:bg-brand/15 disabled:opacity-50 transition-colors';

type CategoryMeta = {
  id: string;
  label: string;
  icon: Icon;
  badgeClass: string;
};

const CATEGORY_DEFINITIONS: CategoryMeta[] = [
  {
    id: 'development',
    label: 'DevTools',
    icon: CodeIcon,
    badgeClass:
      'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  {
    id: 'productivity',
    label: 'Productivity',
    icon: LightningIcon,
    badgeClass: 'border-brand/25 bg-brand/10 text-brand',
  },
  {
    id: 'database',
    label: 'Database',
    icon: DatabaseIcon,
    badgeClass:
      'border-cyan-500/25 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  },
  {
    id: 'security',
    label: 'Security',
    icon: ShieldCheckIcon,
    badgeClass:
      'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'design',
    label: 'Design',
    icon: PaletteIcon,
    badgeClass:
      'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    icon: PulseIcon,
    badgeClass:
      'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
  {
    id: 'deployment',
    label: 'Deploy',
    icon: RocketLaunchIcon,
    badgeClass:
      'border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
];

const CATEGORY_MAP = new Map<string, CategoryMeta>(
  CATEGORY_DEFINITIONS.map((cat) => [cat.id, cat])
);

function renderCategoryPill(tag: string) {
  const normalized = tag.trim().toLowerCase();
  const meta = CATEGORY_MAP.get(normalized);
  if (meta) {
    const TagIcon = meta.icon;
    return (
      <span
        key={`tag-${tag}`}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium',
          meta.badgeClass
        )}
      >
        <TagIcon className="h-3 w-3 shrink-0" weight="duotone" aria-hidden />
        {meta.label}
      </span>
    );
  }
  return (
    <span
      key={`tag-${tag}`}
      className="inline-flex items-center rounded-full border border-border bg-secondary/70 px-2 py-0.5 text-2xs text-low"
    >
      {tag}
    </span>
  );
}

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
  const sourceOwner = resolvePluginSourceOwner(
    plugin.name,
    plugin.source,
    plugin.install_source
  );
  const subtitle = plugin.author
    ? t('settings.plugins.marketplace.byAuthor', { author: plugin.author })
    : (sourceOwner ?? plugin.marketplace);

  return (
    <article
      className={cn(
        'flex flex-col justify-between gap-3 rounded-md border border-border bg-secondary/20 p-3.5 transition-all',
        'hover:border-border/90 hover:bg-secondary/35',
        expanded && 'md:col-span-2 bg-secondary/35'
      )}
    >
      <div className="space-y-2.5">
        <div className="flex items-start gap-3">
          <PluginAvatar
            name={plugin.name}
            icon={plugin.icon}
            logo={plugin.logo}
            source={plugin.source}
            installSource={plugin.install_source}
            size="md"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-sm font-semibold text-high">
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
            <div>
              <span
                title={plugin.marketplace}
                className="inline-flex max-w-full items-center truncate rounded bg-secondary/80 px-1.5 py-0.5 text-2xs font-medium text-low"
              >
                {subtitle}
              </span>
              {!plugin.author &&
                sourceOwner &&
                sourceOwner !== plugin.marketplace && (
                  <span className="sr-only">{plugin.marketplace}</span>
                )}
            </div>
          </div>
          {installed ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
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
              className={installButtonClass}
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
          <div className="flex flex-wrap items-center gap-1.5 text-2xs">
            {plugin.tags.slice(0, 2).map(renderCategoryPill)}
            {components.length === 0 && (
              <span
                className={
                  plugin.tags.length === 0
                    ? 'inline-flex items-center rounded-full border border-border bg-secondary/70 px-2 py-0.5 text-low'
                    : 'sr-only'
                }
              >
                {t('settings.plugins.marketplace.unknown')}
              </span>
            )}
            {components.map((component) => {
              const isMcp = component === 'mcpServers';
              const isSkills = component === 'skills';
              return (
                <span
                  key={component}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium',
                    isMcp
                      ? 'border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                      : isSkills
                        ? 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                        : 'border-border bg-secondary text-low'
                  )}
                >
                  {isMcp && (
                    <CubeIcon
                      className="h-3 w-3 shrink-0"
                      weight="duotone"
                      aria-hidden
                    />
                  )}
                  {isSkills && (
                    <StackIcon
                      className="h-3 w-3 shrink-0"
                      weight="duotone"
                      aria-hidden
                    />
                  )}
                  {isMcp ? 'MCP' : isSkills ? 'Skills' : component}
                  {component === 'hooks'
                    ? ` · ${t('settings.plugins.marketplace.claudeOnly')}`
                    : ['mcpServers', 'skills'].includes(component)
                      ? ` · ${t('settings.plugins.marketplace.allClis')}`
                      : ''}
                </span>
              );
            })}
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
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
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

  const availableCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plugin of catalog?.plugins ?? []) {
      for (const tag of plugin.tags) {
        const normalized = tag.trim().toLowerCase();
        if (CATEGORY_MAP.has(normalized)) {
          counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
        }
      }
    }
    return CATEGORY_DEFINITIONS.filter((cat) => (counts.get(cat.id) ?? 0) > 0);
  }, [catalog]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return (catalog?.plugins ?? []).filter((plugin) => {
      if (
        selectedCategory !== 'all' &&
        !plugin.tags.some(
          (tag) => tag.trim().toLocaleLowerCase() === selectedCategory
        )
      ) {
        return false;
      }
      if (!term) return true;
      return [
        plugin.name,
        plugin.description,
        plugin.author ?? '',
        plugin.marketplace,
        ...plugin.tags,
      ].some((value) => value.toLocaleLowerCase().includes(term));
    });
  }, [catalog, query, selectedCategory]);

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
      <div className="space-y-2.5">
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
                <XIcon
                  className="h-3.5 w-3.5"
                  weight="bold"
                  aria-hidden="true"
                />
              </button>
            )}
          </div>
          {catalog && (
            <span
              className="shrink-0 rounded-sm border border-border bg-secondary/60 px-2.5 py-1.5 text-xs font-medium text-low"
              aria-live="polite"
            >
              {t('settings.plugins.marketplace.count', {
                count: filtered.length,
              })}
            </span>
          )}
        </div>

        {availableCategories.length > 0 && (
          <div
            role="tablist"
            aria-label="Filter plugins by category"
            className="flex flex-wrap items-center gap-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === 'all'}
              onClick={() => {
                setSelectedCategory('all');
                setLimit(50);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                selectedCategory === 'all'
                  ? 'border-brand bg-brand/15 text-brand'
                  : 'border-border bg-secondary/30 text-low hover:bg-secondary hover:text-normal'
              )}
            >
              {t('settings.plugins.marketplace.categoryAll', {
                defaultValue: 'Tất cả',
              })}
            </button>
            {availableCategories.map((cat) => {
              const CatIcon = cat.icon;
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setSelectedCategory(isSelected ? 'all' : cat.id);
                    setLimit(50);
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    isSelected
                      ? 'border-brand bg-brand/15 text-brand'
                      : 'border-border bg-secondary/30 text-low hover:bg-secondary hover:text-normal'
                  )}
                >
                  <CatIcon
                    className="h-3.5 w-3.5 shrink-0"
                    weight="duotone"
                    aria-hidden
                  />
                  {cat.label}
                </button>
              );
            })}
          </div>
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
