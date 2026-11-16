import { GearIcon, ShuffleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { SidebarBarButton } from '@vibe/ui/components/SidebarBarButton';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';

/**
 * Bottom sidebar bar content (ADR-010). ADR-019: the kanban notifications
 * bell/badge was removed (the User entity it surfaced has been excised).
 * ADR-026: Router opens the embedded 9router page.
 */
export function SidebarBottomActions() {
  const { t } = useTranslation('common');
  const appNavigation = useAppNavigation();

  return (
    <>
      <SidebarBarButton
        label={t('sidebar.router')}
        icon={ShuffleIcon}
        onClick={() => appNavigation.goToRouter()}
      />
      <SidebarBarButton
        label={t('sidebar.settings')}
        icon={GearIcon}
        onClick={() => SettingsDialog.show()}
      />
    </>
  );
}
