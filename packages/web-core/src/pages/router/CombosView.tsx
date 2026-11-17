import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CheckIcon,
  PulseIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import type {
  ComboRole,
  ComboSuggestions,
  ExcludedModel,
  ModelCheck,
  ProviderHealth,
  ProviderHealthStatus,
  RoleSuggestion,
} from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { nineRouterApi } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';

/** Replacing a combo that drops this many models asks for confirmation. */
const CONFIRM_REMOVALS = 3;

const HEALTH_TEXT: Record<ProviderHealthStatus, string> = {
  ok: 'text-success',
  low: 'text-warning',
  exhausted: 'text-error',
  error: 'text-error',
  inactive: 'text-low',
  unknown: 'text-low',
};

const HEALTH_BAR: Record<ProviderHealthStatus, string> = {
  ok: 'bg-success',
  low: 'bg-warning',
  exhausted: 'bg-error',
  error: 'bg-error',
  inactive: 'bg-low',
  unknown: 'bg-low',
};

function relativeTime(iso: string | null, future: boolean): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  const ms = future ? diff : -diff;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

type ComboDiff = {
  isNew: boolean;
  added: Set<string>;
  removed: string[];
};

function diffCombo(role: RoleSuggestion): ComboDiff {
  const current = role.existing_models;
  const next = role.models.map((m) => m.id);
  if (!current) {
    return { isNew: true, added: new Set(next), removed: [] };
  }
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    isNew: false,
    added: new Set(next.filter((id) => !currentSet.has(id))),
    removed: current.filter((id) => !nextSet.has(id)),
  };
}

function Consent({ onAllow }: { onAllow: () => void }) {
  const { t } = useTranslation('settings');
  return (
    <div className="flex h-full items-center justify-center p-double">
      <div className="max-w-lg space-y-base">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="size-icon-base text-brand" />
          <h2 className="text-base font-semibold text-high">
            {t('settings.router.combos.consent.title')}
          </h2>
        </div>
        <p className="text-sm text-normal">
          {t('settings.router.combos.consent.body')}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-low">
          <li>{t('settings.router.combos.consent.reads')}</li>
          <li>{t('settings.router.combos.consent.writes')}</li>
          <li>{t('settings.router.combos.consent.local')}</li>
        </ul>
        <Button onClick={onAllow}>
          {t('settings.router.combos.consent.allow')}
        </Button>
      </div>
    </div>
  );
}

function QuotaBar({ p }: { p: ProviderHealth }) {
  const { t } = useTranslation();
  const pct = p.remaining_percent;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-panel"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-label={t('common:ui.quotaRemaining')}
      >
        {pct !== null && (
          <div
            className={cn('h-full rounded-full', HEALTH_BAR[p.status])}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        )}
      </div>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-normal">
        {pct !== null ? `${pct}%` : '—'}
      </span>
    </div>
  );
}

