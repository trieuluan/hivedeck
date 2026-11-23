import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DatabaseIcon,
  LinkBreakIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  SpinnerIcon,
  TerminalWindowIcon,
  UsersIcon,
  UserSwitchIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import type {
  McpToolPolicy,
  PluginMcpEntry,
  PluginMcpToolInfo,
  PluginSkillEntry,
  PluginView,
} from 'shared/types';
import { Switch } from '@vibe/ui/components/Switch';
import { cn } from '@/shared/lib/utils';
import { useProjects } from '@/shared/hooks/useProjects';
import { SettingsCheckbox } from '../SettingsComponents';
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

const TOOLS_PAGE_SIZE = 8;

type ToolFilter = 'all' | 'allow' | 'ask' | 'block';

const POLICY_OPTIONS: {
  value: McpToolPolicy;
  label: string;
  className: string;
}[] = [
  {
    value: 'default',
    label: 'Mặc định',
    className: 'border-border bg-secondary/70 text-normal',
  },
  {
    value: 'allow',
    label: 'Luôn cho phép',
    className:
      'border-emerald-500/40 bg-emerald-500/15 text-emerald-500 dark:text-emerald-400',
  },
  {
    value: 'ask',
    label: 'Hỏi',
    className:
      'border-amber-500/40 bg-amber-500/15 text-amber-500 dark:text-amber-400',
  },
  {
    value: 'block',
    label: 'Chặn',
    className: 'border-error/40 bg-error/15 text-error',
  },
];

