import { useTranslation } from 'react-i18next';
import { Switch } from '@vibe/ui/components/Switch';
import { useProjects } from '@/shared/hooks/useProjects';
import { SettingsCheckbox } from '../SettingsComponents';
import type { ScopePatch } from './pluginsApi';

const ROLES = ['captain', 'crew'] as const;

type Scope = { roles: string[]; boards: string[]; enabled: boolean };

export function PluginScopeEditor({
  id,
  name,
  scope,
  disabled,
  onChange,
}: {
  id: string;
  name: string;
  scope: Scope;
  disabled?: boolean;
  onChange: (patch: ScopePatch) => void;
}) {
  const { t } = useTranslation('settings');
  const { data: boards } = useProjects();
  const toggle = (list: string[], item: string, on: boolean) =>
    on ? [...list, item] : list.filter((value) => value !== item);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch
          checked={scope.enabled}
          disabled={disabled}
          aria-label={t('settings.plugins.detail.itemEnabled', { name })}
          onCheckedChange={(enabled) => onChange({ enabled })}
        />
        <span className="text-sm text-normal break-all">{name}</span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-low underline">
          {t('settings.plugins.detail.scope')}
        </summary>
        <div className="mt-2 space-y-2 pl-2">
          <fieldset className="space-y-1">
            <legend className="text-sm text-normal">
              {t('settings.plugins.detail.roles')}
            </legend>
            {ROLES.map((role) => (
              <SettingsCheckbox
                key={role}
                id={`${id}-role-${role}`}
                label={t(
                  role === 'captain'
                    ? 'settings.plugins.detail.rolesCaptain'
                    : 'settings.plugins.detail.rolesCrew'
                )}
                checked={scope.roles.includes(role)}
                disabled={
                  disabled ||
                  (scope.roles.length === 1 && scope.roles.includes(role))
                }
                onChange={(on) =>
                  onChange({ roles: toggle(scope.roles, role, on) })
                }
              />
            ))}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-sm text-normal">
              {t('settings.plugins.detail.boards')}
            </legend>
            {boards.map((board) => (
              <SettingsCheckbox
                key={board.id}
                id={`${id}-board-${board.id}`}
                label={board.name}
                checked={scope.boards.includes(board.id)}
                disabled={disabled}
                onChange={(on) =>
                  onChange({ boards: toggle(scope.boards, board.id, on) })
                }
              />
            ))}
          </fieldset>
        </div>
      </details>
    </div>
  );
}
