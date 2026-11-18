import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, SpinnerIcon } from '@phosphor-icons/react';
import type {
  AgentExtensionsEntry,
  CliExtensionPrefs,
  InstalledItem,
  SkillMode,
} from 'shared/types';
import { agentExtensionsApi } from '@/shared/lib/api';
import { Switch } from '@vibe/ui/components/Switch';
import { cn } from '@/shared/lib/utils';
import { SettingsCard } from './SettingsComponents';

const CLI_LABELS: Record<string, string> = {
  CLAUDE_CODE: 'Claude Code',
  CODEX: 'Codex',
};

const SKILL_MODES: SkillMode[] = ['on', 'name_only', 'off'];

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * ADR-038: what each CLI loads in HiveDeck's headless runs. Lists what the
 * owner installed for that CLI and lets them switch items off (or to
 * name-only) for HiveDeck only; the CLI's own config is never edited.
 * Changes save immediately.
 */
export function ExtensionsSettingsSection() {
  const { t } = useTranslation('settings');
  const [entries, setEntries] = useState<AgentExtensionsEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [cli, setCli] = useState<string>('CLAUDE_CODE');
  const [save, setSave] = useState<SaveState>('idle');
  const saveSeq = useRef(0);

  useEffect(() => {
    agentExtensionsApi
      .load()
      .then((res) => {
        setEntries(res.clis);
        if (res.clis.length && !res.clis.some((c) => c.inventory.cli === cli))
          setCli(res.clis[0]!.inventory.cli);
      })
      .catch(() => setLoadError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entry = entries?.find((e) => e.inventory.cli === cli);

  const update = useCallback(
    (next: CliExtensionPrefs) => {
      setEntries(
        (prev) =>
          prev?.map((e) =>
            e.inventory.cli === cli ? { ...e, prefs: next } : e
          ) ?? prev
      );
      const seq = ++saveSeq.current;
      setSave('saving');
      agentExtensionsApi
        .save(cli, next)
        .then(() => seq === saveSeq.current && setSave('saved'))
        .catch(() => seq === saveSeq.current && setSave('error'));
    },
    [cli]
  );

  if (loadError) {
    return (
      <p className="text-sm text-error">{t('settings.extensions.loadError')}</p>
    );
  }
  if (!entries) {
    return (
      <p className="text-sm text-low">{t('settings.extensions.loading')}</p>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t('settings.extensions.cliLabel')}
          className="inline-flex rounded-md border border-border bg-secondary p-0.5"
        >
          {entries.map((e) => (
            <button
              key={e.inventory.cli}
              role="tab"
              aria-selected={e.inventory.cli === cli}
              onClick={() => {
                setCli(e.inventory.cli);
                setSave('idle');
              }}
              className={cn(
                'rounded-sm px-3 py-1 text-sm transition-colors',
                e.inventory.cli === cli
                  ? 'bg-panel text-high shadow-sm'
                  : 'text-low hover:text-normal'
              )}
            >
              {CLI_LABELS[e.inventory.cli] ?? e.inventory.cli}
            </button>
          ))}
        </div>
        <SaveIndicator state={save} />
      </div>
      <p className="text-sm text-low">{t('settings.extensions.intro')}</p>

      {entry && <CliPanel entry={entry} onChange={update} />}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useTranslation('settings');
  if (state === 'idle') return null;
  return (
    <span
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        state === 'error' ? 'text-error' : 'text-low'
      )}
    >
      {state === 'saving' && (
        <SpinnerIcon className="size-icon-xs animate-spin" />
      )}
      {state === 'saved' && <CheckIcon className="size-icon-xs" />}
      {t(`settings.extensions.save.${state}`)}
    </span>
  );
}

function CliPanel({
  entry,
  onChange,
}: {
  entry: AgentExtensionsEntry;
  onChange: (prefs: CliExtensionPrefs) => void;
}) {
  const { t } = useTranslation('settings');
  const { inventory, prefs } = entry;
  const { supports } = inventory;

  const hookCount = useMemo(
    () =>
      inventory.hooks.reduce((sum, h) => sum + (Number(h.description) || 0), 0),
    [inventory.hooks]
  );

  const hasSavings =
    supports.cache_friendly_prompt ||
    supports.max_budget ||
    supports.hooks ||
    supports.bundled_skills;

  const toggleIn = (list: string[], name: string, off: boolean) =>
    off ? [...new Set([...list, name])] : list.filter((n) => n !== name);

  return (
    <>
      {hasSavings && (
        <SettingsCard
          title={t('settings.extensions.savings.title')}
          description={t('settings.extensions.savings.description')}
        >
          {supports.cache_friendly_prompt && (
            <SwitchRow
              label={t('settings.extensions.savings.cache')}
              description={t('settings.extensions.savings.cacheHint')}
              checked={prefs.cache_friendly_prompt}
              onChange={(v) => onChange({ ...prefs, cache_friendly_prompt: v })}
            />
          )}
          {supports.max_budget && (
            <BudgetRow
              value={prefs.max_budget_usd}
              onChange={(v) => onChange({ ...prefs, max_budget_usd: v })}
            />
          )}
          {supports.hooks && (
            <SwitchRow
              label={t('settings.extensions.savings.hooks')}
              description={
                inventory.hooks.length
                  ? t('settings.extensions.savings.hooksHint', {
                      count: hookCount,
                      events: inventory.hooks.length,
                    })
                  : t('settings.extensions.savings.noHooks')
              }
              checked={!prefs.disable_hooks}
              onChange={(v) => onChange({ ...prefs, disable_hooks: !v })}
            />
          )}
          {supports.bundled_skills && (
            <SwitchRow
              label={t('settings.extensions.savings.bundled')}
              description={t('settings.extensions.savings.bundledHint')}
              checked={!prefs.disable_bundled_skills}
              onChange={(v) =>
                onChange({ ...prefs, disable_bundled_skills: !v })
              }
            />
          )}
        </SettingsCard>
      )}

      <SettingsCard
        title={t('settings.extensions.skills.title')}
        description={
          supports.skill_modes
            ? t('settings.extensions.skills.description')
            : t('settings.extensions.readOnly')
        }
      >
        {inventory.skills.length === 0 ? (
          <Empty>{t('settings.extensions.skills.empty')}</Empty>
        ) : (
          <ItemList>
            {inventory.skills.map((skill) => (
              <ItemRow key={skill.name} item={skill}>
                {supports.skill_modes && skill.toggleable ? (
                  <SkillModePicker
                    name={skill.name}
                    value={prefs.skills[skill.name] ?? 'on'}
                    onChange={(mode) => {
                      const skills = { ...prefs.skills };
                      if (mode === 'on') delete skills[skill.name];
                      else skills[skill.name] = mode;
                      onChange({ ...prefs, skills });
                    }}
                  />
                ) : (
                  <ReadOnlyTag />
                )}
              </ItemRow>
            ))}
          </ItemList>
        )}
      </SettingsCard>

      <SettingsCard
        title={t('settings.extensions.mcp.title')}
        description={t('settings.extensions.mcp.description')}
      >
        {inventory.mcp_servers.length === 0 ? (
          <Empty>{t('settings.extensions.mcp.empty')}</Empty>
        ) : (
          <ItemList>
            {inventory.mcp_servers.map((server) => (
              <ItemRow key={server.name} item={server}>
                <Switch
                  aria-label={server.name}
                  checked={!prefs.disabled_mcp.includes(server.name)}
                  onCheckedChange={(on) =>
                    onChange({
                      ...prefs,
                      disabled_mcp: toggleIn(
                        prefs.disabled_mcp,
                        server.name,
                        !on
                      ),
                    })
                  }
                />
              </ItemRow>
            ))}
          </ItemList>
        )}
      </SettingsCard>

      {supports.plugins && inventory.plugins.length > 0 && (
        <SettingsCard title={t('settings.extensions.plugins.title')}>
          <ItemList>
            {inventory.plugins.map((plugin) => (
              <ItemRow key={plugin.name} item={plugin}>
                <Switch
                  aria-label={plugin.name}
                  checked={!prefs.disabled_plugins.includes(plugin.name)}
                  onCheckedChange={(on) =>
                    onChange({
                      ...prefs,
                      disabled_plugins: toggleIn(
                        prefs.disabled_plugins,
                        plugin.name,
                        !on
                      ),
                    })
                  }
                />
              </ItemRow>
            ))}
          </ItemList>
        </SettingsCard>
      )}

      {inventory.subagents.length > 0 && (
        <SettingsCard
          title={t('settings.extensions.subagents.title')}
          description={t('settings.extensions.subagents.description')}
        >
          <ItemList>
            {inventory.subagents.map((agent) => (
              <ItemRow key={agent.name} item={agent}>
                <ReadOnlyTag />
              </ItemRow>
            ))}
          </ItemList>
        </SettingsCard>
      )}
    </>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm font-medium text-normal">{label}</span>
        <span className="block text-sm text-low">{description}</span>
      </span>
      <Switch className="mt-0.5" checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function BudgetRow({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const { t } = useTranslation('settings');
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);

  const commit = () => {
    const parsed = Number.parseFloat(draft.replace(',', '.'));
    const next = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    if (next !== value) onChange(next);
    else setDraft(value == null ? '' : String(value));
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <label
          htmlFor="extensions-budget"
          className="block text-sm font-medium text-normal"
        >
          {t('settings.extensions.savings.budget')}
        </label>
        <p className="text-sm text-low">
          {t('settings.extensions.savings.budgetHint')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-sm text-low">$</span>
        <input
          id="extensions-budget"
          inputMode="decimal"
          value={draft}
          placeholder="—"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="w-24 rounded-md border border-border bg-secondary px-2 py-1 text-right text-sm text-normal placeholder:text-low focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
      </div>
    </div>
  );
}

function SkillModePicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: SkillMode;
  onChange: (mode: SkillMode) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="inline-flex shrink-0 rounded-md border border-border bg-secondary p-0.5"
    >
      {SKILL_MODES.map((mode) => (
        <button
          key={mode}
          role="radio"
          aria-checked={value === mode}
          title={t(`settings.extensions.skills.modeHint.${mode}`)}
          onClick={() => onChange(mode)}
          className={cn(
            'rounded-sm px-2 py-0.5 text-xs transition-colors',
            value === mode
              ? mode === 'off'
                ? 'bg-panel text-error shadow-sm'
                : 'bg-panel text-high shadow-sm'
              : 'text-low hover:text-normal'
          )}
        >
          {t(`settings.extensions.skills.mode.${mode}`)}
        </button>
      ))}
    </div>
  );
}

function ItemList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {children}
    </ul>
  );
}

function ItemRow({
  item,
  children,
}: {
  item: InstalledItem;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-4 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-normal">
          {item.name}
        </div>
        <div className="truncate text-xs text-low" title={item.description}>
          {item.description ?? item.source}
        </div>
      </div>
      {children}
    </li>
  );
}

function ReadOnlyTag() {
  const { t } = useTranslation('settings');
  return (
    <span className="shrink-0 text-xs text-low">
      {t('settings.extensions.readOnlyTag')}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-low">{children}</p>;
}
