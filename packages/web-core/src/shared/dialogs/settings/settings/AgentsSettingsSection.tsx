import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  SpinnerIcon,
  PlusIcon,
  TrashIcon,
  DotsThreeIcon,
  StarIcon,
  ArrowsClockwiseIcon,
} from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@vibe/ui/components/Dropdown';
import { ExecutorConfigForm } from './ExecutorConfigForm';
import { useMachineProfiles } from '@/shared/hooks/useProfiles';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { CreateConfigurationDialog } from '../CreateConfigurationDialog';
import { DeleteConfigurationDialog } from '../DeleteConfigurationDialog';
import type {
  BaseCodingAgent,
  CliStatusInfo,
  ExecutorConfigs,
} from 'shared/types';
import { cn } from '@/shared/lib/utils';
import { toPrettyCase } from '@/shared/lib/string';
import { configApi } from '@/shared/lib/api';
import {
  isAgentBypassed,
  isRoutedExecutor,
} from '@/shared/lib/hiveRouterRouting';
import {
  SettingsSaveBar,
  TwoColumnPicker,
  TwoColumnPickerColumn,
  TwoColumnPickerItem,
  TwoColumnPickerBadge,
  TwoColumnPickerEmpty,
} from './SettingsComponents';
import { useSettingsDirty } from './SettingsDirtyContext';
import { useSettingsMachineClient } from './SettingsHostContext';
import { AgentIcon, getAgentName } from '@/shared/components/AgentIcon';
import { getExecutorVariantKeys } from '@/shared/lib/executor';

type ExecutorsMap = Record<string, Record<string, Record<string, unknown>>>;

function canonicalCliAgent(agent: BaseCodingAgent): BaseCodingAgent {
  if (agent === 'CLAUDE_CODE_HEADED') return 'CLAUDE_CODE' as BaseCodingAgent;
  if (agent === 'OPENCODE_HEADED') return 'OPENCODE' as BaseCodingAgent;
  return agent;
}

