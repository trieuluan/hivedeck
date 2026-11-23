import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EyeIcon,
  GitBranchIcon,
  GlobeIcon,
  MagnifyingGlassIcon,
  MaskHappyIcon,
  PlugIcon,
  ShieldCheckIcon,
  SparkleIcon,
  StackIcon,
  TerminalWindowIcon,
  WrenchIcon,
} from '@phosphor-icons/react';
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
import { Switch } from '@vibe/ui/components/Switch';
import { cn } from '@/shared/lib/utils';
import {
  SettingsField,
  SettingsInput,
  SettingsTextarea,
} from '../SettingsComponents';
import { PluginConflictError, pluginsApi } from './pluginsApi';
import { CompatBadge, mcpCompat } from './pluginCompat';
import { errorText } from './pluginNotice';

const button =
  'inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-normal hover:bg-secondary hover:text-high disabled:opacity-50 transition-colors';
const primary =
  'inline-flex items-center gap-1.5 rounded-sm bg-brand px-3.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-brand/90 disabled:opacity-50 transition-colors';

const isRemote = (source: string) =>
  /^(https?|ssh|git|file):\/\//.test(source) || source.startsWith('git@');

type PresetId =
  | 'higgsfield'
  | 'context7'
  | 'playwright'
  | 'exa'
  | 'chrome_devtools'
  | 'dev_manager';

