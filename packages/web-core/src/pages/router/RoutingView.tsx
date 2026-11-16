import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@phosphor-icons/react';
import type {
  ComboRole,
  NineRouterSettings,
  NineRouterStatus,
  RoleCombos,
} from 'shared/types';
import {
  SettingsCheckbox,
  SettingsSelect,
} from '@/shared/dialogs/settings/settings/SettingsComponents';
import { cn } from '@/shared/lib/utils';

const ROLES: ComboRole[] = ['planner', 'coder', 'reviewer', 'fast'];
/** Select value for "leave this role on the agent's own default model". */
const NONE = '__none__';

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

        <section className="space-y-1 text-xs text-low">
          <p>{t('settings.router.routing.scope')}</p>
          <p>{t('settings.router.routing.precedence')}</p>
        </section>
      </div>
    </div>
  );
}