export function AgentsSettingsSection() {
  const { t } = useTranslation(['settings', 'common']);
  const { setDirty: setContextDirty } = useSettingsDirty();
  const machineClient = useSettingsMachineClient();

  // Profiles hook for server state
  const {
    profilesContent: serverProfilesContent,
    isLoading: profilesLoading,
    isSaving: profilesSaving,
    error: profilesError,
    save: saveProfiles,
  } = useMachineProfiles(machineClient);

  const { config, updateAndSaveConfig, reloadSystem } = useUserSystem();

  // Local editor state
  const [profilesSuccess, setProfilesSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form-based editor state
  const [selectedExecutorType, setSelectedExecutorType] =
    useState<BaseCodingAgent | null>(null);
  const [selectedConfiguration, setSelectedConfiguration] = useState<
    string | null
  >(null);
  const [localParsedProfiles, setLocalParsedProfiles] =
    useState<ExecutorConfigs | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const {
    data: cliStatuses,
    isFetching: cliStatusFetching,
    refetch: refetchCliStatuses,
  } = useQuery({
    queryKey: ['agents', 'cli-status'],
    queryFn: configApi.getCliStatuses,
    staleTime: 15_000,
  });
  const [cliActionBusy, setCliActionBusy] = useState<string | null>(null);
  const [cliActionNotice, setCliActionNotice] = useState<{
    agent: BaseCodingAgent;
    ok: boolean;
    message: string;
  } | null>(null);

  const cliStatusMap = useMemo(() => {
    const map = new Map<BaseCodingAgent, CliStatusInfo>();
    for (const s of cliStatuses ?? []) {
      map.set(s.agent, s);
    }
    return map;
  }, [cliStatuses]);

  const isExecutorRouted = (agent: BaseCodingAgent) =>
    isRoutedExecutor(agent) &&
    Boolean(config?.nine_router?.route_agents) &&
    !isAgentBypassed(agent, config?.nine_router?.bypassed_agents);

  const handleInstallCli = async (agent: BaseCodingAgent) => {
    setCliActionBusy(`install:${agent}`);
    setCliActionNotice(null);
    try {
      const res = await configApi.installCli(agent);
      setCliActionNotice({ agent, ok: res.ok, message: res.message });
      await refetchCliStatuses();
    } catch (err) {
      setCliActionNotice({
        agent,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCliActionBusy(null);
    }
  };

  const handleLoginCli = async (agent: BaseCodingAgent) => {
    setCliActionBusy(`login:${agent}`);
    setCliActionNotice(null);
    try {
      const res = await configApi.loginCli(agent);
      setCliActionNotice({ agent, ok: res.ok, message: res.message });
    } catch (err) {
      setCliActionNotice({
        agent,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCliActionBusy(null);
    }
  };

  // Initialize selection with default executor when config loads
  useEffect(() => {
    if (config?.executor_profile && !selectedExecutorType) {
      setSelectedExecutorType(config.executor_profile.executor);
      setSelectedConfiguration(config.executor_profile.variant || 'DEFAULT');
    }
  }, [config?.executor_profile, selectedExecutorType]);

  // Sync server state to local state when not dirty
  useEffect(() => {
    if (!isDirty && serverProfilesContent) {
      try {
        const parsed = JSON.parse(serverProfilesContent);
        setLocalParsedProfiles(parsed);
      } catch (err) {
        console.error('Failed to parse profiles JSON:', err);
        setLocalParsedProfiles(null);
      }
    }
  }, [serverProfilesContent, isDirty]);

  // Sync dirty state to context for unsaved changes confirmation
  useEffect(() => {
    setContextDirty('agents', isDirty);
    return () => setContextDirty('agents', false);
  }, [isDirty, setContextDirty]);

  const markDirty = (nextProfiles: unknown) => {
    setLocalParsedProfiles(nextProfiles as ExecutorConfigs);
    setIsDirty(true);
  };

  const handleCreateConfig = async (executor: string) => {
    try {
      const result = await CreateConfigurationDialog.show({
        executorType: executor as BaseCodingAgent,
        existingConfigs: getExecutorVariantKeys(
          localParsedProfiles?.executors?.[executor as BaseCodingAgent]
        ),
      });

      if (result.action === 'created' && result.configName) {
        createConfiguration(executor, result.configName, result.cloneFrom);
      }
    } catch {
      // User cancelled
    }
  };

  const createConfiguration = (
    executorType: string,
    configName: string,
    baseConfig?: string | null
  ) => {
    if (!localParsedProfiles || !localParsedProfiles.executors) return;

    const executorsMap =
      localParsedProfiles.executors as unknown as ExecutorsMap;
    const base =
      baseConfig && executorsMap[executorType]?.[baseConfig]?.[executorType]
        ? executorsMap[executorType][baseConfig][executorType]
        : {};

    const updatedProfiles = {
      ...localParsedProfiles,
      executors: {
        ...localParsedProfiles.executors,
        [executorType]: {
          ...executorsMap[executorType],
          [configName]: {
            [executorType]: base,
          },
        },
      },
    };

    markDirty(updatedProfiles);
    setSelectedExecutorType(executorType as BaseCodingAgent);
    setSelectedConfiguration(configName);
  };

  const handleDeleteConfig = async (executor: string, configName: string) => {
    try {
      const result = await DeleteConfigurationDialog.show({
        configName,
        executorType: executor as BaseCodingAgent,
      });

      if (result === 'deleted') {
        await deleteConfiguration(executor, configName);
      }
    } catch {
      // User cancelled
    }
  };

  const deleteConfiguration = async (
    executorType: string,
    configToDelete: string
  ) => {
    if (!localParsedProfiles) return;

    setSaveError(null);

    try {
      const executorConfigs =
        localParsedProfiles.executors[executorType as BaseCodingAgent];
      if (!executorConfigs?.[configToDelete]) {
        return;
      }

      const currentConfigs = getExecutorVariantKeys(executorConfigs);
      if (currentConfigs.length <= 1) {
        return;
      }

      const remainingConfigs = { ...executorConfigs };
      delete remainingConfigs[configToDelete];

      const updatedProfiles = {
        ...localParsedProfiles,
        executors: {
          ...localParsedProfiles.executors,
          [executorType]: remainingConfigs,
        },
      };

      const executorsMap = updatedProfiles.executors as unknown as ExecutorsMap;
      if (getExecutorVariantKeys(remainingConfigs).length === 0) {
        executorsMap[executorType] = {
          DEFAULT: { [executorType]: {} },
        };
      }

      try {
        await saveProfiles(JSON.stringify(updatedProfiles, null, 2));
        setLocalParsedProfiles(updatedProfiles);
        setIsDirty(false);

        // Select another config if we deleted the selected one
        if (
          selectedExecutorType === executorType &&
          selectedConfiguration === configToDelete
        ) {
          const nextConfigs = getExecutorVariantKeys(
            executorsMap[executorType] || {}
          );
          setSelectedConfiguration(nextConfigs[0] || 'DEFAULT');
        }

        setProfilesSuccess(true);
        setTimeout(() => setProfilesSuccess(false), 3000);
        reloadSystem();
      } catch (error: unknown) {
        console.error('Failed to save deletion to backend:', error);
        setSaveError(t('settings.agents.errors.deleteFailed'));
      }
    } catch (error) {
      console.error('Error deleting configuration:', error);
    }
  };

  const handleMakeDefault = async (executor: string, config: string) => {
    try {
      await updateAndSaveConfig({
        executor_profile: {
          executor: executor as BaseCodingAgent,
          variant: config,
        },
      });
      reloadSystem();
    } catch (err) {
      console.error('Error setting default:', err);
    }
  };

  const handleExecutorConfigChange = (
    executorType: string,
    configuration: string,
    formData: unknown
  ) => {
    if (!localParsedProfiles || !localParsedProfiles.executors) return;

    const executorsMap =
      localParsedProfiles.executors as unknown as ExecutorsMap;
    const updatedProfiles = {
      ...localParsedProfiles,
      executors: {
        ...localParsedProfiles.executors,
        [executorType]: {
          ...executorsMap[executorType],
          [configuration]: {
            [executorType]: formData,
          },
        },
      },
    };

    markDirty(updatedProfiles);
  };

  const handleExecutorConfigSave = async (formData: unknown) => {
    if (
      !localParsedProfiles ||
      !localParsedProfiles.executors ||
      !selectedExecutorType ||
      !selectedConfiguration
    )
      return;

    setSaveError(null);

    const updatedProfiles = {
      ...localParsedProfiles,
      executors: {
        ...localParsedProfiles.executors,
        [selectedExecutorType]: {
          ...localParsedProfiles.executors[selectedExecutorType],
          [selectedConfiguration]: {
            [selectedExecutorType]: formData,
          },
        },
      },
    };

    setLocalParsedProfiles(updatedProfiles);

    try {
      await saveProfiles(JSON.stringify(updatedProfiles, null, 2));
      setProfilesSuccess(true);
      setIsDirty(false);
      setTimeout(() => setProfilesSuccess(false), 3000);
      reloadSystem();
    } catch (err: unknown) {
      console.error('Failed to save profiles:', err);
      setSaveError(t('settings.agents.errors.saveConfigFailed'));
    }
  };

  // Save handler for agent configuration
  const handleSave = async () => {
    if (
      isDirty &&
      localParsedProfiles &&
      selectedExecutorType &&
      selectedConfiguration
    ) {
      const executorsMap =
        localParsedProfiles.executors as unknown as ExecutorsMap;
      const formData =
        executorsMap[selectedExecutorType]?.[selectedConfiguration]?.[
          selectedExecutorType
        ];
      if (formData) {
        await handleExecutorConfigSave(formData);
      }
    }
  };

  // Discard handler for agent configuration
  const handleDiscard = () => {
    if (isDirty && serverProfilesContent) {
      setIsDirty(false);
      try {
        const parsed = JSON.parse(serverProfilesContent);
        setLocalParsedProfiles(parsed);
      } catch {
        // Ignore parse errors on discard
      }
    }
  };

  if (profilesLoading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2">
        <SpinnerIcon
          className="size-icon-lg animate-spin text-brand"
          weight="bold"
        />
        <span className="text-normal">{t('settings.agents.loading')}</span>
      </div>
    );
  }

  const executorsMap =
    localParsedProfiles?.executors as unknown as ExecutorsMap;

  return (
    <>
      {/* Status messages */}
      {!!profilesError && (
        <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error mb-4">
          {profilesError instanceof Error
            ? profilesError.message
            : String(profilesError)}
        </div>
      )}

      {profilesSuccess && (
        <div className="bg-success/10 border border-success/50 rounded-sm p-4 text-success font-medium mb-4">
          {t('settings.agents.save.success')}
        </div>
      )}

      {saveError && (
        <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error mb-4">
          {saveError}
        </div>
      )}

      {localParsedProfiles?.executors ? (
        /* Two-column layout: agents and variants on top, config form below */
        <div className="space-y-4">
          {/* Two-column selector - Finder-like style, stacked on mobile */}
          <TwoColumnPicker>
            {/* Agents column */}
            <TwoColumnPickerColumn
              label={t('settings.agents.editor.agentLabel')}
              isFirst
            >
              {Object.keys(localParsedProfiles.executors).map((executor) => {
                const agentKey = executor as BaseCodingAgent;
                const isDefault =
                  config?.executor_profile?.executor === executor;
                const status = cliStatusMap.get(canonicalCliAgent(agentKey));
                const routed = isExecutorRouted(agentKey);
                const ready =
                  status &&
                  (routed
                    ? status.installed
                    : status.installed &&
                      (status.install_mode === 'npx' || status.logged_in));
                return (
                  <TwoColumnPickerItem
                    key={executor}
                    selected={selectedExecutorType === executor}
                    onClick={() => {
                      setSelectedExecutorType(agentKey);
                      const configs = getExecutorVariantKeys(
                        localParsedProfiles.executors[agentKey]
                      );
                      if (configs.length > 0) {
                        setSelectedConfiguration(configs[0]);
                      }
                    }}
                    leading={
                      <AgentIcon
                        agent={agentKey}
                        className="size-icon-sm shrink-0"
                      />
                    }
                    trailing={
                      <span className="flex items-center gap-1.5">
                        {isDefault && (
                          <TwoColumnPickerBadge variant="brand">
                            {t('settings.agents.editor.isDefault')}
                          </TwoColumnPickerBadge>
                        )}
                        {status && (
                          <span
                            title={
                              routed
                                ? 'Via HiveRouter'
                                : !status.installed
                                  ? 'Not installed'
                                  : status.logged_in
                                    ? 'Logged in'
                                    : 'Not signed in'
                            }
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              ready ? 'bg-success' : 'bg-warning'
                            )}
                          />
                        )}
                      </span>
                    }
                  >
                    {toPrettyCase(executor)}
                  </TwoColumnPickerItem>
                );
              })}
            </TwoColumnPickerColumn>

            {/* Variants column */}
            <TwoColumnPickerColumn
              label={t('settings.agents.editor.configLabel')}
              headerAction={
                selectedExecutorType && (
                  <button
                    className="p-half rounded-sm hover:bg-secondary text-low hover:text-normal"
                    onClick={() => handleCreateConfig(selectedExecutorType)}
                    disabled={profilesSaving}
                    title={t('settings.agents.editor.createNew')}
                  >
                    <PlusIcon className="size-icon-2xs" weight="bold" />
                  </button>
                )
              }
            >
              {selectedExecutorType &&
              localParsedProfiles.executors[selectedExecutorType] ? (
                getExecutorVariantKeys(
                  localParsedProfiles.executors[selectedExecutorType]
                ).map((configName) => {
                  const isDefault =
                    config?.executor_profile?.executor ===
                      selectedExecutorType &&
                    config?.executor_profile?.variant === configName;
                  const configCount = getExecutorVariantKeys(
                    localParsedProfiles.executors[selectedExecutorType]
                  ).length;
                  return (
                    <TwoColumnPickerItem
                      key={configName}
                      selected={selectedConfiguration === configName}
                      onClick={() => setSelectedConfiguration(configName)}
                      trailing={
                        <>
                          {isDefault && (
                            <TwoColumnPickerBadge variant="brand">
                              {t('settings.agents.editor.isDefault')}
                            </TwoColumnPickerBadge>
                          )}
                          <ConfigActionsDropdown
                            executorType={selectedExecutorType}
                            configName={configName}
                            isDefault={isDefault}
                            configCount={configCount}
                            onMakeDefault={handleMakeDefault}
                            onDelete={handleDeleteConfig}
                          />
                        </>
                      }
                    >
                      {toPrettyCase(configName)}
                    </TwoColumnPickerItem>
                  );
                })
              ) : (
                <TwoColumnPickerEmpty>
                  {t('settings.agents.selectAgent')}
                </TwoColumnPickerEmpty>
              )}
            </TwoColumnPickerColumn>
          </TwoColumnPicker>

          {/* Config form */}
          {selectedExecutorType && selectedConfiguration && (
            <div className="bg-secondary/50 border border-border rounded-sm p-4">
              {(() => {
                const canonical = canonicalCliAgent(selectedExecutorType);
                const status = cliStatusMap.get(canonical);
                if (!status) return null;
                const routed = isExecutorRouted(selectedExecutorType);
                const installing = cliActionBusy === `install:${canonical}`;
                const loggingIn = cliActionBusy === `login:${canonical}`;
                const label = getAgentName(selectedExecutorType);
                const needsInstall =
                  status.install_mode === 'binary' && !status.installed;

                return (
                  <div className="mb-4 space-y-2 border-b border-border/60 pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-high">
                          <span
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              needsInstall || (!routed && !status.logged_in)
                                ? 'bg-warning'
                                : 'bg-success'
                            )}
                          />
                          {needsInstall ? (
                            <span>
                              {label} (
                              <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">
                                {status.binary_name}
                              </code>
                              ) not installed
                            </span>
                          ) : routed ? (
                            <span>Routed via HiveRouter</span>
                          ) : status.logged_in ? (
                            <span>Logged in</span>
                          ) : (
                            <span>
                              {status.install_mode === 'npx'
                                ? 'Ready · npx (not signed in)'
                                : 'Installed · Not signed in'}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-low">
                          {needsInstall
                            ? `Required to run ${label} crews in Direct mode. Installs ${status.binary_name} to ~/.local/bin.`
                            : routed
                              ? 'Uses HiveRouter providers & role combos instead of native CLI login.'
                              : status.binary_path
                                ? `Binary: ${status.binary_path}`
                                : `Managed via npx · ${status.login_command}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => refetchCliStatuses()}
                          disabled={cliStatusFetching || cliActionBusy !== null}
                          title="Refresh CLI status"
                          className="rounded border border-border bg-panel p-1.5 text-low hover:text-high disabled:opacity-50"
                        >
                          <ArrowsClockwiseIcon
                            className={cn(
                              'size-3.5',
                              cliStatusFetching && 'animate-spin'
                            )}
                          />
                        </button>
                        {needsInstall ? (
                          <button
                            type="button"
                            onClick={() => handleInstallCli(canonical)}
                            disabled={
                              !status.install_supported ||
                              cliActionBusy !== null
                            }
                            className="inline-flex items-center gap-1.5 rounded bg-brand px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {installing && (
                              <SpinnerIcon className="size-3 animate-spin" />
                            )}
                            Install {status.binary_name}
                          </button>
                        ) : (
                          <>
                            {status.install_mode === 'binary' &&
                              status.install_supported && (
                                <button
                                  type="button"
                                  onClick={() => handleInstallCli(canonical)}
                                  disabled={cliActionBusy !== null}
                                  className="inline-flex items-center gap-1 rounded border border-border bg-panel px-2.5 py-1 text-xs font-medium text-normal hover:text-high disabled:opacity-50"
                                >
                                  {installing && (
                                    <SpinnerIcon className="size-3 animate-spin" />
                                  )}
                                  Update
                                </button>
                              )}
                            <button
                              type="button"
                              onClick={() => handleLoginCli(canonical)}
                              disabled={routed || cliActionBusy !== null}
                              title={
                                routed
                                  ? 'Disabled while routed via HiveRouter. Switch to Direct in Router → Routing to use native login.'
                                  : `Open Terminal to run: ${status.login_command}`
                              }
                              className={cn(
                                'inline-flex items-center gap-1 rounded px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50',
                                status.logged_in || routed
                                  ? 'border border-border bg-panel text-normal hover:text-high'
                                  : 'bg-brand text-white hover:opacity-90'
                              )}
                            >
                              {loggingIn && (
                                <SpinnerIcon className="size-3 animate-spin" />
                              )}
                              {routed
                                ? 'Sign in'
                                : status.logged_in
                                  ? 'Re-auth'
                                  : 'Sign in'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {cliActionNotice?.agent === canonical && (
                      <p
                        className={cn(
                          'text-xs',
                          cliActionNotice.ok ? 'text-success' : 'text-error'
                        )}
                      >
                        {cliActionNotice.message}
                      </p>
                    )}
                  </div>
                );
              })()}
              <ExecutorConfigForm
                key={`${selectedExecutorType}-${selectedConfiguration}`}
                executor={selectedExecutorType}
                value={
                  (executorsMap?.[selectedExecutorType]?.[
                    selectedConfiguration
                  ]?.[selectedExecutorType] as Record<string, unknown>) || {}
                }
                onChange={(formData) =>
                  handleExecutorConfigChange(
                    selectedExecutorType,
                    selectedConfiguration,
                    formData
                  )
                }
                disabled={profilesSaving}
              />
            </div>
          )}
        </div>
      ) : null}

      <SettingsSaveBar
        show={isDirty}
        saving={profilesSaving}
        saveDisabled={!!profilesError}
        unsavedMessage={t('settings.agents.save.unsavedChanges')}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </>
  );
}

// Helper component for config actions dropdown
function ConfigActionsDropdown({
  executorType,
  configName,
  isDefault,
  configCount,
  onMakeDefault,
  onDelete,
}: {
  executorType: BaseCodingAgent;
  configName: string;
  isDefault: boolean;
  configCount: number;
  onMakeDefault: (executor: string, config: string) => void;
  onDelete: (executor: string, config: string) => void;
}) {
  const { t } = useTranslation(['settings']);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'p-half rounded-sm hover:bg-panel text-low hover:text-normal',
            'opacity-0 group-hover:opacity-100 transition-opacity'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <DotsThreeIcon className="size-icon-xs" weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onMakeDefault(executorType, configName);
          }}
          disabled={isDefault}
        >
          <div className="flex items-center gap-half w-full">
            <StarIcon className="size-icon-xs mr-base" />
            {t('settings.agents.editor.makeDefault')}
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onDelete(executorType, configName);
          }}
          disabled={configCount <= 1}
          className="text-error focus:text-error"
        >
          <div className="flex items-center gap-half w-full">
            <TrashIcon className="size-icon-xs mr-base" />
            {t('settings.agents.editor.deleteText')}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Alias for backwards compatibility
export { AgentsSettingsSection as AgentsSettingsSectionContent };
