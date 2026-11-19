import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlusIcon } from '@phosphor-icons/react';
import type { ExecutorProfile, JsonValue } from 'shared/types';
import { BaseCodingAgent, McpConfig } from 'shared/types';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { McpConfigStrategyGeneral } from '@/shared/lib/mcpStrategies';
import { removeMcpOAuthSecrets } from '@/shared/lib/mcpSync';
import { cn } from '@/shared/lib/utils';
import { toPrettyCase } from '@/shared/lib/string';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuTriggerButton,
} from '@vibe/ui/components/Dropdown';
import {
  SettingsCard,
  SettingsField,
  SettingsInput,
  SettingsCheckbox,
  SettingsSaveBar,
  SettingsTextarea,
} from './SettingsComponents';
import { useSettingsDirty } from './SettingsDirtyContext';
import { useSettingsMachineClient } from './SettingsHostContext';

function MultiCliMcp({
  onSaved,
  disabled,
}: {
  onSaved: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation('settings');
  const client = useSettingsMachineClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'http' | 'stdio'>('http');
  const [endpoint, setEndpoint] = useState('');
  const [args, setArgs] = useState('');
  const [pairs, setPairs] = useState('');
  const [claude, setClaude] = useState(true);
  const [codex, setCodex] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState<Record<string, JsonValue> | null>(
    null
  );
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [presets, setPresets] = useState<Record<string, JsonValue>>({});

  useEffect(() => {
    if (!client) return;
    client
      .loadMcpServers({ executor: BaseCodingAgent.CLAUDE_CODE })
      .then(({ mcp_config }) => {
        const source = mcp_config.preconfigured;
        if (source && typeof source === 'object' && !Array.isArray(source))
          setPresets(
            Object.fromEntries(
              Object.entries(source).map(([key, value]) => [key, value ?? null])
            )
          );
      })
      .catch(() => {});
  }, [client]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const loadSync = () =>
    run(async () => {
      if (!client) throw new Error('Machine client unavailable');
      const [source, target] = await Promise.all([
        client.loadMcpServers({ executor: BaseCodingAgent.CLAUDE_CODE }),
        client.loadMcpServers({ executor: BaseCodingAgent.CODEX }),
      ]);
      const entries = Object.entries(source.mcp_config.servers);
      setDuplicates(
        entries
          .filter(([key]) => Object.hasOwn(target.mcp_config.servers, key))
          .map(([key]) => key)
      );
      setMissing(
        Object.fromEntries(
          entries
            .filter(([key]) => !Object.hasOwn(target.mcp_config.servers, key))
            .map(([key, value]) => [key, value ?? null])
        )
      );
      setSelected([]);
    });
  const install = (
    executor: BaseCodingAgent,
    servers: Record<string, JsonValue>
  ) => {
    if (!client) throw new Error('Machine client unavailable');
    return client.installMcpServers({ executor }, { servers });
  };
  const add = () =>
    run(async () => {
      if (!name.trim() || !endpoint.trim() || (!claude && !codex))
        throw new Error(t('settings.mcp.multi.invalid'));
      const values: Record<string, string> = {};
      for (const line of pairs.split('\n').filter((item) => item.trim())) {
        const index = line.indexOf('=');
        if (index < 1 || !line.slice(0, index).trim())
          throw new Error(t('settings.mcp.multi.invalidPairs'));
        values[line.slice(0, index).trim()] = line.slice(index + 1);
      }
      if (kind === 'http') {
        const url = new URL(endpoint.trim());
        if (!['http:', 'https:'].includes(url.protocol))
          throw new Error(t('settings.mcp.multi.invalidUrl'));
      }
      const server: JsonValue =
        kind === 'http'
          ? { type: 'http', url: endpoint.trim(), headers: values }
          : {
              command: endpoint.trim(),
              args: args.split('\n').filter((item) => item.trim()),
              env: values,
            };
      const targets = [
        claude && BaseCodingAgent.CLAUDE_CODE,
        codex && BaseCodingAgent.CODEX,
      ].filter((item): item is BaseCodingAgent => !!item);
      if (!client) throw new Error('Machine client unavailable');
      const existing = await Promise.all(
        targets.map((executor) => client.loadMcpServers({ executor }))
      );
      const conflict = targets.find((_, index) =>
        Object.hasOwn(existing[index].mcp_config.servers, name.trim())
      );
      if (conflict)
        throw new Error(t('settings.mcp.multi.conflict', { target: conflict }));
      const saved: string[] = [];
      for (const target of targets) {
        try {
          await install(target, { [name.trim()]: server });
          saved.push(target);
        } catch (error) {
          throw new Error(
            t('settings.mcp.multi.partial', {
              saved: saved.join(', ') || t('settings.mcp.multi.none'),
              target,
              error: String(error),
            })
          );
        }
      }
      setMessage(t('settings.mcp.multi.saved'));
      onSaved();
    });
  const usePreset = (key: string) => {
    const server = presets[key];
    if (!server || typeof server !== 'object' || Array.isArray(server)) return;
    const http = server.type === 'http';
    setName(key);
    setKind(http ? 'http' : 'stdio');
    setEndpoint(String(http ? (server.url ?? '') : (server.command ?? '')));
    setArgs(Array.isArray(server.args) ? server.args.join('\n') : '');
    const object = http ? server.headers : server.env;
    setPairs(
      object && typeof object === 'object' && !Array.isArray(object)
        ? Object.entries(object)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : ''
    );
  };
  return (
    <SettingsCard
      title={t('settings.mcp.multi.title')}
      description={t('settings.mcp.multi.description')}
    >
      <SettingsField label={t('settings.mcp.multi.popular')}>
        <select
          aria-label={t('settings.mcp.multi.popular')}
          className="w-full bg-secondary border border-border rounded-sm p-2"
          defaultValue=""
          onChange={(event) => usePreset(event.target.value)}
        >
          <option value="">{t('settings.mcp.multi.choose')}</option>
          {Object.keys(presets)
            .filter((key) => key !== 'meta')
            .map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
        </select>
      </SettingsField>
      <SettingsField label={t('settings.mcp.multi.name')}>
        <SettingsInput
          ariaLabel={t('settings.mcp.multi.name')}
          value={name}
          onChange={setName}
          placeholder={t('settings.mcp.multi.namePlaceholder')}
        />
      </SettingsField>
      <SettingsField label={t('settings.mcp.multi.transport')}>
        <select
          aria-label={t('settings.mcp.multi.transport')}
          value={kind}
          onChange={(event) => setKind(event.target.value as 'http' | 'stdio')}
          className="w-full bg-secondary border border-border rounded-sm p-2"
        >
          <option value="http">HTTP</option>
          <option value="stdio">stdio</option>
        </select>
      </SettingsField>
      <SettingsField
        label={kind === 'http' ? 'URL' : t('settings.mcp.multi.command')}
      >
        <SettingsInput
          ariaLabel={kind === 'http' ? 'URL' : t('settings.mcp.multi.command')}
          value={endpoint}
          onChange={setEndpoint}
          placeholder={
            kind === 'http'
              ? 'https://example.com/mcp'
              : t('settings.mcp.multi.command')
          }
        />
      </SettingsField>
      {kind === 'stdio' && (
        <SettingsField
          label={t('settings.mcp.multi.arguments')}
          description={t('settings.mcp.multi.argumentHint')}
        >
          <SettingsTextarea
            ariaLabel={t('settings.mcp.multi.arguments')}
            value={args}
            onChange={setArgs}
            rows={3}
          />
        </SettingsField>
      )}
      <SettingsField
        label={t(
          kind === 'http'
            ? 'settings.mcp.multi.headers'
            : 'settings.mcp.multi.environment'
        )}
        description={t('settings.mcp.multi.pairsHint')}
      >
        <SettingsTextarea
          ariaLabel={t(
            kind === 'http'
              ? 'settings.mcp.multi.headers'
              : 'settings.mcp.multi.environment'
          )}
          value={pairs}
          onChange={setPairs}
          rows={3}
        />
      </SettingsField>
      <SettingsCheckbox
        id="mcp-target-claude"
        label="Claude Code"
        checked={claude}
        onChange={setClaude}
      />
      <SettingsCheckbox
        id="mcp-target-codex"
        label="Codex"
        checked={codex}
        onChange={setCodex}
      />
      <button
        type="button"
        disabled={busy || disabled}
        onClick={add}
        className="rounded-sm bg-brand px-4 py-2 text-white disabled:opacity-50"
      >
        {t('settings.mcp.multi.title')}
      </button>
      {disabled && (
        <p className="text-sm text-warning">{t('settings.mcp.multi.dirty')}</p>
      )}
      <div className="border-t border-border pt-4 space-y-2">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={loadSync}
          className="rounded-sm border border-border px-4 py-2 disabled:opacity-50"
        >
          {t('settings.mcp.multi.sync')}
        </button>
        <p className="text-sm text-low">{t('settings.mcp.multi.oauth')}</p>
        {missing && (
          <>
            <p className="text-sm text-low">
              {t('settings.mcp.multi.duplicates', {
                names: duplicates.join(', ') || t('settings.mcp.multi.none'),
              })}
            </p>
            {Object.keys(missing).length === 0 && (
              <p>{t('settings.mcp.multi.noMissing')}</p>
            )}
            {Object.keys(missing).map((key) => (
              <SettingsCheckbox
                key={key}
                id={`sync-${key}`}
                label={key}
                checked={selected.includes(key)}
                onChange={(checked) =>
                  setSelected(
                    checked
                      ? [...selected, key]
                      : selected.filter((item) => item !== key)
                  )
                }
              />
            ))}
            <button
              type="button"
              disabled={busy || selected.length === 0}
              className="rounded-sm bg-brand px-4 py-2 text-white disabled:opacity-50"
              onClick={() =>
                run(async () => {
                  await install(
                    BaseCodingAgent.CODEX,
                    Object.fromEntries(
                      selected.map((key) => [
                        key,
                        removeMcpOAuthSecrets(missing[key]),
                      ])
                    )
                  );
                  setMessage(t('settings.mcp.multi.copied'));
                  setMissing(null);
                  setSelected([]);
                  onSaved();
                })
              }
            >
              {t('settings.mcp.multi.copy')}
            </button>
          </>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm text-normal">
          {message}
        </p>
      )}
    </SettingsCard>
  );
}

export function McpSettingsSection() {
  const { t } = useTranslation('settings');
  const { setDirty: setContextDirty } = useSettingsDirty();
  const machineClient = useSettingsMachineClient();
  const { config, profiles } = useUserSystem();
  const [mcpServers, setMcpServers] = useState('{}');
  const [originalMcpServers, setOriginalMcpServers] = useState('{}');
  const [mcpConfig, setMcpConfig] = useState<McpConfig | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [selectedProfile, setSelectedProfile] =
    useState<ExecutorProfile | null>(null);
  const [mcpApplying, setMcpApplying] = useState(false);
  const [mcpConfigPath, setMcpConfigPath] = useState<string>('');
  const [success, setSuccess] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const isDirty = mcpServers !== originalMcpServers;

  // Sync dirty state to context for unsaved changes confirmation
  useEffect(() => {
    setContextDirty('mcp', isDirty);
    return () => setContextDirty('mcp', false);
  }, [isDirty, setContextDirty]);

  // Initialize selected profile when config loads
  useEffect(() => {
    if (config?.executor_profile && profiles && !selectedProfile) {
      const currentProfile = profiles[config.executor_profile.executor];
      if (currentProfile) {
        setSelectedProfile(currentProfile);
      } else if (Object.keys(profiles).length > 0) {
        setSelectedProfile(Object.values(profiles)[0]);
      }
    }
  }, [config?.executor_profile, profiles, selectedProfile]);

  // Load MCP configuration when selected profile changes
  useEffect(() => {
    const loadMcpServersForProfile = async (profile: ExecutorProfile) => {
      setMcpLoading(true);
      setMcpError(null);
      setMcpConfigPath('');

      try {
        const profileKey = profiles
          ? Object.keys(profiles).find((key) => profiles[key] === profile)
          : null;
        if (!profileKey) {
          throw new Error('Profile key not found');
        }

        if (!machineClient) {
          throw new Error('Machine client is required');
        }

        const result = await machineClient.loadMcpServers({
          executor: profileKey as BaseCodingAgent,
        });
        setMcpConfig(result.mcp_config);
        const fullConfig = McpConfigStrategyGeneral.createFullConfig(
          result.mcp_config
        );
        const configJson = JSON.stringify(fullConfig, null, 2);
        setMcpServers(configJson);
        setOriginalMcpServers(configJson);
        setMcpConfigPath(result.config_path);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes('does not support MCP')
        ) {
          setMcpError(err.message);
        } else {
          console.error('Error loading MCP servers:', err);
        }
      } finally {
        setMcpLoading(false);
      }
    };

    if (selectedProfile) {
      loadMcpServersForProfile(selectedProfile);
    }
  }, [machineClient, profiles, selectedProfile, refresh]);

  const handleMcpServersChange = (value: string) => {
    setMcpServers(value);
    setMcpError(null);

    if (value.trim() && mcpConfig) {
      try {
        const parsedConfig = JSON.parse(value);
        McpConfigStrategyGeneral.validateFullConfig(mcpConfig, parsedConfig);
      } catch (err) {
        if (err instanceof SyntaxError) {
          setMcpError(t('settings.mcp.errors.invalidJson'));
        } else {
          setMcpError(
            err instanceof Error
              ? err.message
              : t('settings.mcp.errors.validationError')
          );
        }
      }
    }
  };

  const handleApplyMcpServers = async () => {
    if (!selectedProfile || !mcpConfig) return;

    setMcpApplying(true);
    setMcpError(null);

    try {
      if (mcpServers.trim()) {
        try {
          const fullConfig = JSON.parse(mcpServers);
          McpConfigStrategyGeneral.validateFullConfig(mcpConfig, fullConfig);
          const mcpServersConfig =
            McpConfigStrategyGeneral.extractServersForApi(
              mcpConfig,
              fullConfig
            );

          const selectedProfileKey = profiles
            ? Object.keys(profiles).find(
                (key) => profiles[key] === selectedProfile
              )
            : null;
          if (!selectedProfileKey) {
            throw new Error('Selected profile key not found');
          }

          if (!machineClient) {
            throw new Error('Machine client is required');
          }

          await machineClient.saveMcpServers(
            {
              executor: selectedProfileKey as BaseCodingAgent,
            },
            { servers: mcpServersConfig }
          );

          setOriginalMcpServers(mcpServers);
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        } catch (mcpErr) {
          if (mcpErr instanceof SyntaxError) {
            setMcpError(t('settings.mcp.errors.invalidJson'));
          } else {
            setMcpError(
              mcpErr instanceof Error
                ? mcpErr.message
                : t('settings.mcp.errors.saveFailed')
            );
          }
        }
      }
    } catch (err) {
      setMcpError(t('settings.mcp.errors.applyFailed'));
      console.error('Error applying MCP servers:', err);
    } finally {
      setMcpApplying(false);
    }
  };

  const handleDiscard = () => {
    setMcpServers(originalMcpServers);
    setMcpError(null);
  };

  const addServer = (key: string) => {
    try {
      const existing = mcpServers.trim() ? JSON.parse(mcpServers) : {};
      const updated = McpConfigStrategyGeneral.addPreconfiguredToConfig(
        mcpConfig!,
        existing,
        key
      );
      setMcpServers(JSON.stringify(updated, null, 2));
      setMcpError(null);
    } catch (err) {
      console.error(err);
      setMcpError(
        err instanceof Error
          ? err.message
          : t('settings.mcp.errors.addServerFailed')
      );
    }
  };

  const preconfiguredObj = (mcpConfig?.preconfigured ?? {}) as Record<
    string,
    unknown
  >;
  const meta =
    typeof preconfiguredObj.meta === 'object' && preconfiguredObj.meta !== null
      ? (preconfiguredObj.meta as Record<
          string,
          { name?: string; description?: string; url?: string; icon?: string }
        >)
      : {};
  const servers = Object.fromEntries(
    Object.entries(preconfiguredObj).filter(([k]) => k !== 'meta')
  ) as Record<string, unknown>;
  const getMetaFor = (key: string) => meta[key] || {};

  const profileOptions = profiles
    ? Object.keys(profiles)
        .sort()
        .map((key) => ({ value: key, label: toPrettyCase(key) }))
    : [];

  const selectedProfileKey = selectedProfile
    ? Object.keys(profiles || {}).find(
        (key) => profiles![key] === selectedProfile
      ) || ''
    : '';

  if (!config) {
    return (
      <div className="py-8">
        <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error">
          {t('settings.mcp.errors.loadFailed')}
        </div>
      </div>
    );
  }

  return (
    <>
      <MultiCliMcp
        disabled={isDirty}
        onSaved={() => setRefresh((value) => value + 1)}
      />
      {/* Status messages */}
      {mcpError && !mcpError.includes('does not support MCP') && (
        <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error">
          {t('settings.mcp.errors.mcpError', { error: mcpError })}
        </div>
      )}

      {success && (
        <div className="bg-success/10 border border-success/50 rounded-sm p-4 text-success font-medium">
          {t('settings.mcp.save.successMessage')}
        </div>
      )}

      {/* MCP Configuration */}
      <SettingsCard
        title={t('settings.mcp.title')}
        description={t('settings.mcp.description')}
      >
        <SettingsField
          label={t('settings.mcp.labels.agent')}
          description={t('settings.mcp.labels.agentHelper')}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <DropdownMenuTriggerButton
                label={
                  selectedProfileKey
                    ? toPrettyCase(selectedProfileKey)
                    : t('settings.mcp.labels.agentPlaceholder')
                }
                className="w-full justify-between"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
              {profileOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => {
                    const profile = profiles?.[option.value];
                    if (profile) setSelectedProfile(profile);
                  }}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingsField>

        {mcpError && mcpError.includes('does not support MCP') ? (
          <div className="rounded-sm border border-warning/50 bg-warning/10 p-4">
            <h3 className="text-sm font-medium text-warning">
              {t('settings.mcp.errors.notSupported')}
            </h3>
            <div className="mt-2 text-sm text-low">
              <p>{mcpError}</p>
              <p className="mt-1">{t('settings.mcp.errors.supportMessage')}</p>
            </div>
          </div>
        ) : (
          <>
            <SettingsField
              label={t('settings.mcp.labels.serverConfig')}
              description={
                mcpLoading ? (
                  t('settings.mcp.loadingStates.configuration')
                ) : (
                  <>
                    {t('settings.mcp.labels.saveLocation')}
                    {mcpConfigPath && (
                      <span className="ml-2 font-mono text-xs">
                        {mcpConfigPath}
                      </span>
                    )}
                  </>
                )
              }
            >
              <SettingsTextarea
                value={
                  mcpLoading
                    ? t('settings.mcp.loadingStates.jsonEditor')
                    : mcpServers
                }
                onChange={handleMcpServersChange}
                disabled={mcpLoading}
                rows={14}
                placeholder='{\n  "server-name": {\n    "type": "stdio",\n    "command": "your-command",\n    "args": ["arg1", "arg2"]\n  }\n}'
              />
            </SettingsField>

            {/* Preconfigured servers */}
            {mcpConfig?.preconfigured &&
              typeof mcpConfig.preconfigured === 'object' &&
              Object.keys(servers).length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-normal">
                    {t('settings.mcp.labels.popularServers')}
                  </label>
                  <p className="text-sm text-low">
                    {t('settings.mcp.labels.serverHelper')}
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(servers).map(([key]) => {
                      const metaObj = getMetaFor(key) as {
                        name?: string;
                        description?: string;
                        icon?: string;
                      };
                      const name = metaObj.name || key;
                      const description =
                        metaObj.description || 'No description';
                      const icon = metaObj.icon ? `/${metaObj.icon}` : null;

                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => addServer(key)}
                          className={cn(
                            'flex items-start gap-3 p-3 rounded-sm border border-border/50 bg-secondary/30',
                            'hover:bg-secondary hover:border-border transition-colors text-left'
                          )}
                        >
                          <div className="w-6 h-6 rounded-sm border border-border bg-secondary flex items-center justify-center overflow-hidden shrink-0">
                            {icon ? (
                              <img
                                src={icon}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-xs font-semibold text-normal">
                                {name.slice(0, 1).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-normal truncate">
                              {name}
                            </div>
                            <div className="text-xs text-low line-clamp-2">
                              {description}
                            </div>
                          </div>
                          <PlusIcon
                            className="size-icon-xs text-low shrink-0"
                            weight="bold"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
          </>
        )}
      </SettingsCard>

      <SettingsSaveBar
        show={isDirty && !mcpError?.includes('does not support MCP')}
        saving={mcpApplying}
        saveDisabled={!!mcpError}
        onSave={handleApplyMcpServers}
        onDiscard={handleDiscard}
      />
    </>
  );
}

// Alias for backwards compatibility
export { McpSettingsSection as McpSettingsSectionContent };
