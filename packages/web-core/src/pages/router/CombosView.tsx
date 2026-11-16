import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowsClockwiseIcon,
  CheckIcon,
  ShieldCheckIcon,
} from '@phosphor-icons/react';
import type {
  ComboRole,
  ComboSuggestions,
  ProviderHealth,
  ProviderHealthStatus,
  RoleSuggestion,
} from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { nineRouterApi } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';

const HEALTH_STYLES: Record<ProviderHealthStatus, string> = {
  ok: 'bg-success/15 text-success',
  low: 'bg-warning/15 text-warning',
  exhausted: 'bg-error/15 text-error',
  error: 'bg-error/15 text-error',
  inactive: 'bg-low/15 text-low',
  unknown: 'bg-low/15 text-low',
};

function formatReset(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.round(hours / 24)}d`;
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
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

function ProviderRow({ p }: { p: ProviderHealth }) {
  const { t } = useTranslation('settings');
  const labels: Record<ProviderHealthStatus, string> = {
    ok: t('settings.router.combos.health.ok'),
    low: t('settings.router.combos.health.low'),
    exhausted: t('settings.router.combos.health.exhausted'),
    error: t('settings.router.combos.health.error'),
    inactive: t('settings.router.combos.health.inactive'),
    unknown: t('settings.router.combos.health.unknown'),
  };
  const reset = formatReset(p.reset_at);
  return (
    <tr className="border-t border-border/50 align-top">
      <td className="py-1.5 pr-base">
        <span className="font-medium text-high">{p.provider}</span>
        {p.alias && p.alias !== p.provider && (
          <span className="ml-1.5 font-mono text-xs text-low">{p.alias}/</span>
        )}
      </td>
      <td className="py-1.5 pr-base">
        <span
          className={cn(
            'rounded-sm px-1.5 py-0.5 text-xs font-medium',
            HEALTH_STYLES[p.status]
          )}
        >
          {labels[p.status]}
        </span>
      </td>
      <td className="py-1.5 pr-base text-xs text-normal">
        {p.remaining_percent !== null ? (
          <>
            {p.remaining_percent}%
            {p.quota_name && (
              <span className="text-low"> · {p.quota_name}</span>
            )}
            {reset && (
              <span className="text-low">
                {' '}
                · {t('settings.router.combos.resetsIn', { time: reset })}
              </span>
            )}
          </>
        ) : (
          <span className="text-low">—</span>
        )}
      </td>
      <td className="py-1.5 pr-base text-xs text-low">{p.model_count}</td>
      <td className="py-1.5 text-xs text-low">{p.message}</td>
    </tr>
  );
}

function RoleCard({
  role,
  busy,
  onApply,
}: {
  role: RoleSuggestion;
  busy: boolean;
  onApply: () => void;
}) {
  const { t } = useTranslation('settings');
  const descriptions: Record<ComboRole, string> = {
    planner: t('settings.router.combos.roles.planner'),
    coder: t('settings.router.combos.roles.coder'),
    reviewer: t('settings.router.combos.roles.reviewer'),
    fast: t('settings.router.combos.roles.fast'),
  };
  const action = role.up_to_date
    ? t('settings.router.combos.upToDate')
    : role.existing_models
      ? t('settings.router.combos.update')
      : t('settings.router.combos.create');

  return (
    <section className="flex flex-col gap-2 rounded-sm border border-border bg-secondary/40 p-base">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-mono text-sm font-semibold text-high">
            {role.combo_name}
          </h3>
          <p className="text-xs text-low">{descriptions[role.role]}</p>
        </div>
        <Button
          size="xs"
          variant={role.up_to_date ? 'ghost' : 'default'}
          disabled={busy || role.up_to_date || role.models.length === 0}
          onClick={onApply}
        >
          {role.up_to_date && <CheckIcon className="mr-1 size-icon-xs" />}
          {action}
        </Button>
      </header>

      {role.models.length === 0 ? (
        <p className="text-xs text-error">
          {t('settings.router.combos.noCandidates')}
        </p>
      ) : (
        <ol className="space-y-1.5">
          {role.models.map((m, i) => (
            <li key={m.id} className="flex gap-2 text-xs">
              <span className="w-4 shrink-0 text-right text-low">{i + 1}.</span>
              <div className="min-w-0">
                <div className="break-all font-mono text-normal">{m.id}</div>
                <div className="text-low">{m.reason}</div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {role.existing_models && !role.up_to_date && (
        <p className="text-xs text-low">
          {t('settings.router.combos.current')}{' '}
          <span className="font-mono">
            {role.existing_models.length > 0
              ? role.existing_models.join(' → ')
              : '—'}
          </span>
        </p>
      )}
    </section>
  );
}

export function CombosView({
  allowed,
  routerUp,
  onAllow,
  onRevoke,
}: {
  allowed: boolean;
  routerUp: boolean;
  onAllow: () => void;
  onRevoke: () => void;
}) {
  const { t } = useTranslation('settings');
  const [data, setData] = useState<ComboSuggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const apply = async (role: RoleSuggestion) => {
    setApplying(role.combo_name);
    setError(null);
    try {
      setData(
        await nineRouterApi.applyCombo(
          role.combo_name,
          role.models.map((m) => m.id)
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(null);
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

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl space-y-double p-base">
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-sm text-low">
            {t('settings.router.combos.intro')}
          </p>
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

        {error && (
          <div className="rounded-sm border border-error/50 bg-error/10 px-base py-2 text-sm text-error">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="grid gap-base md:grid-cols-2">
              {data.roles.map((role) => (
                <RoleCard
                  key={role.role}
                  role={role}
                  busy={applying !== null}
                  onApply={() => void apply(role)}
                />
              ))}
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-high">
                {t('settings.router.combos.providers')}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-low">
                    <tr>
                      <th className="pb-1 pr-base font-normal">
                        {t('settings.router.combos.columns.provider')}
                      </th>
                      <th className="pb-1 pr-base font-normal">
                        {t('settings.router.combos.columns.status')}
                      </th>
                      <th className="pb-1 pr-base font-normal">
                        {t('settings.router.combos.columns.quota')}
                      </th>
                      <th className="pb-1 pr-base font-normal">
                        {t('settings.router.combos.columns.models')}
                      </th>
                      <th className="pb-1 font-normal">
                        {t('settings.router.combos.columns.note')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.providers.map((p) => (
                      <ProviderRow key={p.provider} p={p} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
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
