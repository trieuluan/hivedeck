import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  LinkBreakIcon,
  LinkIcon,
  UsersIcon,
  UserSwitchIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import type {
  PluginMcpEntry,
  PluginSkillEntry,
  PluginView,
} from 'shared/types';
import { Switch } from '@vibe/ui/components/Switch';
import { pluginsApi, type ScopePatch } from './pluginsApi';
import { CompatBadge, mcpCompat } from './pluginCompat';
import { PluginScopeEditor } from './PluginScopeEditor';
import { errorText, type Notice } from './pluginNotice';
import { launchMcpOAuthFlow } from './mcpOAuthPopup';

const button =
  'inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-sm text-normal hover:bg-secondary disabled:opacity-50 transition-colors';

const oauthCtaButton =
  'inline-flex items-center gap-1.5 rounded-sm bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-brand/90 disabled:opacity-50 transition-colors';

const SUPPORTED_OAUTH_CLIS = [
  'Claude Code',
  'Codex',
  'OpenCode',
  'Gemini',
  'Cursor',
  'Copilot',
  'Amp',
  'Droid',
  'Qwen',
];

const ROLES = [
  { id: 'captain', label: 'Thuyền trưởng' },
  { id: 'crew', label: 'Crew' },
] as const;

export function PluginDetail({
  plugin,
  onChanged,
  notify,
}: {
  plugin: PluginView;
  onChanged: () => Promise<void>;
  notify: (notice: Notice) => void;
}) {
  const { t } = useTranslation('settings');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const status = (mcp: string, name: string) =>
    plugin.secret_status.find((s) => s.mcp === mcp && s.name === name)
      ?.has_value ?? false;
  const oauthStatusFor = (mcp: string) =>
    plugin.oauth_status?.find((s) => s.mcp === mcp);

  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
      notify({ kind: 'ok', text: ok });
    } catch (reason) {
      notify({ kind: 'error', text: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  const key = (mcp: string, ref: string) => `${mcp}/${ref}`;
  const pin = plugin.tag
    ? { label: t('settings.plugins.detail.tag'), value: plugin.tag }
    : plugin.commit
      ? { label: t('settings.plugins.detail.commit'), value: plugin.commit }
      : null;

  const mcpRow = (entry: PluginMcpEntry, isSingleMcp = false) => {
    const refs = plugin.secret_status.filter((s) => s.mcp === entry.name);
    const oauthState = entry.oauth ? oauthStatusFor(entry.name) : undefined;
    const isOAuthConnected = Boolean(oauthState?.connected);
    const compat = isOAuthConnected ? 'ok' : mcpCompat(entry);
    const endpointText =
      entry.transport === 'http'
        ? (entry.url ?? '')
        : [entry.command, ...entry.args].join(' ');
    const toggleRole = (role: string, enabled: boolean) => {
      const next = enabled
        ? [...new Set([...entry.roles, role])]
        : entry.roles.filter((r) => r !== role);
      if (next.length === 0) return;
      void run(
        () => pluginsApi.updateMcp(plugin.name, entry.name, { roles: next }),
        t('settings.plugins.notice.saved')
      );
    };

    return (
      <li
        key={entry.name}
        className="space-y-3 rounded-md border border-border bg-secondary/15 p-3.5"
      >
        {!isSingleMcp && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PluginScopeEditor
              id={`mcp-${plugin.name}-${entry.name}`}
              name={entry.name}
              scope={entry}
              disabled={busy}
              onChange={(patch: ScopePatch) =>
                void run(
                  () => pluginsApi.updateMcp(plugin.name, entry.name, patch),
                  t('settings.plugins.notice.saved')
                )
              }
            />
            {!entry.oauth && <CompatBadge compat={compat} />}
          </div>
        )}

        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex w-28 shrink-0 items-center gap-1.5 font-medium text-low">
            <LinkIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {entry.transport === 'http' ? 'Endpoint MCP' : entry.transport}
          </span>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-sm border border-border bg-panel/80 px-2.5 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-normal">
              {endpointText}
            </code>
            {endpointText && (
              <button
                type="button"
                aria-label="Copy endpoint"
                onClick={() => {
                  void navigator.clipboard?.writeText(endpointText);
                  setCopiedUrl(endpointText);
                  window.setTimeout(() => setCopiedUrl(null), 1500);
                }}
                className="shrink-0 rounded p-0.5 text-low transition-colors hover:bg-secondary hover:text-high"
              >
                {copiedUrl === endpointText ? (
                  <CheckIcon
                    className="h-3.5 w-3.5 text-success"
                    weight="bold"
                  />
                ) : (
                  <CopyIcon className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        </div>

        {entry.oauth && (
          <div className="space-y-3">
            {isOAuthConnected ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <CheckCircleIcon
                    className="h-4 w-4 shrink-0"
                    weight="fill"
                    aria-hidden
                  />
                  Đã xác thực qua OAuth 2.1 (PKCE
                  {oauthState?.has_refresh_token ? ' + Auto-Refresh' : ''})
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-brand/30 bg-brand/10 px-3 py-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-brand">
                  <WarningIcon
                    className="h-4 w-4 shrink-0"
                    weight="fill"
                    aria-hidden
                  />
                  Cần xác thực OAuth để tự động cấp token cho mọi CLI
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void launchMcpOAuthFlow({
                      pluginName: plugin.name,
                      mcpName: entry.name,
                      onComplete: async () => {
                        await onChanged();
                        setBusy(false);
                        notify({
                          kind: 'ok',
                          text: `Đã kết nối OAuth thành công cho ${entry.name}.`,
                        });
                      },
                      onError: (reason) => {
                        setBusy(false);
                        notify({ kind: 'error', text: errorText(reason) });
                      },
                    });
                  }}
                  className={oauthCtaButton}
                >
                  Đăng nhập OAuth
                  <ArrowSquareOutIcon
                    className="h-3.5 w-3.5"
                    weight="bold"
                    aria-hidden
                  />
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex w-28 shrink-0 items-center gap-1.5 font-medium text-low">
                <CodeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Tương thích
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-2xs">
                {SUPPORTED_OAUTH_CLIS.map((cliLabel) => (
                  <span
                    key={cliLabel}
                    className="rounded border border-border bg-secondary/70 px-2 py-0.5 text-normal"
                  >
                    {cliLabel}
                  </span>
                ))}
              </div>
            </div>

            {isSingleMcp && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex w-28 shrink-0 items-center gap-1.5 font-medium text-low">
                    <UsersIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Cấp vai trò
                  </span>
                  <div className="flex flex-wrap items-center gap-4">
                    {ROLES.map((role) => {
                      const checked = entry.roles.includes(role.id);
                      const isOnlyRole = checked && entry.roles.length === 1;
                      return (
                        <label
                          key={role.id}
                          className="inline-flex cursor-pointer items-center gap-2 text-xs text-normal"
                        >
                          <Switch
                            checked={checked}
                            disabled={busy || isOnlyRole}
                            onCheckedChange={(next) =>
                              toggleRole(role.id, next)
                            }
                          />
                          <span>{role.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {isOAuthConnected && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void launchMcpOAuthFlow({
                          pluginName: plugin.name,
                          mcpName: entry.name,
                          onComplete: async () => {
                            await onChanged();
                            setBusy(false);
                            notify({
                              kind: 'ok',
                              text: `Đã cập nhật đăng nhập OAuth cho ${entry.name}.`,
                            });
                          },
                          onError: (reason) => {
                            setBusy(false);
                            notify({ kind: 'error', text: errorText(reason) });
                          },
                        });
                      }}
                      className="inline-flex items-center gap-1 rounded-sm border border-border bg-panel px-2.5 py-1 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high disabled:opacity-50"
                    >
                      <UserSwitchIcon className="h-3.5 w-3.5" aria-hidden />
                      Đổi tài khoản
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            pluginsApi.disconnectOAuth(plugin.name, entry.name),
                          `Đã huỷ kết nối OAuth cho ${entry.name}.`
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-sm border border-error/30 bg-error/10 px-2.5 py-1 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
                    >
                      <LinkBreakIcon className="h-3.5 w-3.5" aria-hidden />
                      Huỷ kết nối
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {refs.map((ref) => {
          const id = key(entry.name, ref.name);
          const draft = drafts[id] ?? '';
          return (
            <div key={id} className="space-y-1">
              <label className="block text-sm text-low">
                {ref.name}:{' '}
                {ref.has_value
                  ? t('settings.plugins.detail.secretSet')
                  : t('settings.plugins.detail.secretUnset')}
                <input
                  type="password"
                  autoComplete="new-password"
                  aria-label={t('settings.plugins.detail.secretInput', {
                    name: ref.name,
                  })}
                  value={draft}
                  onChange={(event) =>
                    setDrafts({ ...drafts, [id]: event.target.value })
                  }
                  className="mt-1 w-full rounded-sm border border-border bg-secondary px-base py-half text-sm text-high"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={busy || !draft}
                  onClick={() =>
                    void run(async () => {
                      await pluginsApi.setSecret(
                        plugin.name,
                        entry.name,
                        ref.name,
                        draft
                      );
                      setDrafts({ ...drafts, [id]: '' });
                    }, t('settings.plugins.notice.secretSaved'))
                  }
                >
                  {t('settings.plugins.detail.secretSave')}
                </button>
                {status(entry.name, ref.name) && (
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          pluginsApi.clearSecret(
                            plugin.name,
                            entry.name,
                            ref.name
                          ),
                        t('settings.plugins.notice.secretCleared')
                      )
                    }
                  >
                    {t('settings.plugins.detail.secretClear')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </li>
    );
  };

  const skillRow = (skill: PluginSkillEntry) => (
    <li key={skill.name} className="rounded-sm border border-border p-2">
      <PluginScopeEditor
        id={`skill-${plugin.name}-${skill.name}`}
        name={skill.name}
        scope={skill}
        disabled={busy}
        onChange={(patch: ScopePatch) =>
          void run(
            () => pluginsApi.updateSkill(plugin.name, skill.name, patch),
            t('settings.plugins.notice.saved')
          )
        }
      />
    </li>
  );

  const isSingleMcp =
    plugin.source === 'mcp-single' &&
    plugin.mcp.length === 1 &&
    plugin.skills.length === 0;

  if (isSingleMcp) {
    return (
      <div className="border-t border-border/70 pt-3">
        <ul className="space-y-2">{mcpRow(plugin.mcp[0]!, true)}</ul>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t border-border pt-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-low">{t('settings.plugins.detail.source')}</dt>
        <dd className="text-normal break-all">{plugin.source}</dd>
        {pin ? (
          <>
            <dt className="text-low">{pin.label}</dt>
            <dd className="text-normal break-all">{pin.value}</dd>
          </>
        ) : (
          <>
            <dt className="text-low">{t('settings.plugins.detail.tag')}</dt>
            <dd className="text-normal">
              {t('settings.plugins.detail.noPin')}
            </dd>
          </>
        )}
        {plugin.commit && plugin.tag && (
          <>
            <dt className="text-low">{t('settings.plugins.detail.commit')}</dt>
            <dd className="text-normal break-all">{plugin.commit}</dd>
          </>
        )}
      </dl>
      <section className="space-y-2">
        <h4 className="text-sm font-medium text-high">
          {t('settings.plugins.detail.mcpTitle')}
        </h4>
        {plugin.mcp.length ? (
          <ul className="space-y-2">
            {plugin.mcp.map((m) => mcpRow(m, false))}
          </ul>
        ) : (
          <p className="text-sm text-low">
            {t('settings.plugins.addDialog.noMcp')}
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h4 className="text-sm font-medium text-high">
          {t('settings.plugins.detail.skillsTitle')}
        </h4>
        {plugin.skills.length ? (
          <ul className="space-y-2">{plugin.skills.map(skillRow)}</ul>
        ) : (
          <p className="text-sm text-low">
            {t('settings.plugins.addDialog.noSkills')}
          </p>
        )}
      </section>
      {plugin.unsupported.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-sm font-medium text-high">
            {t('settings.plugins.detail.unsupportedTitle')}
          </h4>
          <ul className="flex flex-wrap gap-2">
            {plugin.unsupported.map((item) => (
              <li key={item}>
                <code className="rounded-sm bg-secondary px-2 py-0.5 text-xs text-error">
                  {item}
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {plugin.notes.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-sm font-medium text-high">
            {t('settings.plugins.detail.notesTitle')}
          </h4>
          <ul className="text-xs text-low">
            {plugin.notes.map((note) => (
              <li key={`${note.kind}-${note.name}-${note.against}`}>
                {t('settings.plugins.addDialog.conflictBody', {
                  kind: note.kind,
                  name: note.name,
                  against: note.against,
                })}
                {note.action ? ` (${note.action})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
