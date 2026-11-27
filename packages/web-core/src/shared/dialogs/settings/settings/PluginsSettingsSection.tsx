import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  PlusIcon,
  SpinnerIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import type {
  ExecutorCompatibility,
  InstalledPlugin,
  PluginView,
} from 'shared/types';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { Switch } from '@vibe/ui/components/Switch';
import { SettingsCard } from './SettingsComponents';
import { AddPluginDialog } from './plugins/AddPluginDialog';
import { ImportFromCli } from './plugins/ImportFromCli';
import { PluginDetail } from './plugins/PluginDetail';
import { errorText, useNotice } from './plugins/pluginNotice';
import { pluginsApi } from './plugins/pluginsApi';
import { MarketplaceCatalog } from './plugins/MarketplaceCatalog';
import { PluginAvatar } from './plugins/PluginAvatar';
import { launchMcpOAuthFlow } from './plugins/mcpOAuthPopup';

const button =
  'inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-sm text-normal hover:bg-secondary disabled:opacity-50 transition-colors';

const primaryBrandButton =
  'inline-flex items-center gap-1.5 rounded-sm bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-brand/90 disabled:opacity-50 transition-colors';

const secondaryButton =
  'inline-flex items-center gap-1.5 rounded-sm border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium text-normal hover:bg-secondary hover:text-high disabled:opacity-50 transition-colors';

