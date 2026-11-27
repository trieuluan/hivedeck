import { useTranslation } from 'react-i18next';
import { TerminalIcon, WarningIcon } from '@phosphor-icons/react';
import {
  BaseCodingAgent,
  type ComboRole,
  type NineRouterSettings,
  type NineRouterStatus,
  type RoleCombos,
} from 'shared/types';
import { Switch } from '@vibe/ui/components/Switch';
import {
  SettingsCheckbox,
  SettingsSelect,
} from '@/shared/dialogs/settings/settings/SettingsComponents';
import { AgentIcon } from '@/shared/components/AgentIcon';
import { isAgentBypassed } from '@/shared/lib/hiveRouterRouting';
import { cn } from '@/shared/lib/utils';

const ROLES: ComboRole[] = ['planner', 'coder', 'reviewer', 'fast'];
/** Select value for "leave this role on the agent's own default model". */
const NONE = '__none__';

interface CliRoutingEntry {
  agent: BaseCodingAgent;
  label: string;
  cmd: string;
  directOnly?: boolean;
  isNew?: boolean;
  directHint: string;
}

const CLI_ROUTING_ENTRIES: CliRoutingEntry[] = [
  {
    agent: BaseCodingAgent.CLAUDE_CODE,
    label: 'Claude Code',
    cmd: 'claude',
    directHint: 'Direct · Anthropic OAuth / API Key',
  },
  {
    agent: BaseCodingAgent.CODEX,
    label: 'OpenAI Codex',
    cmd: 'codex',
    directHint: 'Direct · ChatGPT / OpenAI API',
  },
  {
    agent: BaseCodingAgent.GEMINI,
    label: 'Gemini CLI',
    cmd: 'gemini',
    directHint: 'Direct · Official OAuth / API Key',
  },
  {
    agent: BaseCodingAgent.ANTIGRAVITY,
    label: 'Antigravity CLI',
    cmd: 'agy',
    directOnly: true,
    isNew: true,
    directHint: 'Direct · Antigravity quota (no proxy)',
  },
  {
    agent: BaseCodingAgent.OPENCODE,
    label: 'OpenCode',
    cmd: 'opencode',
    directHint: 'Direct · Native OpenCode config',
  },
  {
    agent: BaseCodingAgent.QWEN_CODE,
    label: 'Qwen Code',
    cmd: 'qwen',
    directHint: 'Direct · Native Qwen config',
  },
  {
    agent: BaseCodingAgent.DROID,
    label: 'Droid',
    cmd: 'droid',
    directHint: 'Direct · Native Droid config',
  },
  {
    agent: BaseCodingAgent.CURSOR_AGENT,
    label: 'Cursor Agent',
    cmd: 'cursor-agent',
    directOnly: true,
    directHint: 'Direct · Cursor account (no proxy)',
  },
  {
    agent: BaseCodingAgent.COPILOT,
    label: 'GitHub Copilot',
    cmd: 'copilot',
    directOnly: true,
    directHint: 'Direct · GitHub Copilot (no proxy)',
  },
  {
    agent: BaseCodingAgent.AMP,
    label: 'Amp',
    cmd: 'amp',
    directOnly: true,
    directHint: 'Direct · Sourcegraph Amp (no proxy)',
  },
];

/** Fill unset roles with a combo of the same name when one exists. */
function withDefaultRoles(roles: RoleCombos, combos: string[]): RoleCombos {
  const next = { ...roles };
  for (const role of ROLES) {
    if (!next[role] && combos.includes(role)) next[role] = role;
  }
  return next;
}