function ProviderRow({
  p,
  onOpenDashboard,
}: {
  p: ProviderHealth;
  onOpenDashboard: () => void;
}) {
  const { t } = useTranslation('settings');
  const labels: Record<ProviderHealthStatus, string> = {
    ok: t('settings.router.combos.health.ok'),
    low: t('settings.router.combos.health.low'),
    exhausted: t('settings.router.combos.health.exhausted'),
    error: t('settings.router.combos.health.error'),
    inactive: t('settings.router.combos.health.inactive'),
    unknown: t('settings.router.combos.health.unknown'),
  };
  const reset = relativeTime(p.reset_at, true);
  const broken = p.status === 'error' || p.status === 'inactive';

  let detail: React.ReactNode = null;
  if (broken) {
    detail = (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-error" title={p.message ?? undefined}>
          {p.summary ?? labels[p.status]}
        </span>
        <button
          type="button"
          onClick={onOpenDashboard}
          className="shrink-0 text-xs text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {t('settings.router.combos.fixInDashboard')}
        </button>
      </span>
    );
  } else if (p.quota_name || reset) {
    detail = (
      <span className="truncate text-low">
        {[
          p.quota_name,
          reset && t('settings.router.combos.resetsIn', { time: reset }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    );
  } else if (p.status === 'unknown') {
    detail = (
      <span className="truncate text-low">
        {t('settings.router.combos.noQuotaApi')}
      </span>
    );
  }

  return (
    <li className="grid grid-cols-[minmax(0,10rem)_7rem_6.5rem_minmax(0,1fr)] items-center gap-x-base px-base py-2 text-sm max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-1">
      <span className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <span className="truncate font-medium text-high">{p.provider}</span>
        {p.alias && p.alias !== p.provider && (
          <span className="font-mono text-xs text-low">{p.alias}/</span>
        )}
      </span>
      <span
        className={cn(
          'whitespace-nowrap text-xs font-medium',
          HEALTH_TEXT[p.status]
        )}
      >
        {labels[p.status]}
      </span>
      <span className="max-md:hidden">
        <QuotaBar p={p} />
      </span>
      <span className="flex min-w-0 items-center gap-2 text-xs max-md:col-span-2">
        <span className="md:hidden">
          <QuotaBar p={p} />
        </span>
        {detail}
        <span className="ml-auto shrink-0 tabular-nums text-low">
          {t('settings.router.combos.modelCount', { count: p.model_count })}
        </span>
      </span>
    </li>
  );
}

function CheckResult({ check }: { check: ModelCheck | undefined }) {
  const { t } = useTranslation('settings');
  if (!check) return null;
  if (check.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-success">
        <CheckCircleIcon className="size-icon-2xs" weight="fill" />
        {check.latency_ms !== null
          ? t('settings.router.combos.check.ok', {
              ms: check.latency_ms.toLocaleString(),
            })
          : t('settings.router.combos.check.okNoTime')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-error">
      <XCircleIcon className="size-icon-2xs" weight="fill" />
      {check.error ?? t('settings.router.combos.check.failed')}
      <span className="text-low">
        ·{' '}
        {check.permanent
          ? t('settings.router.combos.check.hidden')
          : t('settings.router.combos.check.cooldown')}
      </span>
    </span>
  );
}

function ExcludedList({
  items,
  busy,
  onRestore,
}: {
  items: ExcludedModel[];
  busy: boolean;
  onRestore: (id: string) => void;
}) {
  const { t } = useTranslation('settings');
  if (items.length === 0) return null;
  return (
    <details className="group rounded-sm border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-base py-2 text-sm hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <span className="font-semibold text-high">
          {t('settings.router.combos.excluded.title')}
        </span>
        <span className="text-xs tabular-nums text-low">{items.length}</span>
        <span className="text-xs text-low">
          {t('settings.router.combos.excluded.hint')}
        </span>
      </summary>
      <ul className="divide-y divide-border/60 border-t border-border">
        {items.map((e) => {
          const until = relativeTime(e.until, true);
          return (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-x-base gap-y-1 px-base py-2 text-xs"
            >
              <span className="break-all font-mono text-normal">{e.id}</span>
              <span className="text-error">{e.reason}</span>
              <span className="ml-auto flex items-center gap-2 text-low">
                {e.permanent ? (
                  <>
                    {t('settings.router.combos.excluded.hidden')}
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onRestore(e.id)}
                    >
                      {t('settings.router.combos.excluded.restore')}
                    </Button>
                  </>
                ) : until ? (
                  t('settings.router.combos.excluded.cooldown', { time: until })
                ) : (
                  t('settings.router.combos.excluded.cooldownNoTime')
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function RoleCard({
  role,
  busy,
  testing,
  checks,
  onApply,
  onUndo,
  onTest,
}: {
  role: RoleSuggestion;
  busy: boolean;
  testing: boolean;
  checks: Record<string, ModelCheck>;
  onApply: () => void;
  onUndo: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation('settings');
  const [confirming, setConfirming] = useState(false);
  const descriptions: Record<ComboRole, string> = {
    planner: t('settings.router.combos.roles.planner'),
    coder: t('settings.router.combos.roles.coder'),
    reviewer: t('settings.router.combos.roles.reviewer'),
    fast: t('settings.router.combos.roles.fast'),
  };
  const diff = diffCombo(role);
  const needsConfirm = diff.removed.length >= CONFIRM_REMOVALS;

  const primaryLabel = role.up_to_date
    ? t('settings.router.combos.upToDate')
    : diff.isNew
      ? t('settings.router.combos.create')
      : t('settings.router.combos.replace');

  const handlePrimary = () => {
    if (needsConfirm && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onApply();
  };

  return (
    <section
      aria-labelledby={`combo-${role.combo_name}`}
      className="flex flex-col gap-3 rounded-sm border border-border bg-secondary/40 p-base"
    >
      <header className="flex items-start justify-between gap-base">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h3
              id={`combo-${role.combo_name}`}
              className="font-mono text-sm font-semibold text-high"
            >
              {role.combo_name}
            </h3>
            <span className="text-xs text-low">
              {diff.isNew
                ? t('settings.router.combos.newCombo')
                : role.up_to_date
                  ? t('settings.router.combos.matches')
                  : t('settings.router.combos.changes', {
                      added: diff.added.size,
                      removed: diff.removed.length,
                    })}
            </span>
          </div>
          <p className="text-xs text-low">{descriptions[role.role]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {role.models.length > 0 && (
            <Button
              size="xs"
              variant="ghost"
              disabled={busy || testing}
              onClick={onTest}
            >
              <PulseIcon
                className={cn('mr-1 size-icon-xs', testing && 'animate-pulse')}
              />
              {testing
                ? t('settings.router.combos.testing')
                : t('settings.router.combos.test')}
            </Button>
          )}
          {role.undo_available && (
            <Button size="xs" variant="ghost" disabled={busy} onClick={onUndo}>
              <ArrowCounterClockwiseIcon className="mr-1 size-icon-xs" />
              {t('settings.router.combos.undo')}
            </Button>
          )}
          <Button
            size="xs"
            variant={role.up_to_date ? 'ghost' : 'default'}
            disabled={busy || role.up_to_date || role.models.length === 0}
            onClick={handlePrimary}
          >
            {role.up_to_date && <CheckIcon className="mr-1 size-icon-xs" />}
            {primaryLabel}
          </Button>
        </div>
      </header>

      {role.models.length === 0 ? (
        <p className="text-xs text-error">
          {t('settings.router.combos.noCandidates')}
        </p>
      ) : (
        <ol className="space-y-2">
          {role.models.map((m, i) => {
            const added = !diff.isNew && diff.added.has(m.id);
            return (
              <li key={m.id} className="flex gap-2 text-xs">
                <span className="w-4 shrink-0 pt-px text-right tabular-nums text-low">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="break-all font-mono text-normal">
                      {m.id}
                    </span>
                    {added && (
                      <span className="text-[11px] font-medium text-success">
                        {t('settings.router.combos.added')}
                      </span>
                    )}
                    <CheckResult check={checks[m.id]} />
                  </div>
                  <div className="text-low">{m.reason}</div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {diff.removed.length > 0 && (
        <details className="group text-xs">
          <summary className="cursor-pointer list-none text-low hover:text-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <span className="text-error">
              {t('settings.router.combos.removes', {
                count: diff.removed.length,
              })}
            </span>{' '}
            <span className="group-open:hidden">
              {t('settings.router.combos.show')}
            </span>
            <span className="hidden group-open:inline">
              {t('settings.router.combos.hide')}
            </span>
          </summary>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-6">
            {diff.removed.map((id) => (
              <li key={id} className="font-mono text-low line-through">
                {id}
              </li>
            ))}
          </ul>
        </details>
      )}

      {confirming && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-sm border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-normal"
        >
          <span className="flex-1">
            {t('settings.router.combos.confirm', {
              name: role.combo_name,
              count: diff.removed.length,
            })}
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setConfirming(false)}
          >
            {t('settings.router.combos.cancel')}
          </Button>
          <Button size="xs" onClick={handlePrimary} disabled={busy}>
            {t('settings.router.combos.replace')}
          </Button>
        </div>
      )}
    </section>
  );
}

export function CombosView({
  allowed,
  routerUp,
  onAllow,
  onRevoke,
  onOpenDashboard,
}: {
  allowed: boolean;
  routerUp: boolean;
  onAllow: () => void;
  onRevoke: () => void;
  onOpenDashboard: () => void;
}) {
  const { t } = useTranslation('settings');
  const [data, setData] = useState<ComboSuggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, ModelCheck>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await nineRouterApi.getSuggestions());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed && routerUp) void load();
  }, [allowed, routerUp, load]);

  const act = async (run: () => Promise<ComboSuggestions>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setData(await run());
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // A failed apply may have hidden broken models; show fresh chains.
      void load();
    } finally {
      setBusy(false);
    }
  };

  const testRole = async (role: RoleSuggestion) => {
    setTesting(role.combo_name);
    setError(null);
    setNotice(null);
    try {
      const results = await nineRouterApi.verifyModels(
        role.models.map((m) => m.id)
      );
      setChecks((prev) => ({
        ...prev,
        ...Object.fromEntries(results.map((c) => [c.id, c])),
      }));
      const failed = results.filter((c) => !c.ok).length;
      if (failed > 0) {
        setNotice(
          t('settings.router.combos.excludedAfterTest', { count: failed })
        );
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(null);
    }
  };

  if (!allowed) return <Consent onAllow={onAllow} />;
  if (!routerUp) {
    return (
      <div className="flex h-full items-center justify-center p-double text-sm text-low">
        {t('settings.router.combos.notRunning')}
      </div>
    );
  }

  const updated = relativeTime(data?.generated_at ?? null, false);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl space-y-double p-base">
        <div className="flex flex-wrap items-center gap-x-base gap-y-2">
          <p className="min-w-[16rem] flex-1 text-sm text-low">
            {t('settings.router.combos.intro')}
          </p>
          {updated && (
            <span className="text-xs text-low">
              {t('settings.router.combos.updatedAgo', { time: updated })}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            <ArrowsClockwiseIcon
              className={cn('mr-1.5 size-icon-xs', loading && 'animate-spin')}
            />
            {t('settings.router.combos.refresh')}
          </Button>
        </div>

        <div aria-live="polite">
          {error && (
            <div className="rounded-sm border border-error/50 bg-error/10 px-base py-2 text-sm text-error">
              {error}
            </div>
          )}
          {notice && !error && (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckIcon className="size-icon-xs" weight="bold" />
              {notice}
            </div>
          )}
        </div>

        {data && (
          <>
            <section aria-labelledby="router-providers" className="space-y-2">
              <h3
                id="router-providers"
                className="text-sm font-semibold text-high"
              >
                {t('settings.router.combos.providers')}
              </h3>
              <ul className="divide-y divide-border/60 rounded-sm border border-border">
                {data.providers.map((p) => (
                  <ProviderRow
                    key={p.provider}
                    p={p}
                    onOpenDashboard={onOpenDashboard}
                  />
                ))}
              </ul>
            </section>

            <ExcludedList
              items={data.excluded}
              busy={busy}
              onRestore={(id) =>
                void act(
                  () => nineRouterApi.unblockModel(id),
                  t('settings.router.combos.excluded.restored', { id })
                )
              }
            />

            <div className="grid items-start gap-base md:grid-cols-2">
              {data.roles.map((role) => (
                <RoleCard
                  key={role.role}
                  role={role}
                  busy={busy}
                  testing={testing === role.combo_name}
                  checks={checks}
                  onTest={() => void testRole(role)}
                  onApply={() =>
                    void act(
                      () =>
                        nineRouterApi.applyCombo(
                          role.combo_name,
                          role.models.map((m) => m.id)
                        ),
                      t('settings.router.combos.saved', {
                        name: role.combo_name,
                      })
                    )
                  }
                  onUndo={() =>
                    void act(
                      () => nineRouterApi.undoCombo(role.combo_name),
                      t('settings.router.combos.restored', {
                        name: role.combo_name,
                      })
                    )
                  }
                />
              ))}
            </div>
          </>
        )}

        <div className="border-t border-border pt-base">
          <Button size="xs" variant="ghost" onClick={onRevoke}>
            {t('settings.router.combos.revoke')}
          </Button>
        </div>
      </div>
    </div>
  );
}
