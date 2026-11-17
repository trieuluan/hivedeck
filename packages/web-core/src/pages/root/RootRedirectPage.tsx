import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Provider as NiceModalProvider } from '@ebay/nice-modal-react';
import { CreateProjectDialog } from '@/shared/dialogs/CreateProjectDialog';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { getFirstProjectDestination } from '@/shared/lib/firstProjectDestination';
import { useUiPreferencesStore } from '@/shared/stores/useUiPreferencesStore';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';

export function RootRedirectPage() {
  const { config, loading } = useUserSystem();
  const appNavigation = useAppNavigation();
  const { t } = useTranslation('projects');
  // ADR-034: with no project yet, welcome the owner instead of dropping them
  // on the bare "new workspace" page.
  const [noProjects, setNoProjects] = useState(false);

  useEffect(() => {
    if (loading || !config) {
      return;
    }

    let isActive = true;
    void (async () => {
      if (!config.remote_onboarding_acknowledged) {
        appNavigation.goToOnboarding({ replace: true });
        return;
      }

      // Read saved selections imperatively to avoid re-triggering this effect
      // when the scratch store initializes from the server
      const { selectedProjectId } = useUiPreferencesStore.getState();

      // ADR-018 — projects are tenant-less, so the `savedOrgId` arg is
      // dropped. Only the saved project id is consulted.
      const destination = await getFirstProjectDestination(
        undefined,
        selectedProjectId
      );
      if (!isActive) {
        return;
      }

      if (destination?.kind === 'project') {
        appNavigation.goToProject(destination.projectId, { replace: true });
        return;
      }

      setNoProjects(true);
    })();

    return () => {
      isActive = false;
    };
  }, [appNavigation, config, loading]);

  const createProject = async () => {
    const result = await CreateProjectDialog.show({});
    if (result.action === 'created' && result.project) {
      appNavigation.goToProject(result.project.id, { replace: true });
    }
  };

  if (noProjects) {
    // `/` sits outside the app shell, so it brings its own modal provider
    // for the create-project dialog.
    return (
      <NiceModalProvider>
        <div className="flex h-screen items-center justify-center bg-primary px-double">
          <div className="max-w-md space-y-4">
            <p className="text-2xl font-semibold text-high">
              {t('welcome.title')}
            </p>
            <p className="text-normal">{t('welcome.body')}</p>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => void createProject()}
                className="rounded-sm bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand/90"
              >
                {t('welcome.createProject')}
              </button>
              <button
                type="button"
                onClick={() => appNavigation.goToWorkspacesCreate()}
                className="rounded-sm border border-border px-4 py-2 text-sm text-normal hover:bg-secondary"
              >
                {t('welcome.quickChat')}
              </button>
            </div>
          </div>
        </div>
      </NiceModalProvider>
    );
  }

  return (
    <div className="h-screen bg-primary flex items-center justify-center">
      <p className="text-low">{t('common:states.loading')}</p>
    </div>
  );
}