export function RoutingView({
  status,
  settings,
  onSave,
}: {
  status: NineRouterStatus;
  settings: NineRouterSettings;
  onSave: (next: NineRouterSettings) => void;
}) {
  const { t } = useTranslation('settings');
  const combos = status.combos;
  const up = status.state === 'running' || status.state === 'external';
  const usedFor: Record<ComboRole, string> = {
    planner: t('settings.router.routing.usedFor.planner'),
    coder: t('settings.router.routing.usedFor.coder'),
    reviewer: t('settings.router.routing.usedFor.reviewer'),
    fast: t('settings.router.routing.usedFor.fast'),
  };

  const setEnabled = (enabled: boolean) =>
    onSave({
      ...settings,
      route_agents: enabled,
      roles: enabled
        ? withDefaultRoles(settings.roles, combos)
        : settings.roles,
    });

  const setRole = (role: ComboRole, value: string) =>
    onSave({
      ...settings,
      roles: { ...settings.roles, [role]: value === NONE ? null : value },
    });

  const setCliRouted = (agent: BaseCodingAgent, routed: boolean) => {
    const current = new Set(settings.bypassed_agents ?? []);
    if (routed) {
      current.delete(agent);
    } else {
      current.add(agent);
    }
    onSave({
      ...settings,
      bypassed_agents: Array.from(current),
    });
  };

  const options = [
    { value: NONE, label: t('settings.router.routing.agentDefault') },
    ...combos.map((c) => ({ value: c, label: c })),
  ];

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl space-y-double p-base">
        <section className="space-y-3">
          <SettingsCheckbox
            id="nine-router-route-agents"
            label={t('settings.router.routing.enable')}
            description={t('settings.router.routing.enableHint')}
            checked={settings.route_agents}
            onChange={setEnabled}
          />
          {settings.route_agents && !up && (
            <p className="flex items-center gap-2 text-sm text-warning">
              <WarningIcon className="size-icon-xs shrink-0" weight="fill" />
              {t('settings.router.routing.notRunning')}
            </p>
          )}
        </section>

        <section
          aria-labelledby="routing-roles"
          className={cn('space-y-2', !settings.route_agents && 'opacity-60')}
        >
          <h3 id="routing-roles" className="text-sm font-semibold text-high">
            {t('settings.router.routing.roles')}
          </h3>
          <ul className="divide-y divide-border/60 rounded-sm border border-border">
            {ROLES.map((role) => {
              const value = settings.roles[role];
              const missing = !!value && up && !combos.includes(value);
              return (
                <li
                  key={role}
                  className="grid grid-cols-[minmax(0,1fr)_14rem] items-center gap-base px-base py-3 max-md:grid-cols-1"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-semibold text-high">
                      {role}
                    </div>
                    <p className="text-xs text-low">{usedFor[role]}</p>
                    {missing && (
                      <p className="mt-1 text-xs text-error">
                        {t('settings.router.routing.missingCombo', {
                          name: value,
                        })}
                      </p>
                    )}
                  </div>
                  <SettingsSelect
                    value={value ?? NONE}
                    options={
                      value && !combos.includes(value)
                        ? [...options, { value, label: value }]
                        : options
                    }
                    onChange={(v) => setRole(role, v)}
                    disabled={!settings.route_agents}
                  />
                </li>
              );
            })}
          </ul>
          {combos.length === 0 && up && (
            <p className="text-xs text-low">
              {t('settings.router.routing.noCombos')}
            </p>
          )}
        </section>

        <section
          aria-labelledby="cli-routing-bypass"
          className={cn('space-y-2', !settings.route_agents && 'opacity-60')}
        >
          <div className="space-y-0.5">
            <h3
              id="cli-routing-bypass"
              className="text-sm font-semibold text-high"
            >
              CLI Routing (Bypass Control)
            </h3>
            <p className="text-xs text-low">
              Choose which coding CLIs route through HiveRouter. Turn off to
              connect directly to the official provider and avoid proxy OAuth
              bans.
            </p>
          </div>
          <ul className="divide-y divide-border/60 rounded-sm border border-border">
            {CLI_ROUTING_ENTRIES.map((entry) => {
              const isRouted =
                !entry.directOnly &&
                settings.route_agents &&
                !isAgentBypassed(entry.agent, settings.bypassed_agents);
              const toggleDisabled =
                entry.directOnly || !settings.route_agents;

              return (
                <li
                  key={entry.agent}
                  className={cn(
                    'flex items-center justify-between gap-base px-base py-2.5',
                    entry.isNew && 'bg-brand/5'
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded border border-border/70 bg-secondary/60">
                      <AgentIcon agent={entry.agent} className="size-3.5" />
                      {entry.agent === BaseCodingAgent.ANTIGRAVITY && (
                        <TerminalIcon className="size-3.5 text-brand" />
                      )}
                    </span>
                    <span className="truncate text-sm font-medium text-high">
                      {entry.label}
                    </span>
                    <code className="rounded border border-border/70 bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-low">
                      {entry.cmd}
                    </code>
                    {entry.isNew && (
                      <span className="rounded border border-brand/40 bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                        NEW
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={cn(
                        'hidden rounded border px-2 py-0.5 text-xs sm:inline-block',
                        isRouted
                          ? 'border-brand/40 bg-brand/15 text-brand'
                          : 'border-border/70 bg-secondary/60 text-low'
                      )}
                    >
                      {isRouted ? 'Via HiveRouter' : entry.directHint}
                    </span>
                    <Switch
                      checked={isRouted}
                      disabled={toggleDisabled}
                      aria-label={`Route ${entry.label} through HiveRouter`}
                      onCheckedChange={(checked) =>
                        setCliRouted(entry.agent, checked)
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-low">
            CLIs set to Direct ignore HiveRouter base URLs and role combos,
            using their native authentication instead.
          </p>
        </section>

        <section className="space-y-1 text-xs text-low">
          <p>{t('settings.router.routing.scope')}</p>
          <p>{t('settings.router.routing.precedence')}</p>
        </section>
      </div>
    </div>
  );
}
