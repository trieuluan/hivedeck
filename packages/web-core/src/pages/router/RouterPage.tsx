import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowCircleUpIcon,
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CopyIcon,
  DownloadSimpleIcon,
  PlayIcon,
  StopIcon,
} from '@phosphor-icons/react';
import type { NineRouterState, NineRouterStatus } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { nineRouterApi } from '@/shared/lib/api';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { cn } from '@/shared/lib/utils';
import { SettingsCheckbox } from '@/shared/dialogs/settings/settings/SettingsComponents';

type RouterAction =
  | 'install'
  | 'start'
  | 'stop'
  | 'restart'
  | 'update'
  | 'rollback';
type Tab = 'dashboard' | 'logs';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const STATE_STYLES: Record<NineRouterState, string> = {
  not_installed: 'bg-low/15 text-low',
  installing: 'bg-warning/15 text-warning',
  updating: 'bg-warning/15 text-warning',
  stopped: 'bg-low/15 text-low',
  starting: 'bg-warning/15 text-warning',
  running: 'bg-success/15 text-success',
  external: 'bg-info/15 text-info',
};

function isBusy(state: NineRouterState | undefined) {
  return state === 'installing' || state === 'updating' || state === 'starting';
}

function isUp(state: NineRouterState | undefined) {
  return state === 'running' || state === 'external';
}

/** Same-site URL for the dashboard iframe, or null when not reachable. */
function dashboardUrl(status: NineRouterStatus): string | null {
  const host = window.location.hostname;
  if (!LOOPBACK_HOSTS.has(host)) return null;
  // Use the page's own loopback name so 9router's login cookie is same-site.
  const name = host === '::1' ? '[::1]' : host;
  return `${window.location.protocol}//${name}:${status.port}${status.dashboard_path}`;
}

function StateBadge({ state }: { state: NineRouterState }) {
  const { t } = useTranslation('settings');
  const labels: Record<NineRouterState, string> = {
    not_installed: t('settings.router.state.not_installed'),
    installing: t('settings.router.state.installing'),
    updating: t('settings.router.state.updating'),
    stopped: t('settings.router.state.stopped'),
    starting: t('settings.router.state.starting'),
    running: t('settings.router.state.running'),
    external: t('settings.router.state.external'),
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium',
        STATE_STYLES[state]
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-current',
          isBusy(state) && 'animate-pulse'
        )}
      />
      {labels[state]}
    </span>
  );
}

function CopyField({ value }: { value: string }) {
  const { t } = useTranslation('settings');
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-sm bg-secondary px-2 py-0.5 font-mono text-xs text-normal hover:bg-panel"
      title={
        copied
          ? t('settings.router.actions.copied')
          : t('settings.router.actions.copy')
      }
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {value}
      <CopyIcon className="size-icon-xs text-low" />
    </button>
  );
}

function UpdateControls({
  status,
  busy,
  checking,
  checkedNoUpdate,
  onCheck,
  onUpdate,
  onRollback,
  onTakeOver,
}: {
  status: NineRouterStatus;
  busy: boolean;
  checking: boolean;
  checkedNoUpdate: boolean;
  onCheck: () => void;
  onUpdate: () => void;
  onRollback: () => void;
  onTakeOver: () => void;
}) {
  const { t } = useTranslation('settings');
  const latest = status.latest_version;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status.update_available && latest ? (
        <>
          <span className="rounded-sm bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
            {t('settings.router.update.available', { version: latest })}
          </span>
          {status.can_update ? (
            <Button size="xs" onClick={onUpdate} disabled={busy}>
              <ArrowCircleUpIcon className="mr-1 size-icon-xs" />
              {t('settings.router.update.action', { version: latest })}
            </Button>
          ) : (
            <>
              <span className="text-xs text-low">
                {t('settings.router.update.globalHint')}
              </span>
              <CopyField value="npm i -g 9router@latest" />
              <Button
                size="xs"
                variant="outline"
                onClick={onTakeOver}
                disabled={busy}
              >
                {t('settings.router.update.takeOver')}
              </Button>
            </>
          )}
        </>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          onClick={onCheck}
          disabled={checking || busy}
        >
          <ArrowsClockwiseIcon
            className={cn('mr-1 size-icon-xs', checking && 'animate-spin')}
          />
          {checkedNoUpdate
            ? t('settings.router.update.upToDate')
            : t('settings.router.update.check')}
        </Button>
      )}
      {status.can_update && status.previous_version && (
        <Button size="xs" variant="ghost" onClick={onRollback} disabled={busy}>
          <ArrowCounterClockwiseIcon className="mr-1 size-icon-xs" />
          {t('settings.router.update.rollback', {
            version: status.previous_version,
          })}
        </Button>
      )}
    </div>
  );
}

