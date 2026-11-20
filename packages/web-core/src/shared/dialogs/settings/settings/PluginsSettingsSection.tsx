import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SpinnerIcon } from '@phosphor-icons/react';
import type { InstalledPlugin, PluginView } from 'shared/types';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { Switch } from '@vibe/ui/components/Switch';
import { SettingsCard } from './SettingsComponents';
import { AddPluginDialog } from './plugins/AddPluginDialog';
import { ImportFromCli } from './plugins/ImportFromCli';
import { PluginDetail } from './plugins/PluginDetail';
import { errorText, useNotice } from './plugins/pluginNotice';
import { pluginsApi } from './plugins/pluginsApi';
import { MarketplaceCatalog } from './plugins/MarketplaceCatalog';

const button =
  'rounded-sm border border-border px-3 py-1.5 text-sm text-normal hover:bg-secondary disabled:opacity-50';

export function PluginsSettingsSection() {
  const { t } = useTranslation('settings');
  const [plugins, setPlugins] = useState<PluginView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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

  return (
    <div>
      <SettingsCard
        title={t('settings.plugins.title')}
        description={t('settings.plugins.intro')}
        headerAction={
          <button
            ref={addButton}
            type="button"
            className={button}
            onClick={() => setAdding(true)}
          >
            {t('settings.plugins.add')}
          </button>
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
          <div className="rounded-sm border border-dashed border-border p-4 text-center">
            <p className="text-sm text-normal">{t('settings.plugins.empty')}</p>
            <p className="text-xs text-low">
              {t('settings.plugins.emptyHint')}
            </p>
          </div>
        )}
        {plugins?.map((plugin) => {
          const expanded = open === plugin.name;
          const detailId = `plugin-detail-${plugin.name}`;
          return (
            <div
              key={plugin.name}
              className="min-w-0 space-y-2 rounded-sm border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <strong className="text-sm text-high break-all">
                    {plugin.name}
                  </strong>{' '}
                  <span className="text-xs text-low">
                    {t('settings.plugins.version', { version: plugin.version })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-low">
                    {plugin.enabled
                      ? t('settings.plugins.enabled')
                      : t('settings.plugins.disabled')}
                  </span>
                  <Switch
                    checked={plugin.enabled}
                    disabled={busy === plugin.name}
                    aria-label={t('settings.plugins.toggleAria', {
                      name: plugin.name,
                    })}
                    onCheckedChange={(enabled) => void toggle(plugin, enabled)}
                  />
                </div>
              </div>
              <p className="text-sm text-low">
                {t('settings.plugins.summary', {
                  mcp: plugin.mcp.length,
                  skills: plugin.skills.length,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={button}
                  aria-expanded={expanded}
                  aria-controls={detailId}
                  onClick={() => setOpen(expanded ? null : plugin.name)}
                >
                  {t('settings.plugins.details')}
                </button>
                {latest[plugin.name] && (
                  <button
                    type="button"
                    className={button}
                    disabled={busy === plugin.name}
                    title={t('settings.plugins.upgradeHint', {
                      tag: latest[plugin.name],
                    })}
                    onClick={() => void upgrade(plugin, latest[plugin.name]!)}
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
              {expanded && (
                <div id={detailId}>
                  <PluginDetail
                    plugin={plugin}
                    onChanged={reload}
                    notify={notify}
                  />
                </div>
              )}
            </div>
          );
        })}
        <ImportFromCli notify={notify} onImported={reload} />
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
    </div>
  );
}
