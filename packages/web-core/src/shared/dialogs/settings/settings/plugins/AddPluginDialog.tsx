import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ConflictPolicy,
  InstalledPlugin,
  PluginConflict,
  PluginView,
} from 'shared/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { SettingsField, SettingsInput } from '../SettingsComponents';
import { PluginConflictError, pluginsApi } from './pluginsApi';
import { CompatBadge, mcpCompat } from './pluginCompat';
import { errorText } from './pluginNotice';

const button =
  'rounded-sm border border-border px-3 py-1.5 text-sm text-normal hover:bg-secondary disabled:opacity-50';
const primary =
  'rounded-sm bg-brand px-3 py-1.5 text-sm text-on-brand hover:bg-brand-hover disabled:opacity-50';

const isRemote = (source: string) =>
  /^(https?|ssh|git|file):\/\//.test(source) || source.startsWith('git@');

export function AddPluginDialog({
  open,
  onClose,
  onInstalled,
  initialSource,
  initialCommit,
  onPreview,
}: {
  open: boolean;
  onClose: () => void;
  onInstalled: (plugin: PluginView) => void;
  initialSource?: string;
  initialCommit?: string;
  onPreview?: (plugin: InstalledPlugin) => void;
}) {
  const { t } = useTranslation('settings');
  const [source, setSource] = useState('');
  const [kind, setKind] = useState<'repo' | 'http' | 'stdio'>('repo');
  const [name, setName] = useState('');
  const [args, setArgs] = useState('');
  const [secretNames, setSecretNames] = useState('');
  const [oauth, setOauth] = useState(false);
  const [tag, setTag] = useState('');
  const [commit, setCommit] = useState('');
  const [preview, setPreview] = useState<InstalledPlugin | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<PluginConflict[]>([]);
  const [busy, setBusy] = useState<'preview' | 'install' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && initialSource) {
      setSource(initialSource);
      setCommit(initialCommit ?? '');
    }
  }, [open, initialSource, initialCommit]);

  const reset = () => {
    setSource('');
    setKind('repo');
    setName('');
    setArgs('');
    setSecretNames('');
    setOauth(false);
    setTag('');
    setCommit('');
    setPreview(null);
    setSecrets({});
    setConflicts([]);
    setError('');
    setBusy(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const input = () => ({
    source,
    tag: kind === 'repo' ? tag : '',
    commit: kind === 'repo' ? commit : '',
    ...(kind === 'repo'
      ? {}
      : {
          singleMcp: {
            name: name.trim(),
            transport: kind,
            command: kind === 'stdio' ? source.trim() : null,
            args: kind === 'stdio' ? args.split('\n').filter(Boolean) : [],
            url: kind === 'http' ? source.trim() : null,
            headers:
              kind === 'http'
                ? Object.fromEntries(
                    secretNames
                      .split('\n')
                      .map((key, index) => [key.trim(), `SECRET_${index}`])
                      .filter(([key]) => key)
                  )
                : {},
            env:
              kind === 'stdio'
                ? Object.fromEntries(
                    secretNames
                      .split('\n')
                      .map((key, index) => [key.trim(), `SECRET_${index}`])
                      .filter(([key]) => key)
                  )
                : {},
            roles: ['crew'],
            boards: [],
            oauth,
            enabled: true,
          },
        }),
  });
  const needsPin =
    kind === 'repo' && isRemote(source.trim()) && !tag.trim() && !commit.trim();
  const dirty = () => {
    setPreview(null);
    setConflicts([]);
    setError('');
  };

  const runPreview = async () => {
    setBusy('preview');
    setError('');
    try {
      const result = await pluginsApi.preview(input());
      setPreview(result);
      onPreview?.(result);
      setSecrets({});
      setConflicts([]);
    } catch (reason) {
      setPreview(null);
      setError(errorText(reason));
    } finally {
      setBusy(null);
    }
  };

  const install = async (policy: ConflictPolicy) => {
    if (!preview) return;
    setBusy('install');
    setError('');
    const grouped: Record<string, Record<string, string>> = {};
    for (const [id, value] of Object.entries(secrets)) {
      if (!value) continue;
      const [mcp, ref] = id.split('/');
      (grouped[mcp!] ??= {})[ref!] = value;
    }
    try {
      const installed = await pluginsApi.install({
        ...input(),
        commit: source.startsWith('marketplace+')
          ? (preview.commit ?? '')
          : commit,
        conflictPolicy: policy,
        secrets: grouped,
      });
      reset();
      onInstalled(installed);
    } catch (reason) {
      if (reason instanceof PluginConflictError) setConflicts(reason.conflicts);
      else setError(errorText(reason));
    } finally {
      setBusy(null);
    }
  };

  const refsOf = (mcp: InstalledPlugin['mcp'][number]) => [
    ...new Set(
      [...Object.values(mcp.headers), ...Object.values(mcp.env)].filter(
        (ref): ref is string => !!ref
      )
    ),
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="min-w-0 max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('settings.plugins.addDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('settings.plugins.addDialog.description')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (source.trim() && !needsPin && !busy) void runPreview();
          }}
        >
          <label className="block text-sm text-normal">
            Preset
            <select
              aria-label="Preset"
              defaultValue=""
              onChange={(event) => {
                const preset = event.target.value;
                if (!preset) return;
                setName(preset);
                setKind(preset === 'context7' ? 'http' : 'stdio');
                setSource(
                  preset === 'context7' ? 'https://mcp.context7.com/mcp' : 'npx'
                );
                setArgs(
                  preset === 'playwright'
                    ? '@playwright/mcp@latest'
                    : preset === 'exa'
                      ? '-y\nexa-mcp-server\ntools=web_search_exa,get_code_context_exa'
                      : preset === 'chrome_devtools'
                        ? 'chrome-devtools-mcp@latest'
                        : preset === 'dev_manager'
                          ? 'dev-manager-mcp\nstdio'
                          : ''
                );
                setSecretNames(
                  preset === 'context7'
                    ? 'CONTEXT7_API_KEY'
                    : preset === 'exa'
                      ? 'EXA_API_KEY'
                      : ''
                );
                setOauth(false);
                dirty();
              }}
              className="ml-2 rounded-sm border border-border bg-secondary p-1"
            >
              <option value="">
                {t('settings.plugins.addDialog.presetPlaceholder')}
              </option>
              <option value="context7">Context7</option>
              <option value="playwright">Playwright</option>
              <option value="exa">Exa</option>
              <option value="chrome_devtools">Chrome DevTools</option>
              <option value="dev_manager">Dev Manager</option>
            </select>
          </label>
          <label className="block text-sm text-normal">
            {t('settings.plugins.addDialog.sourceKind')}
            <select
              aria-label={t('settings.plugins.addDialog.sourceKind')}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
                dirty();
              }}
              className="ml-2 rounded-sm border border-border bg-secondary p-1"
            >
              <option value="repo">Repository / plugin</option>
              <option value="http">URL MCP</option>
              <option value="stdio">Command MCP</option>
            </select>
          </label>
          <SettingsField label={t('settings.plugins.addDialog.source')}>
            <SettingsInput
              ariaLabel={t('settings.plugins.addDialog.source')}
              value={source}
              placeholder={t('settings.plugins.addDialog.sourcePlaceholder')}
              onChange={(value) => {
                setSource(value);
                if (kind === 'http') {
                  try {
                    const host = new URL(value).hostname.split('.');
                    setName(
                      host[0] === 'mcp' ? (host[1] ?? '') : (host[0] ?? '')
                    );
                  } catch {
                    setName('');
                  }
                }
                dirty();
              }}
            />
          </SettingsField>
          {kind !== 'repo' && (
            <>
              <SettingsField label={t('settings.plugins.addDialog.serverName')}>
                <SettingsInput
                  ariaLabel={t('settings.plugins.addDialog.serverName')}
                  value={name}
                  onChange={(value) => {
                    setName(value);
                    dirty();
                  }}
                />
              </SettingsField>
              {kind === 'stdio' && (
                <label className="block text-sm text-normal">
                  {t('settings.plugins.addDialog.arguments')}
                  <textarea
                    aria-label={t('settings.plugins.addDialog.arguments')}
                    className="block w-full border border-border bg-secondary"
                    value={args}
                    onChange={(event) => {
                      setArgs(event.target.value);
                      dirty();
                    }}
                  />
                </label>
              )}
              <label className="block text-sm text-normal">
                {kind === 'http' ? 'Header' : 'Environment'} —{' '}
                {t('settings.plugins.addDialog.secretNames')}
                <textarea
                  aria-label={kind === 'http' ? 'Header' : 'Environment'}
                  className="block w-full border border-border bg-secondary"
                  value={secretNames}
                  onChange={(event) => {
                    setSecretNames(event.target.value);
                    dirty();
                  }}
                />
              </label>
              {kind === 'http' && (
                <label className="block text-sm text-normal">
                  <input
                    type="checkbox"
                    checked={oauth}
                    onChange={(event) => {
                      setOauth(event.target.checked);
                      dirty();
                    }}
                  />{' '}
                  OAuth
                </label>
              )}
            </>
          )}
          {kind === 'repo' && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SettingsField label={t('settings.plugins.addDialog.tag')}>
                  <SettingsInput
                    ariaLabel={t('settings.plugins.addDialog.tag')}
                    value={tag}
                    onChange={(value) => {
                      setTag(value);
                      dirty();
                    }}
                  />
                </SettingsField>
                <SettingsField label={t('settings.plugins.addDialog.commit')}>
                  <SettingsInput
                    ariaLabel={t('settings.plugins.addDialog.commit')}
                    value={commit}
                    onChange={(value) => {
                      setCommit(value);
                      dirty();
                    }}
                  />
                </SettingsField>
              </div>
              {needsPin && (
                <p className="text-xs text-warning">
                  {t('settings.plugins.addDialog.pinHint')}
                </p>
              )}
            </>
          )}
          <button
            type="submit"
            className={button}
            disabled={!source.trim() || needsPin || busy !== null}
          >
            {busy === 'preview'
              ? t('settings.plugins.addDialog.previewing')
              : t('settings.plugins.addDialog.preview')}
          </button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-error break-words">
            {error}
          </p>
        )}

        {preview && (
          <div className="space-y-3">
            <p className="text-sm text-high">
              <strong>{preview.name}</strong>{' '}
              <span className="text-low">
                {t('settings.plugins.version', { version: preview.version })}
              </span>
            </p>
            <section className="space-y-2">
              <h4 className="text-sm font-medium text-high">
                {t('settings.plugins.addDialog.mcpTitle')}
              </h4>
              {preview.mcp.length === 0 && (
                <p className="text-sm text-low">
                  {t('settings.plugins.addDialog.noMcp')}
                </p>
              )}
              {preview.mcp.map((mcp) => (
                <div
                  key={mcp.name}
                  className="space-y-1 rounded-sm border border-border p-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-normal break-all">
                      {mcp.name}
                    </span>
                    <CompatBadge compat={mcpCompat(mcp)} />
                  </div>
                  {refsOf(mcp).map((ref) => (
                    <label key={ref} className="block text-sm text-low">
                      {Object.entries({ ...mcp.headers, ...mcp.env }).find(
                        ([, value]) => value === ref
                      )?.[0] ?? ref}
                      <input
                        type="password"
                        autoComplete="new-password"
                        aria-label={t('settings.plugins.detail.secretInput', {
                          name: ref,
                        })}
                        value={secrets[`${mcp.name}/${ref}`] ?? ''}
                        onChange={(event) =>
                          setSecrets({
                            ...secrets,
                            [`${mcp.name}/${ref}`]: event.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-sm border border-border bg-secondary px-base py-half text-sm text-high"
                      />
                    </label>
                  ))}
                </div>
              ))}
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-medium text-high">
                {t('settings.plugins.addDialog.skillsTitle')}
              </h4>
              {preview.skills.length === 0 && (
                <p className="text-sm text-low">
                  {t('settings.plugins.addDialog.noSkills')}
                </p>
              )}
              {preview.skills.map((skill) => (
                <div
                  key={skill.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border p-2"
                >
                  <span className="text-sm text-normal break-all">
                    {skill.name}
                  </span>
                  <CompatBadge compat="ok" />
                </div>
              ))}
            </section>
            {preview.unsupported.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-sm font-medium text-high">
                  {t('settings.plugins.addDialog.unsupportedTitle')}
                </h4>
                {preview.unsupported.map((item) => (
                  <div
                    key={item}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border p-2"
                  >
                    <code className="text-sm text-normal">{item}</code>
                    <CompatBadge compat="unsupported" />
                  </div>
                ))}
              </section>
            )}
            <p className="text-xs text-low">
              {t('settings.plugins.addDialog.scopeNote')}
            </p>
          </div>
        )}

        {conflicts.length > 0 && (
          <div
            role="alert"
            className="space-y-2 rounded-sm border border-warning p-2"
          >
            <p className="text-sm font-medium text-high">
              {t('settings.plugins.addDialog.conflictTitle')}
            </p>
            <ul className="text-xs text-low">
              {conflicts.map((conflict) => (
                <li
                  key={`${conflict.kind}-${conflict.name}-${conflict.against}`}
                >
                  {t('settings.plugins.addDialog.conflictBody', conflict)}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={button}
                disabled={busy !== null}
                onClick={() => void install('skip')}
              >
                {t('settings.plugins.addDialog.conflictSkip')}
              </button>
              <button
                type="button"
                className={button}
                disabled={busy !== null}
                onClick={() => void install('overwrite')}
              >
                {t('settings.plugins.addDialog.conflictOverwrite')}
              </button>
            </div>
          </div>
        )}

        <DialogFooter>
          <button type="button" className={button} onClick={close}>
            {t('settings.plugins.addDialog.cancel')}
          </button>
          <button
            type="button"
            className={primary}
            disabled={!preview || busy !== null || conflicts.length > 0}
            onClick={() => void install('abort')}
          >
            {busy === 'install'
              ? t('settings.plugins.addDialog.installing')
              : t('settings.plugins.addDialog.installTo')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