function McpToolsGrid({
  tools,
  policies,
  disabled,
  onPolicyChange,
}: {
  tools: PluginMcpToolInfo[];
  policies: Record<string, McpToolPolicy | undefined>;
  disabled: boolean;
  onPolicyChange: (toolName: string, policy: McpToolPolicy) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ToolFilter>('all');
  const [page, setPage] = useState(1);

  const q = query.trim().toLowerCase();
  const filtered = tools.filter((tool) => {
    const policy = policies[tool.name] ?? 'default';
    if (filter !== 'all' && policy !== filter) return false;
    if (!q) return true;
    return (
      tool.name.toLowerCase().includes(q) ||
      (tool.description?.toLowerCase().includes(q) ?? false)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / TOOLS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * TOOLS_PAGE_SIZE;
  const paged = filtered.slice(start, start + TOOLS_PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-[180px] flex-1">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-low"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm công cụ MCP..."
            className="w-full rounded-md border border-border bg-secondary/50 py-1.5 pl-8 pr-3 text-xs text-normal placeholder:text-low focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>
        <div className="inline-flex rounded-md border border-border bg-secondary p-0.5">
          {(
            [
              { id: 'all', label: 'Tất cả' },
              { id: 'allow', label: 'Luôn cho phép' },
              { id: 'ask', label: 'Hỏi' },
              { id: 'block', label: 'Chặn' },
            ] as { id: ToolFilter; label: string }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setFilter(item.id);
                setPage(1);
              }}
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs transition-colors',
                filter === item.id
                  ? 'bg-brand font-medium text-white shadow-sm'
                  : 'text-low hover:text-normal'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="text-2xs text-low">
          Hỗ trợ phân quyền từng tool trên Claude Code
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="py-2 text-xs text-low">Không tìm thấy công cụ phù hợp.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {paged.map((tool) => {
              const policy: McpToolPolicy = policies[tool.name] ?? 'default';
              const meta =
                POLICY_OPTIONS.find((o) => o.value === policy) ??
                POLICY_OPTIONS[0]!;
              return (
                <div
                  key={tool.name}
                  className="flex flex-col justify-between gap-1.5 rounded-md border border-border/80 bg-panel/70 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <TerminalWindowIcon
                        className="h-3.5 w-3.5 shrink-0 text-brand"
                        weight="duotone"
                        aria-hidden
                      />
                      <code className="truncate font-mono text-xs font-semibold text-high">
                        {tool.name}
                      </code>
                    </div>
                    <select
                      aria-label={`Quyền cho ${tool.name}`}
                      disabled={disabled}
                      value={policy}
                      onChange={(e) =>
                        onPolicyChange(
                          tool.name,
                          e.target.value as McpToolPolicy
                        )
                      }
                      className={cn(
                        'shrink-0 cursor-pointer rounded border px-2 py-0.5 text-2xs font-medium focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-50',
                        meta.className
                      )}
                    >
                      {POLICY_OPTIONS.map((opt) => (
                        <option
                          key={opt.value}
                          value={opt.value}
                          className="bg-panel text-high"
                        >
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {tool.description && (
                    <p className="line-clamp-2 text-2xs leading-relaxed text-low">
                      {tool.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 pt-1 text-xs text-low">
              <span>
                {start + 1}–{Math.min(start + TOOLS_PAGE_SIZE, filtered.length)}{' '}
                / {filtered.length}
              </span>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                  className="rounded border border-border bg-panel px-2 py-1 text-xs text-normal transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ‹ Trước
                </button>
                <span className="px-2 text-2xs font-medium text-high">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                  className="rounded border border-border bg-panel px-2 py-1 text-xs text-normal transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Sau ›
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

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
  const { data: boards } = useProjects();
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [mcpSectionOpen, setMcpSectionOpen] = useState(true);
  const [skillsSectionOpen, setSkillsSectionOpen] = useState(true);
  const [openScopeSkill, setOpenScopeSkill] = useState<string | null>(null);
  const [openToolsMcps, setOpenToolsMcps] = useState<Record<string, boolean>>(
    {}
  );
  const [mcpToolsCache, setMcpToolsCache] = useState<
    Record<string, PluginMcpToolInfo[]>
  >({});
  const [mcpToolsLoading, setMcpToolsLoading] = useState<
    Record<string, boolean>
  >({});
  const [mcpToolsError, setMcpToolsError] = useState<Record<string, string>>(
    {}
  );

  const toggleMcpTools = async (mcpName: string) => {
    const nextOpen = !openToolsMcps[mcpName];
    setOpenToolsMcps((prev) => ({ ...prev, [mcpName]: nextOpen }));
    if (!nextOpen || mcpToolsCache[mcpName] || mcpToolsLoading[mcpName]) return;

    setMcpToolsLoading((prev) => ({ ...prev, [mcpName]: true }));
    setMcpToolsError((prev) => {
      const rest = { ...prev };
      delete rest[mcpName];
      return rest;
    });
    try {
      const tools = await pluginsApi.listMcpTools(plugin.name, mcpName);
      setMcpToolsCache((prev) => ({ ...prev, [mcpName]: tools }));
    } catch (reason) {
      setMcpToolsError((prev) => ({ ...prev, [mcpName]: errorText(reason) }));
    } finally {
      setMcpToolsLoading((prev) => ({ ...prev, [mcpName]: false }));
    }
  };
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
    const refs = plugin.secret_status.filter(
      (s) => s.mcp === entry.name && !s.name.startsWith('literal_')
    );
    const isHttpMcp = entry.transport === 'http' && Boolean(entry.url);
    const canOAuth = entry.oauth || isHttpMcp;
    const oauthState = canOAuth ? oauthStatusFor(entry.name) : undefined;
    const isOAuthConnected = Boolean(oauthState?.connected);
    const hasMissingSecrets = refs.some((r) => !r.has_value);
    const compat =
      isOAuthConnected || (!hasMissingSecrets && refs.length === 0)
        ? 'ok'
        : mcpCompat(entry);
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
            {!canOAuth && <CompatBadge compat={compat} />}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-md border border-border bg-panel/80 p-0.5 text-xs">
            {(
              [
                {
                  id: 'always',
                  label: 'Always',
                  active: entry.enabled && entry.injection_mode !== 'on_demand',
                  activeClass: 'bg-brand text-black font-medium',
                  patch: { enabled: true, injection_mode: 'always' as const },
                },
                {
                  id: 'on_demand',
                  label: 'On-demand',
                  active: entry.enabled && entry.injection_mode === 'on_demand',
                  activeClass: 'bg-sky-500/20 text-sky-300 font-medium',
                  patch: {
                    enabled: true,
                    injection_mode: 'on_demand' as const,
                  },
                },
                {
                  id: 'off',
                  label: 'Off',
                  active: !entry.enabled,
                  activeClass: 'bg-secondary text-normal font-medium',
                  patch: { enabled: false },
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      pluginsApi.updateMcp(plugin.name, entry.name, opt.patch),
                    t('settings.plugins.notice.saved')
                  )
                }
                className={cn(
                  'rounded px-2.5 py-1 transition-colors disabled:opacity-50',
                  opt.active ? opt.activeClass : 'text-low hover:text-normal'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {mcpToolsCache[entry.name] && (
            <span className="rounded bg-panel/80 px-2 py-0.5 text-xs text-low border border-border">
              {mcpToolsCache[entry.name]!.length} tools
            </span>
          )}
        </div>

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

        {canOAuth && (
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
                    className="inline-flex items-center gap-1 rounded-sm border border-border bg-panel/90 px-2 py-1 text-2xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high disabled:opacity-50"
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
                    className="inline-flex items-center gap-1 rounded-sm border border-error/30 bg-error/10 px-2 py-1 text-2xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
                  >
                    <LinkBreakIcon className="h-3.5 w-3.5" aria-hidden />
                    Huỷ kết nối
                  </button>
                </div>
              </div>
            ) : entry.oauth ? (
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
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-secondary/40 px-3 py-2 text-xs">
                <span className="text-low">
                  Endpoint HTTP (tuỳ chọn kết nối OAuth nếu server yêu cầu)
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
                  className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-panel px-2.5 py-1 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high disabled:opacity-50"
                >
                  Kết nối OAuth
                  <ArrowSquareOutIcon
                    className="h-3.5 w-3.5"
                    weight="bold"
                    aria-hidden
                  />
                </button>
              </div>
            )}
          </div>
        )}
        {(canOAuth || isSingleMcp) && (
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
        )}
        {isSingleMcp && (
          <div className="flex flex-wrap items-center gap-3 pt-0.5 text-xs">
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
                      onCheckedChange={(next) => toggleRole(role.id, next)}
                    />
                    <span>{role.label}</span>
                  </label>
                );
              })}
            </div>
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

        <div className="border-t border-border/60 pt-2.5">
          <button
            type="button"
            aria-expanded={Boolean(openToolsMcps[entry.name])}
            onClick={() => void toggleMcpTools(entry.name)}
            className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-normal transition-colors hover:text-high"
          >
            <span className="inline-flex items-center gap-1.5">
              <CaretDownIcon
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  !openToolsMcps[entry.name] && '-rotate-90'
                )}
                weight="bold"
                aria-hidden
              />
              <span>
                Công cụ MCP (Tools
                {mcpToolsCache[entry.name]
                  ? ` · ${mcpToolsCache[entry.name]!.length}`
                  : ''}
                )
              </span>
            </span>
            <span className="text-2xs font-normal text-low">
              {openToolsMcps[entry.name] ? 'Thu gọn' : 'Xem danh sách'}
            </span>
          </button>

          {openToolsMcps[entry.name] && (
            <div className="mt-2.5">
              {mcpToolsLoading[entry.name] && (
                <p className="flex items-center gap-2 py-2 text-xs text-low">
                  <SpinnerIcon
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden
                  />
                  Đang lấy danh sách công cụ từ MCP server...
                </p>
              )}
              {mcpToolsError[entry.name] && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-error/30 bg-error/10 px-2.5 py-2 text-xs text-error">
                  <span className="min-w-0 flex-1 break-words">
                    {mcpToolsError[entry.name]}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMcpToolsCache((prev) => {
                        const rest = { ...prev };
                        delete rest[entry.name];
                        return rest;
                      });
                      setOpenToolsMcps((prev) => ({
                        ...prev,
                        [entry.name]: false,
                      }));
                      void toggleMcpTools(entry.name);
                    }}
                    className="shrink-0 rounded-sm border border-error/40 px-2 py-0.5 text-2xs font-medium hover:bg-error/15"
                  >
                    Thử lại
                  </button>
                </div>
              )}
              {mcpToolsCache[entry.name] &&
                mcpToolsCache[entry.name]!.length === 0 && (
                  <p className="text-xs text-low">
                    MCP server không khai báo tool nào.
                  </p>
                )}
              {mcpToolsCache[entry.name] &&
                mcpToolsCache[entry.name]!.length > 0 && (
                  <McpToolsGrid
                    tools={mcpToolsCache[entry.name]!}
                    policies={entry.tool_policies ?? {}}
                    disabled={busy}
                    onPolicyChange={(toolName, policy) => {
                      const next = { ...(entry.tool_policies ?? {}) };
                      if (policy === 'default') delete next[toolName];
                      else next[toolName] = policy;
                      void run(
                        () =>
                          pluginsApi.updateMcp(plugin.name, entry.name, {
                            tool_policies: next,
                          }),
                        t('settings.plugins.notice.saved')
                      );
                    }}
                  />
                )}
            </div>
          )}
        </div>

        <McpInstructionsEditor
          value={entry.instructions ?? ''}
          serverInstructions={entry.server_instructions ?? ''}
          disabled={busy}
          onSave={(instructions) =>
            void run(
              () =>
                pluginsApi.updateMcp(plugin.name, entry.name, {
                  instructions,
                }),
              t('settings.plugins.notice.saved')
            )
          }
        />
      </li>
    );
  };

  const skillRow = (skill: PluginSkillEntry) => {
    const description = plugin.skill_descriptions?.[skill.name];
    const scopeOpen = openScopeSkill === skill.name;
    const toggleRole = (role: string, enabled: boolean) => {
      const next = enabled
        ? [...new Set([...skill.roles, role])]
        : skill.roles.filter((r) => r !== role);
      if (next.length === 0) return;
      void run(
        () => pluginsApi.updateSkill(plugin.name, skill.name, { roles: next }),
        t('settings.plugins.notice.saved')
      );
    };
    const toggleBoard = (boardId: string, enabled: boolean) => {
      const next = enabled
        ? [...new Set([...skill.boards, boardId])]
        : skill.boards.filter((b) => b !== boardId);
      void run(
        () => pluginsApi.updateSkill(plugin.name, skill.name, { boards: next }),
        t('settings.plugins.notice.saved')
      );
    };

    return (
      <li
        key={skill.name}
        className="flex flex-col justify-between gap-2.5 rounded-md border border-border bg-secondary/20 p-3"
      >
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-panel text-low">
                <CodeIcon className="h-3.5 w-3.5" weight="bold" aria-hidden />
              </span>
              <strong className="truncate text-xs font-semibold text-high">
                {skill.name}
              </strong>
            </div>
            <Switch
              checked={skill.enabled}
              disabled={busy}
              aria-label={t('settings.plugins.detail.itemEnabled', {
                name: skill.name,
              })}
              onCheckedChange={(enabled) =>
                void run(
                  () =>
                    pluginsApi.updateSkill(plugin.name, skill.name, {
                      enabled,
                    }),
                  t('settings.plugins.notice.saved')
                )
              }
            />
          </div>
          {description && (
            <p className="line-clamp-2 text-2xs leading-relaxed text-low">
              {description}
            </p>
          )}
          <div className="inline-flex rounded-md border border-border bg-panel/80 p-0.5 text-2xs">
            {(
              [
                {
                  id: 'always',
                  label: 'Always',
                  active: skill.enabled && skill.injection_mode !== 'on_demand',
                  activeClass: 'bg-brand text-black font-medium',
                  patch: { enabled: true, injection_mode: 'always' as const },
                },
                {
                  id: 'on_demand',
                  label: 'On-demand',
                  active: skill.enabled && skill.injection_mode === 'on_demand',
                  activeClass: 'bg-sky-500/20 text-sky-300 font-medium',
                  patch: {
                    enabled: true,
                    injection_mode: 'on_demand' as const,
                  },
                },
                {
                  id: 'off',
                  label: 'Off',
                  active: !skill.enabled,
                  activeClass: 'bg-secondary text-normal font-medium',
                  patch: { enabled: false },
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      pluginsApi.updateSkill(plugin.name, skill.name, opt.patch),
                    t('settings.plugins.notice.saved')
                  )
                }
                className={cn(
                  'rounded px-2 py-0.5 transition-colors disabled:opacity-50',
                  opt.active ? opt.activeClass : 'text-low hover:text-normal'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1">
              {ROLES.map((role) => {
                const active = skill.roles.includes(role.id);
                const isOnlyRole = active && skill.roles.length === 1;
                return (
                  <button
                    key={role.id}
                    type="button"
                    disabled={busy || isOnlyRole}
                    onClick={() => toggleRole(role.id, !active)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-2xs font-medium transition-colors disabled:opacity-60',
                      active
                        ? 'border-brand/50 bg-brand/15 text-brand'
                        : 'border-border bg-panel/60 text-low hover:text-normal'
                    )}
                  >
                    {role.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-expanded={scopeOpen}
              onClick={() => setOpenScopeSkill(scopeOpen ? null : skill.name)}
              className="inline-flex items-center gap-1 rounded border border-border bg-panel/60 px-2 py-0.5 text-2xs text-low transition-colors hover:bg-secondary hover:text-high"
            >
              <span>Phạm vi</span>
              <CaretDownIcon
                className={cn(
                  'h-2.5 w-2.5 transition-transform',
                  scopeOpen && 'rotate-180'
                )}
                weight="bold"
                aria-hidden
              />
            </button>
          </div>

          {scopeOpen && boards.length > 0 && (
            <div className="space-y-1.5 border-t border-border/60 pt-2">
              <span className="block text-2xs font-medium text-low">
                {t('settings.plugins.detail.boards')}
              </span>
              <div className="space-y-1">
                {boards.map((board) => (
                  <SettingsCheckbox
                    key={board.id}
                    id={`skill-${plugin.name}-${skill.name}-board-${board.id}`}
                    label={board.name}
                    checked={skill.boards.includes(board.id)}
                    disabled={busy}
                    onChange={(on) => toggleBoard(board.id, on)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </li>
    );
  };

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
    <div className="space-y-3.5 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-sm border border-border bg-panel/60 px-3 py-2 text-xs text-low">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <span className="min-w-0 truncate">
            <strong className="font-medium text-normal">
              {t('settings.plugins.detail.source')}:
            </strong>{' '}
            <span className="font-mono">{plugin.source}</span>
          </span>
          {pin && (
            <span className="shrink-0">
              <strong className="font-medium text-normal">{pin.label}:</strong>{' '}
              <span className="font-mono">{pin.value}</span>
            </span>
          )}
        </div>
        {plugin.mcp.length + plugin.skills.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-2xs text-low">Toàn bộ plugin:</span>
            <div className="inline-flex rounded-md border border-border bg-panel/80 p-0.5 text-2xs">
              {(
                [
                  {
                    id: 'always' as const,
                    label: 'Always',
                    active:
                      plugin.mcp.every((m) => m.injection_mode !== 'on_demand') &&
                      plugin.skills.every(
                        (s) => s.injection_mode !== 'on_demand'
                      ),
                    activeClass: 'bg-brand text-black font-medium',
                  },
                  {
                    id: 'on_demand' as const,
                    label: 'On-demand',
                    active:
                      plugin.mcp.every((m) => m.injection_mode === 'on_demand') &&
                      plugin.skills.every(
                        (s) => s.injection_mode === 'on_demand'
                      ),
                    activeClass: 'bg-sky-500/20 text-sky-300 font-medium',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => pluginsApi.setInjectionMode(plugin.name, opt.id),
                      t('settings.plugins.notice.saved')
                    )
                  }
                  className={cn(
                    'rounded px-2 py-0.5 transition-colors disabled:opacity-50',
                    opt.active ? opt.activeClass : 'text-low hover:text-normal'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {plugin.mcp.length > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            aria-expanded={mcpSectionOpen}
            onClick={() => setMcpSectionOpen((prev) => !prev)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-high">
              <CaretDownIcon
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  !mcpSectionOpen && '-rotate-90'
                )}
                weight="bold"
                aria-hidden
              />
              <DatabaseIcon
                className="h-4 w-4 text-low"
                weight="duotone"
                aria-hidden
              />
              MCP Servers ({plugin.mcp.length})
            </span>
            <span className="text-xs text-low">
              {mcpSectionOpen ? 'Thu gọn' : 'Mở rộng'}
            </span>
          </button>
          {mcpSectionOpen && (
            <ul className="space-y-2">
              {plugin.mcp.map((m) => mcpRow(m, false))}
            </ul>
          )}
        </section>
      )}

      {plugin.skills.length > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            aria-expanded={skillsSectionOpen}
            onClick={() => setSkillsSectionOpen((prev) => !prev)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-high">
              <CaretDownIcon
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  !skillsSectionOpen && '-rotate-90'
                )}
                weight="bold"
                aria-hidden
              />
              <CodeIcon
                className="h-4 w-4 text-low"
                weight="duotone"
                aria-hidden
              />
              Skills ({plugin.skills.length})
            </span>
            <span className="text-xs text-low">
              {skillsSectionOpen ? 'Thu gọn' : 'Mở rộng'}
            </span>
          </button>
          {skillsSectionOpen && (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {plugin.skills.map(skillRow)}
            </ul>
          )}
        </section>
      )}
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

function McpInstructionsEditor({
  value,
  serverInstructions,
  disabled,
  onSave,
}: {
  value: string;
  serverInstructions: string;
  disabled?: boolean;
  onSave: (instructions: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const dirty = draft.trim() !== value.trim();

  return (
    <div className="space-y-1.5 border-t border-border/60 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-low">
          Hướng dẫn cho agent (chỉ chèn vào role được bật)
        </span>
        {dirty && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSave(draft)}
            className="rounded border border-brand/40 bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
          >
            Lưu hướng dẫn
          </button>
        )}
      </div>
      <textarea
        rows={2}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Ví dụ: Ưu tiên dùng MCP này để tra cứu cấu trúc/symbol codebase trước khi chạy rg/sed…"
        className="w-full rounded-sm border border-border bg-panel/80 px-2.5 py-1.5 text-xs text-normal placeholder:text-low/60 focus:border-brand focus:outline-none disabled:opacity-50"
      />
      {!value.trim() && serverInstructions.trim() && (
        <p className="text-xs text-low">
          Đang tự dùng <code className="font-mono">instructions</code> mặc định
          từ MCP server (nhập phía trên nếu muốn ghi đè).
        </p>
      )}
    </div>
  );
}
