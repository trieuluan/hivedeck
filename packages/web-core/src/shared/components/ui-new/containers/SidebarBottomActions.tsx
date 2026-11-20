import {
  FolderSimpleIcon,
  GearIcon,
  KanbanIcon,
  ShuffleIcon,
} from '@phosphor-icons/react';
import { useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SidebarBarButton } from '@vibe/ui/components/SidebarBarButton';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { nineRouterApi } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';

export function SidebarRailHeader() {
  const appNavigation = useAppNavigation();

  return (
    <button
      type="button"
      onClick={() => appNavigation.goToRoot()}
      title="HiveDeck"
      className="group flex flex-col items-center gap-1 rounded-lg p-1 transition-transform hover:scale-105 focus:outline-none"
    >
      <img
        src="/hivedeck-mark.png"
        alt="HiveDeck"
        className="size-8 rounded-lg object-cover ring-1 ring-border/70"
      />
    </button>
  );
}

export function SidebarRailNav({
  activeProjectId,
}: {
  activeProjectId?: string | null;
}) {
  const { t } = useTranslation('common');
  const appNavigation = useAppNavigation();
  const { pathname } = useLocation();

  const { data: routerStatus } = useQuery({
    queryKey: ['nineRouter', 'status'],
    queryFn: () => nineRouterApi.getStatus(false),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const isRouterRunning =
    routerStatus?.state === 'running' || routerStatus?.state === 'external';

  const isProjects = pathname.startsWith('/projects');
  const isWorkspaces = pathname.startsWith('/workspaces');
  const isRouter = pathname.startsWith('/router');

  const activeCls = 'bg-brand/15 text-brand border border-brand/30';
  const idleCls = 'text-low hover:bg-secondary hover:text-high';

  return (
    <>
      <SidebarBarButton
        label="Projects"
        icon={KanbanIcon}
        onClick={() =>
          activeProjectId
            ? appNavigation.goToProject(activeProjectId)
            : appNavigation.goToRoot()
        }
        className={cn(
          'w-full py-1.5 h-auto [&>span:last-child]:text-[10px]',
          isProjects ? activeCls : idleCls
        )}
        iconClass={isProjects ? 'text-brand' : undefined}
      />
      <SidebarBarButton
        label="Workspaces"
        icon={FolderSimpleIcon}
        onClick={() => appNavigation.goToWorkspaces()}
        className={cn(
          'w-full py-1.5 h-auto [&>span:last-child]:text-[10px]',
          isWorkspaces ? activeCls : idleCls
        )}
        iconClass={isWorkspaces ? 'text-brand' : undefined}
      />
      <div className="relative w-full">
        <SidebarBarButton
          label={t('sidebar.router')}
          icon={ShuffleIcon}
          onClick={() => appNavigation.goToRouter()}
          className={cn(
            'w-full py-1.5 h-auto [&>span:last-child]:text-[10px]',
            isRouter ? activeCls : idleCls
          )}
          iconClass={isRouter ? 'text-brand' : undefined}
        />
        {isRouterRunning && (
          <span
            aria-label="9router đang chạy"
            title="9router đang chạy"
            className="pointer-events-none absolute right-2 top-1.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-primary"
          />
        )}
      </div>
    </>
  );
}

export function SidebarRailFooter() {
  const { t } = useTranslation('common');

  return (
    <SidebarBarButton
      label={t('sidebar.settings')}
      icon={GearIcon}
      onClick={() => SettingsDialog.show()}
      className="w-full py-1.5 h-auto text-low hover:bg-secondary hover:text-high"
    />
  );
}

/**
 * Legacy single-bar fallback kept for compatibility.
 */
export function SidebarBottomActions() {
  return (
    <>
      <SidebarRailNav />
      <SidebarRailFooter />
    </>
  );
}