function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center p-double">
      <div className="max-w-md space-y-base text-center">
        <h2 className="text-base font-semibold text-high">{title}</h2>
        <p className="text-sm text-low">{body}</p>
        {children}
      </div>
    </div>
  );
}

function LogsView() {
  const { t } = useTranslation('settings');
  const [lines, setLines] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const logs = await nineRouterApi.getLogs(500);
        if (!cancelled) setLines(logs.lines);
      } catch {
        /* keep last lines */
      }
    };
    void load();
    const id = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <div className="h-full overflow-auto bg-secondary p-base font-mono text-xs leading-relaxed text-normal">
      {lines.length === 0 ? (
        <span className="text-low">{t('settings.router.noLogs')}</span>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}

export function RouterPage() {
  const { t } = useTranslation('settings');
  const { config, updateAndSaveConfig } = useUserSystem();
  const [status, setStatus] = useState<NineRouterStatus | null>(null);
  const [pending, setPending] = useState<RouterAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');

  const [checking, setChecking] = useState(false);
  const [checkedNoUpdate, setCheckedNoUpdate] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await nineRouterApi.getStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const checkForUpdates = async () => {
    setChecking(true);
    setCheckedNoUpdate(false);
    try {
      const next = await nineRouterApi.getStatus(true);
      setStatus(next);
      setCheckedNoUpdate(!next.update_available);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  // Poll faster while installing/starting.
  const busy = isBusy(status?.state) || pending !== null;
  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, busy ? 1500 : 5000);
    return () => window.clearInterval(id);
  }, [refresh, busy]);

  const run = async (action: RouterAction) => {
    setPending(action);
    setError(null);
    if (action === 'install' || action === 'update') setTab('logs');
    try {
      setStatus(await nineRouterApi.action(action));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void refresh();
    } finally {
      setPending(null);
    }
  };

  const iframeSrc = useMemo(
    () => (status ? dashboardUrl(status) : null),
    [status]
  );

  const settings = config?.nine_router;
  const canInstall = status?.npm_available && status?.node_available;

  const main = (() => {
    if (!status) return null;
    if (tab === 'logs') return <LogsView />;
    if (isUp(status.state)) {
      if (!iframeSrc) {
        return (
          <EmptyState
            title={t('settings.router.state.running')}
            body={t('settings.router.empty.remoteHost')}
          />
        );
      }
      return (
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          title="9router dashboard"
          className="h-full w-full border-0 bg-primary"
        />
      );
    }
    if (isBusy(status.state) || pending) {
      return (
        <EmptyState
          title={t('settings.router.empty.busyTitle')}
          body={t('settings.router.empty.busyBody')}
        />
      );
    }
    if (status.state === 'not_installed') {
      return (
        <EmptyState
          title={t('settings.router.empty.notInstalledTitle')}
          body={t('settings.router.empty.notInstalledBody', {
            version: status.pinned_version,
          })}
        >
          {canInstall ? (
            <Button onClick={() => run('install')}>
              <DownloadSimpleIcon className="mr-1.5 size-icon-sm" />
              {t('settings.router.actions.install')}
            </Button>
          ) : (
            <p className="text-sm text-error">
              {t('settings.router.empty.noNode')}
            </p>
          )}
        </EmptyState>
      );
    }
    return (
      <EmptyState
        title={t('settings.router.empty.stoppedTitle')}
        body={t('settings.router.empty.stoppedBody')}
      >
        <Button onClick={() => run('start')}>
          <PlayIcon className="mr-1.5 size-icon-sm" weight="fill" />
          {t('settings.router.actions.start')}
        </Button>
      </EmptyState>
    );
  })();

  return (
    <div className="flex h-full flex-col bg-primary">
      <header className="space-y-base border-b border-border px-base py-base">
        <div className="flex flex-wrap items-center gap-base">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-high">
                {t('settings.router.title')}
              </h1>
              {status && <StateBadge state={status.state} />}
            </div>
            <p className="text-sm text-low">{t('settings.router.subtitle')}</p>
          </div>

          {status && (
            <div className="flex flex-wrap items-center gap-2">
              {status.state === 'stopped' && (
                <Button size="sm" onClick={() => run('start')} disabled={busy}>
                  <PlayIcon className="mr-1.5 size-icon-xs" weight="fill" />
                  {t('settings.router.actions.start')}
                </Button>
              )}
              {status.state === 'running' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => run('restart')}
                    disabled={busy}
                  >
                    <ArrowsClockwiseIcon className="mr-1.5 size-icon-xs" />
                    {t('settings.router.actions.restart')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => run('stop')}
                    disabled={busy}
                  >
                    <StopIcon className="mr-1.5 size-icon-xs" weight="fill" />
                    {t('settings.router.actions.stop')}
                  </Button>
                </>
              )}
              {isUp(status.state) && iframeSrc && (
                <Button size="sm" variant="ghost" asChild>
                  <a href={iframeSrc} target="_blank" rel="noreferrer">
                    <ArrowSquareOutIcon className="mr-1.5 size-icon-xs" />
                    {t('settings.router.actions.openInBrowser')}
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>

        {status && (
          <div className="flex flex-wrap items-center gap-x-double gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-low">{t('settings.router.baseUrl')}</span>
              <CopyField value={status.base_url} />
            </div>
            {status.installed_version && (
              <div className="flex items-center gap-2">
                <span className="text-low">{t('settings.router.version')}</span>
                <span className="font-mono text-xs text-normal">
                  v{status.installed_version}
                </span>
                {status.install_source && (
                  <span className="text-xs text-low">
                    (
                    {status.install_source === 'managed'
                      ? t('settings.router.source.managed')
                      : t('settings.router.source.global')}
                    )
                  </span>
                )}
              </div>
            )}
            {isUp(status.state) && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-low">{t('settings.router.combos')}</span>
                {status.combos.length === 0 ? (
                  <span className="text-xs text-low">
                    {t('settings.router.noCombos')}
                  </span>
                ) : (
                  status.combos.map((combo) => (
                    <span
                      key={combo}
                      className="rounded-sm bg-brand/15 px-1.5 py-0.5 font-mono text-xs text-brand"
                    >
                      {combo}
                    </span>
                  ))
                )}
              </div>
            )}
            {status.installed_version && (
              <UpdateControls
                status={status}
                busy={busy}
                checking={checking}
                checkedNoUpdate={checkedNoUpdate}
                onCheck={checkForUpdates}
                onUpdate={() => run('update')}
                onRollback={() => run('rollback')}
                onTakeOver={() => run('install')}
              />
            )}
            {settings && status.state !== 'not_installed' && (
              <div className="ml-auto">
                <SettingsCheckbox
                  id="nine-router-auto-start"
                  label={t('settings.router.autoStart')}
                  checked={settings.auto_start}
                  onChange={(checked) =>
                    void updateAndSaveConfig({
                      nine_router: { ...settings, auto_start: checked },
                    })
                  }
                />
              </div>
            )}
          </div>
        )}

        {status?.state === 'external' && (
          <p className="text-xs text-low">
            {t('settings.router.externalNote')}
          </p>
        )}
        {(error || status?.last_error) && (
          <div className="rounded-sm border border-error/50 bg-error/10 px-base py-2 text-sm text-error">
            {error ?? status?.last_error}
          </div>
        )}

        <nav className="flex gap-1">
          {(['dashboard', 'logs'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'rounded-sm px-3 py-1 text-sm',
                tab === id
                  ? 'bg-secondary font-medium text-high'
                  : 'text-low hover:text-normal'
              )}
            >
              {id === 'dashboard'
                ? t('settings.router.tabs.dashboard')
                : t('settings.router.tabs.logs')}
            </button>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1">{main}</main>
    </div>
  );
}

export function RouterPageContainer() {
  return <RouterPage />;
}