function EmptyPluginsIllustration() {
  return (
    <svg
      viewBox="0 0 136 96"
      fill="none"
      aria-hidden="true"
      className="h-24 w-32 shrink-0 select-none"
    >
      {/* Background subtle hexagons */}
      <polygon
        points="40,12 56,21 56,39 40,48 24,39 24,21"
        stroke="currentColor"
        strokeWidth="1"
        className="text-border"
        fill="currentColor"
        fillOpacity="0.06"
      />
      <polygon
        points="24,42 40,51 40,69 24,78 8,69 8,51"
        stroke="currentColor"
        strokeWidth="1"
        className="text-border"
        fill="currentColor"
        fillOpacity="0.08"
      />
      <polygon
        points="96,46 112,55 112,73 96,82 80,73 80,55"
        stroke="currentColor"
        strokeWidth="1"
        className="text-border"
        fill="currentColor"
        fillOpacity="0.06"
      />
      {/* Glowing accent dots */}
      <circle cx="92" cy="24" r="1.5" className="fill-brand/70" />
      <circle cx="98" cy="20" r="1" className="fill-brand/50" />
      <circle cx="98" cy="28" r="1" className="fill-brand/50" />
      <circle cx="44" cy="76" r="1.5" className="fill-brand/70" />
      <circle cx="38" cy="80" r="1" className="fill-brand/50" />
      {/* Center glowing orange hexagon */}
      <polygon
        points="68,20 92,34 92,62 68,76 44,62 44,34"
        className="fill-brand/10 stroke-brand"
        strokeWidth="1.75"
      />
      {/* Plug icon inside center hexagon */}
      <path
        d="M63 34V42M73 34V42M58 42H78V49C78 54.5228 73.5228 59 68 59C62.4772 59 58 54.5228 58 49V42ZM68 59V66"
        className="stroke-brand"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PluginsSettingsSection() {
  const { t } = useTranslation('settings');
  const [plugins, setPlugins] = useState<PluginView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [compatibility, setCompatibility] = useState<
    ExecutorCompatibility[] | null
  >(null);
  const [compatibilityError, setCompatibilityError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importingFromCli, setImportingFromCli] = useState(false);
  const [marketplace, setMarketplace] = useState<{
    source: string;
    commit: string | null;
    key: string;
  } | null>(null);
  const [previews, setPreviews] = useState<Record<string, InstalledPlugin>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [latest, setLatest] = useState<Record<string, string>>({});
  const [notice, notify] = useNotice();
  const addButton = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    setPlugins(await pluginsApi.list());
  }, []);

  useEffect(() => {
    reload().catch(() => setLoadError(true));
    pluginsApi
      .compatibility()
      .then(setCompatibility)
      .catch(() => setCompatibilityError(true));
  }, [reload]);

  useEffect(() => {
    if (!plugins) return;
    let alive = true;
    for (const plugin of plugins) {
      if (!plugin.tag) continue;
      void pluginsApi
        .latestTag(plugin.name)
        .then((tag) => {
          if (alive && tag && tag !== plugin.tag)
            setLatest((prev) => ({ ...prev, [plugin.name]: tag }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [plugins]);

  const run = async (
    name: string,
    action: () => Promise<string>
  ): Promise<void> => {
    setBusy(name);
    try {
      const text = await action();
      await reload();
      notify({ kind: 'ok', text });
    } catch (reason) {
      notify({ kind: 'error', text: errorText(reason) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (plugin: PluginView) => {
    const result = await ConfirmDialog.show({
      title: t('settings.plugins.removeTitle'),
      message: t('settings.plugins.removeConfirm', { name: plugin.name }),
      confirmText: t('settings.plugins.removeAction'),
      variant: 'destructive',
    });
    if (result !== 'confirmed') return;
    await run(plugin.name, async () => {
      await pluginsApi.remove(plugin.name);
      setOpen(null);
      return t('settings.plugins.notice.removed', { name: plugin.name });
    });
  };

  const toggle = (plugin: PluginView, enabled: boolean) =>
    run(plugin.name, async () => {
      await pluginsApi.setEnabled(plugin.name, enabled);
      return t(
        enabled
          ? 'settings.plugins.notice.enabled'
          : 'settings.plugins.notice.disabled',
        { name: plugin.name }
      );
    });

  const upgrade = (plugin: PluginView, tag: string) =>
    run(plugin.name, async () => {
      const next = await pluginsApi.upgrade(plugin.name, { tag });
      setLatest((prev) => {
        const rest = { ...prev };
        delete rest[plugin.name];
        return rest;
      });
      return t('settings.plugins.notice.upgraded', {
        name: plugin.name,
        version: next.version,
      });
    });

  const installedCount = plugins?.length ?? 0;
  const selectedPlugin = open
    ? (plugins?.find((p) => p.name === open) ?? null)
    : null;

  if (selectedPlugin) {
    return (
      <div className="space-y-4 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-panel px-2.5 py-1.5 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high"
            >
              <ArrowLeftIcon
                className="h-3.5 w-3.5"
                weight="bold"
                aria-hidden
              />
              Quay lại
            </button>
            <PluginAvatar
              name={selectedPlugin.name}
              source={selectedPlugin.source}
              size="md"
              priority
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-high">
                  {selectedPlugin.name}
                </span>
                <span className="rounded bg-secondary px-1.5 py-0.5 text-2xs text-low">
                  {selectedPlugin.source === 'mcp-single'
                    ? selectedPlugin.mcp[0]?.transport === 'http'
                      ? 'http · mcp'
                      : 'stdio · mcp'
                    : t('settings.plugins.version', {
                        version: selectedPlugin.version,
                      })}
                </span>
                <span
                  className={
                    selectedPlugin.enabled
                      ? 'rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-2xs font-medium text-success'
                      : 'rounded border border-border bg-secondary px-1.5 py-0.5 text-2xs text-low'
                  }
                >
                  {selectedPlugin.enabled ? 'Đang bật' : 'Đã tắt'}
                </span>
              </div>
              <div className="text-2xs text-low">
                {selectedPlugin.mcp.length} MCP · {selectedPlugin.skills.length}{' '}
                skill
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={selectedPlugin.enabled}
              disabled={busy === selectedPlugin.name}
              aria-label={t('settings.plugins.toggleAria', {
                name: selectedPlugin.name,
              })}
              onCheckedChange={(enabled) =>
                void toggle(selectedPlugin, enabled)
              }
            />
            {latest[selectedPlugin.name] && (
              <button
                type="button"
                className="rounded-sm border border-border px-2.5 py-1 text-xs font-medium text-normal hover:bg-secondary disabled:opacity-50"
                disabled={busy === selectedPlugin.name}
                onClick={() =>
                  void upgrade(selectedPlugin, latest[selectedPlugin.name]!)
                }
              >
                {t('settings.plugins.upgrade', {
                  tag: latest[selectedPlugin.name],
                })}
              </button>
            )}
            <button
              type="button"
              className={button}
              disabled={busy === selectedPlugin.name}
              onClick={() => void remove(selectedPlugin)}
            >
              {t('settings.plugins.remove')}
            </button>
          </div>
        </div>

        {notice && (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={
              notice.kind === 'error'
                ? 'text-sm text-error break-words'
                : 'text-sm text-normal break-words'
            }
          >
            {notice.text}
          </p>
        )}

        <PluginDetail
          plugin={selectedPlugin}
          onChanged={reload}
          notify={notify}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      <SettingsCard
        title={`${t('settings.plugins.installedTitle', {
          defaultValue: 'Đã cài đặt',
        })} (${installedCount})`}
        description={t('settings.plugins.intro')}
        headerAction={
          plugins && plugins.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setImportingFromCli((prev) => !prev)}
              >
                <DownloadSimpleIcon
                  className="h-3.5 w-3.5"
                  weight="bold"
                  aria-hidden
                />
                {t('settings.plugins.import.link')}
              </button>
              <button
                ref={addButton}
                type="button"
                className={primaryBrandButton}
                onClick={() => setAdding(true)}
              >
                <PlusIcon className="h-3.5 w-3.5" weight="bold" aria-hidden />
                {t('settings.plugins.add')}
              </button>
            </div>
          ) : undefined
        }
      >
        {notice && (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={
              notice.kind === 'error'
                ? 'text-sm text-error break-words'
                : 'text-sm text-normal break-words'
            }
          >
            {notice.text}
          </p>
        )}
        {loadError && (
          <p role="alert" className="text-sm text-error">
            {t('settings.plugins.loadError')}
          </p>
        )}
        {!plugins && !loadError && (
          <p className="flex items-center gap-2 text-sm text-low">
            <SpinnerIcon className="h-4 w-4 animate-spin" aria-hidden />
            {t('settings.plugins.loading')}
          </p>
        )}
        {plugins?.length === 0 && (
          <div className="flex flex-col items-center gap-4 rounded-md border border-border bg-secondary/20 px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
            <EmptyPluginsIllustration />
            <div
              aria-hidden="true"
              className="hidden h-20 w-px shrink-0 bg-border/70 sm:block"
            />
            <div className="min-w-0 flex-1 space-y-2.5 text-center sm:text-left">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-high">
                  {t('settings.plugins.empty')}
                </p>
                <p className="text-xs leading-relaxed text-low">
                  {t('settings.plugins.emptyHint')}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
                <button
                  ref={addButton}
                  type="button"
                  className={primaryBrandButton}
                  onClick={() => setAdding(true)}
                >
                  <PlusIcon className="h-3.5 w-3.5" weight="bold" aria-hidden />
                  {t('settings.plugins.add')}
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => setImportingFromCli((prev) => !prev)}
                >
                  <DownloadSimpleIcon
                    className="h-3.5 w-3.5"
                    weight="bold"
                    aria-hidden
                  />
                  {t('settings.plugins.import.link')}
                </button>
              </div>
            </div>
          </div>
        )}
        {plugins && plugins.length > 0 && (
          <div className="divide-y divide-border rounded-md border border-border bg-secondary/15">
            {plugins.map((plugin) => {
              const oauthMcps = plugin.mcp.filter((m) => m.oauth);
              const pendingOAuthMcp = oauthMcps.find(
                (m) =>
                  !plugin.oauth_status?.some(
                    (status) => status.mcp === m.name && status.connected
                  )
              );
              const allOAuthConnected =
                oauthMcps.length > 0 && !pendingOAuthMcp;
              const isSingleMcp =
                plugin.source === 'mcp-single' && plugin.mcp.length === 1;
              return (
                <div key={plugin.name} className="min-w-0 space-y-2.5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <PluginAvatar
                        name={plugin.name}
                        source={plugin.source}
                        size="sm"
                        priority
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <strong className="truncate text-sm font-medium text-high">
                            {plugin.name}
                          </strong>
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-2xs text-low">
                            {isSingleMcp
                              ? `${plugin.mcp[0]!.transport} · mcp`
                              : t('settings.plugins.version', {
                                  version: plugin.version,
                                })}
                          </span>
                          <span
                            className={
                              plugin.enabled
                                ? 'inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-2xs font-medium text-success'
                                : 'inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-2xs text-low'
                            }
                          >
                            {plugin.enabled
                              ? t('settings.plugins.enabled')
                              : t('settings.plugins.disabled')}
                          </span>
                          {allOAuthConnected && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-2xs font-medium text-success">
                              <span
                                aria-hidden="true"
                                className="h-1.5 w-1.5 rounded-full bg-success"
                              />
                              Đã kết nối OAuth · Tự động cấp cho 9 CLI
                            </span>
                          )}
                          {pendingOAuthMcp && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-2xs font-medium text-amber-500">
                              <WarningIcon
                                className="h-3 w-3 shrink-0"
                                weight="fill"
                                aria-hidden
                              />
                              Cần xác thực OAuth
                            </span>
                          )}
                        </div>
                        {!isSingleMcp && (
                          <p className="mt-0.5 truncate text-xs text-low">
                            {t('settings.plugins.summary', {
                              mcp: plugin.mcp.length,
                              skills: plugin.skills.length,
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {pendingOAuthMcp && (
                        <button
                          type="button"
                          disabled={busy === plugin.name}
                          onClick={() => {
                            setBusy(plugin.name);
                            void launchMcpOAuthFlow({
                              pluginName: plugin.name,
                              mcpName: pendingOAuthMcp.name,
                              onComplete: async () => {
                                await reload();
                                setBusy(null);
                                notify({
                                  kind: 'ok',
                                  text: `Đã kết nối OAuth thành công cho ${pendingOAuthMcp.name}.`,
                                });
                              },
                              onError: (reason) => {
                                setBusy(null);
                                notify({
                                  kind: 'error',
                                  text: errorText(reason),
                                });
                              },
                            });
                          }}
                          className={primaryBrandButton}
                        >
                          Đăng nhập OAuth
                          <ArrowSquareOutIcon
                            className="h-3.5 w-3.5"
                            weight="bold"
                            aria-hidden
                          />
                        </button>
                      )}
                      <Switch
                        checked={plugin.enabled}
                        disabled={busy === plugin.name}
                        aria-label={t('settings.plugins.toggleAria', {
                          name: plugin.name,
                        })}
                        onCheckedChange={(enabled) =>
                          void toggle(plugin, enabled)
                        }
                      />
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm border border-border px-2.5 py-1 text-xs font-medium text-normal hover:bg-secondary disabled:opacity-50"
                        onClick={() => setOpen(plugin.name)}
                      >
                        {t('settings.plugins.details')}
                        <ArrowRightIcon
                          className="h-3 w-3"
                          weight="bold"
                          aria-hidden="true"
                        />
                      </button>
                      {latest[plugin.name] && (
                        <button
                          type="button"
                          className="rounded-sm border border-border px-2.5 py-1 text-xs font-medium text-normal hover:bg-secondary disabled:opacity-50"
                          disabled={busy === plugin.name}
                          title={t('settings.plugins.upgradeHint', {
                            tag: latest[plugin.name],
                          })}
                          onClick={() =>
                            void upgrade(plugin, latest[plugin.name]!)
                          }
                        >
                          {t('settings.plugins.upgrade', {
                            tag: latest[plugin.name],
                          })}
                        </button>
                      )}
                      <button
                        type="button"
                        className={button}
                        disabled={busy === plugin.name}
                        onClick={() => void remove(plugin)}
                      >
                        {t('settings.plugins.remove')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <ImportFromCli
          notify={notify}
          onImported={reload}
          open={importingFromCli}
          onOpenChange={setImportingFromCli}
          hideTrigger
        />
        <AddPluginDialog
          open={adding}
          initialSource={marketplace?.source}
          initialCommit={marketplace?.commit ?? undefined}
          onPreview={(preview) =>
            marketplace &&
            setPreviews((previous) => ({
              ...previous,
              [marketplace.key]: preview,
            }))
          }
          onClose={() => {
            setAdding(false);
            setMarketplace(null);
            requestAnimationFrame(() => addButton.current?.focus());
          }}
          onInstalled={(installed) => {
            setAdding(false);
            setMarketplace(null);
            void reload();
            notify({
              kind: 'ok',
              text: t('settings.plugins.notice.installed', {
                name: installed.name,
              }),
            });
          }}
        />
      </SettingsCard>
      <MarketplaceCatalog
        plugins={plugins}
        previews={previews}
        onInstall={(source, commit, key) => {
          setMarketplace({ source, commit, key });
          setAdding(true);
        }}
      />
      <SettingsCard title={t('settings.plugins.compatibility.title')}>
        {compatibilityError && (
          <p role="alert" className="text-sm text-error">
            {t('settings.plugins.compatibility.error')}
          </p>
        )}
        {compatibility && (
          <div className="overflow-x-auto rounded-md border border-border bg-secondary/15">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/40 text-2xs uppercase tracking-wider text-low">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Executor
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    MCP
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Skills
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {compatibility.map((row) => (
                  <tr
                    key={row.executor}
                    className="transition-colors hover:bg-secondary/25"
                  >
                    <th
                      scope="row"
                      className="px-3 py-2.5 font-mono text-xs font-medium text-high"
                    >
                      {row.executor}
                    </th>
                    <td className="px-3 py-2.5">
                      <span
                        className={
                          row.mcp === 'supported'
                            ? 'inline-flex items-center rounded bg-success/10 px-1.5 py-0.5 text-2xs font-medium text-success'
                            : 'inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-2xs text-low'
                        }
                      >
                        {t(`settings.plugins.compatibility.${row.mcp}`)}
                      </span>
                      <div className="mt-0.5 font-mono text-2xs text-low">
                        {row.mcp_mechanism}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={
                          row.skills === 'supported'
                            ? 'inline-flex items-center rounded bg-success/10 px-1.5 py-0.5 text-2xs font-medium text-success'
                            : row.skills === 'prompt_catalog'
                              ? 'inline-flex items-center rounded bg-brand/15 px-1.5 py-0.5 text-2xs font-medium text-brand'
                              : 'inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-2xs text-low'
                        }
                      >
                        {t(`settings.plugins.compatibility.${row.skills}`)}
                      </span>
                      <div className="mt-0.5 font-mono text-2xs text-low">
                        {row.skills_mechanism}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsCard>
    </div>
  );
}