const PRESETS: {
  id: PresetId;
  label: string;
  kind: 'http' | 'stdio';
  source: string;
  args: string;
  secrets: string;
  oauth: boolean;
  icon: typeof SparkleIcon;
}[] = [
  {
    id: 'higgsfield',
    label: 'Higgsfield MCP',
    kind: 'http',
    source: 'https://mcp.higgsfield.ai/mcp',
    args: '',
    secrets: '',
    oauth: true,
    icon: SparkleIcon,
  },
  {
    id: 'context7',
    label: 'Context7',
    kind: 'http',
    source: 'https://mcp.context7.com/mcp',
    args: '',
    secrets: 'CONTEXT7_API_KEY',
    oauth: false,
    icon: StackIcon,
  },
  {
    id: 'playwright',
    label: 'Playwright',
    kind: 'stdio',
    source: 'npx',
    args: '@playwright/mcp@latest',
    secrets: '',
    oauth: false,
    icon: MaskHappyIcon,
  },
  {
    id: 'exa',
    label: 'Exa',
    kind: 'stdio',
    source: 'npx',
    args: '-y\nexa-mcp-server\ntools=web_search_exa,get_code_context_exa',
    secrets: 'EXA_API_KEY',
    oauth: false,
    icon: MagnifyingGlassIcon,
  },
  {
    id: 'chrome_devtools',
    label: 'Chrome DevTools',
    kind: 'stdio',
    source: 'npx',
    args: 'chrome-devtools-mcp@latest',
    secrets: '',
    oauth: false,
    icon: WrenchIcon,
  },
  {
    id: 'dev_manager',
    label: 'Dev Manager',
    kind: 'stdio',
    source: 'npx',
    args: 'dev-manager-mcp\nstdio',
    secrets: '',
    oauth: false,
    icon: TerminalWindowIcon,
  },
];

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
  const [kind, setKind] = useState<'repo' | 'http' | 'stdio' | 'skill'>('repo');
  const [activePreset, setActivePreset] = useState<PresetId | null>(null);
  const [name, setName] = useState('');
  const [skillContent, setSkillContent] = useState('');
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
    setActivePreset(null);
    setName('');
    setSkillContent('');
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

  function parseCliArgs(raw: string): string[] {
    const result: string[] = [];
    for (const line of raw.split('\n')) {
      const matches = line.match(/"([^"]*)"|'([^']*)'|\S+/g);
      if (!matches) continue;
      for (const token of matches) {
        if (
          (token.startsWith('"') && token.endsWith('"')) ||
          (token.startsWith("'") && token.endsWith("'"))
        ) {
          result.push(token.slice(1, -1));
        } else {
          result.push(token);
        }
      }
    }
    return result;
  }

  const input = () => ({
    source: kind === 'skill' && skillContent.trim() ? '' : source,
    tag: kind === 'repo' ? tag : '',
    commit: kind === 'repo' ? commit : '',
    ...(kind === 'skill'
      ? {
          singleSkill: {
            name: name.trim(),
            content: skillContent.trim() ? skillContent : null,
          },
        }
      : kind === 'repo'
        ? {}
        : {
            singleMcp: {
            name: name.trim(),
            transport: kind,
            command: kind === 'stdio' ? source.trim() : null,
            args: kind === 'stdio' ? parseCliArgs(args) : [],
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
            injection_mode: 'always' as const,
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

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setActivePreset(preset.id);
    setKind(preset.kind);
    setName(preset.id);
    setSource(preset.source);
    setArgs(preset.args);
    setSecretNames(preset.secrets);
    setOauth(preset.oauth);
    dirty();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="min-w-0 max-h-[84vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-brand/30 bg-brand/10 text-brand">
              <PlugIcon className="h-5 w-5" weight="duotone" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <DialogTitle className="text-base font-semibold text-high">
                {t('settings.plugins.addDialog.title')}
              </DialogTitle>
              <DialogDescription className="text-xs text-low">
                {t('settings.plugins.addDialog.description')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form
          id="add-plugin-form"
          className="space-y-4 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (source.trim() && !needsPin && !busy) void runPreview();
          }}
        >
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-normal">
              {t('settings.plugins.addDialog.sourceKind')}
            </span>
            <div
              role="tablist"
              aria-label={t('settings.plugins.addDialog.sourceKind')}
              className="grid grid-cols-3 gap-1.5 rounded-md border border-border bg-secondary/40 p-1"
            >
              {(
                [
                  {
                    id: 'repo',
                    label: 'Git / Local',
                    icon: GitBranchIcon,
                  },
                  {
                    id: 'http',
                    label: 'URL MCP (HTTP)',
                    icon: GlobeIcon,
                  },
                  {
                    id: 'stdio',
                    label: 'Command MCP',
                    icon: TerminalWindowIcon,
                  },
                  {
                    id: 'skill',
                    label: 'Skill',
                    icon: SparkleIcon,
                  },
                ] as const
              ).map((tab) => {
                const TabIcon = tab.icon;
                const active = kind === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setKind(tab.id);
                      setActivePreset(null);
                      dirty();
                    }}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'border-brand/60 bg-brand/10 text-high shadow-sm'
                        : 'border-transparent text-low hover:bg-secondary/60 hover:text-normal'
                    )}
                  >
                    <TabIcon
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        active ? 'text-brand' : 'text-low'
                      )}
                      weight="duotone"
                      aria-hidden
                    />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-normal">
              Mẫu nhanh (Preset)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => {
                const PresetIcon = preset.icon;
                const selected = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                      selected
                        ? 'border-brand/70 bg-brand/15 text-brand'
                        : 'border-border bg-secondary/35 text-normal hover:bg-secondary hover:text-high'
                    )}
                  >
                    <PresetIcon
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        selected ? 'text-brand' : 'text-low'
                      )}
                      weight="duotone"
                      aria-hidden
                    />
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {kind !== 'repo' && (
            <SettingsField
              label={
                kind === 'skill'
                  ? 'Tên skill'
                  : t('settings.plugins.addDialog.serverName')
              }
            >
              <SettingsInput
                ariaLabel={
                  kind === 'skill'
                    ? 'Tên skill'
                    : t('settings.plugins.addDialog.serverName')
                }
                value={name}
                placeholder={kind === 'skill' ? 'my-skill' : 'higgsfield'}
                onChange={(value) => {
                  setName(value);
                  setActivePreset(null);
                  dirty();
                }}
              />
            </SettingsField>
          )}

          {kind !== 'skill' ? (
            <SettingsField
              label={
                kind === 'http'
                  ? 'Endpoint URL'
                  : kind === 'stdio'
                    ? 'Command'
                    : t('settings.plugins.addDialog.source')
              }
            >
              <SettingsInput
                ariaLabel={t('settings.plugins.addDialog.source')}
                value={source}
                placeholder={
                  kind === 'http'
                    ? 'https://mcp.higgsfield.ai/mcp'
                    : kind === 'stdio'
                      ? 'npx'
                      : t('settings.plugins.addDialog.sourcePlaceholder')
                }
                onChange={(value) => {
                  setSource(value);
                  setActivePreset(null);
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
          ) : (
            <>
              <SettingsField label="Đường dẫn thư mục / SKILL.md hoặc Git URL (tuỳ chọn nếu dán nội dung bên dưới)">
                <SettingsInput
                  ariaLabel="Skill source"
                  value={source}
                  placeholder="/path/to/my-skill hoặc https://github.com/user/skill-repo.git"
                  onChange={(value) => {
                    setSource(value);
                    if (!name.trim()) {
                      const cleaned = value.trim().replace(/\/+$/, '');
                      const parts = cleaned.split('/');
                      const last = parts[parts.length - 1] ?? '';
                      const candidate =
                        last === 'SKILL.md'
                          ? (parts[parts.length - 2] ?? '')
                          : last.replace(/\.git$/, '');
                      if (candidate) setName(candidate);
                    }
                    dirty();
                  }}
                />
              </SettingsField>
              <SettingsField label="Hoặc dán nội dung SKILL.md">
                <SettingsTextarea
                  ariaLabel="SKILL.md content"
                  value={skillContent}
                  rows={6}
                  monospace
                  placeholder={'---\nname: my-skill\ndescription: ...\n---\n\nHướng dẫn skill...'}
                  onChange={(value) => {
                    setSkillContent(value);
                    dirty();
                  }}
                />
              </SettingsField>
            </>
          )}

          {(kind === 'http' || kind === 'stdio') && (
            <>
              {kind === 'stdio' && (
                <SettingsField
                  label={t('settings.plugins.addDialog.arguments')}
                >
                  <SettingsTextarea
                    ariaLabel={t('settings.plugins.addDialog.arguments')}
                    value={args}
                    rows={3}
                    monospace
                    placeholder="@playwright/mcp@latest"
                    onChange={(value) => {
                      setArgs(value);
                      dirty();
                    }}
                  />
                </SettingsField>
              )}
              <SettingsField
                label={`${kind === 'http' ? 'Header' : 'Environment'} — ${t(
                  'settings.plugins.addDialog.secretNames'
                )}`}
              >
                <SettingsTextarea
                  ariaLabel={kind === 'http' ? 'Header' : 'Environment'}
                  value={secretNames}
                  rows={2}
                  monospace
                  placeholder={
                    kind === 'http'
                      ? 'Để trống nếu dùng OAuth 2.1'
                      : 'API_KEY (mỗi dòng 1 biến)'
                  }
                  onChange={(value) => {
                    setSecretNames(value);
                    dirty();
                  }}
                />
              </SettingsField>
              {kind === 'http' && (
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-brand/30 bg-brand/[0.06] px-3.5 py-2.5 transition-colors hover:bg-brand/10">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <ShieldCheckIcon
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand"
                      weight="duotone"
                      aria-hidden
                    />
                    <div className="min-w-0 space-y-0.5">
                      <span className="block text-xs font-semibold text-high">
                        Xác thực OAuth 2.1 (PKCE)
                      </span>
                      <span className="block text-2xs text-low">
                        Tự động mở trình duyệt đăng nhập 1 lần và cấp token cho
                        9 CLI
                      </span>
                    </div>
                  </div>
                  <Switch
                    checked={oauth}
                    onCheckedChange={(checked) => {
                      setOauth(checked);
                      dirty();
                    }}
                  />
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
                    placeholder="v1.0.0"
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
                    placeholder="40-char SHA"
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

        <DialogFooter className="border-t border-border pt-3 sm:justify-between">
          <button
            type="submit"
            form="add-plugin-form"
            className={button}
            disabled={
              (kind === 'skill'
                ? !name.trim() || (!source.trim() && !skillContent.trim())
                : !source.trim()) ||
              needsPin ||
              busy !== null
            }
          >
            <EyeIcon className="h-3.5 w-3.5" weight="bold" aria-hidden />
            {busy === 'preview'
              ? t('settings.plugins.addDialog.previewing')
              : t('settings.plugins.addDialog.preview')}
          </button>
          <div className="flex items-center justify-end gap-2">
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
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
