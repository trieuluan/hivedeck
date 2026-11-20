import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckIcon,
  MagnifyingGlassIcon,
  PowerIcon,
  SpinnerIcon,
} from '@phosphor-icons/react';
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

const ALL_CLIS_TAB = 'ALL';

const CLI_LABELS: Record<string, string> = {
  CLAUDE_CODE: 'Claude Code',
  CODEX: 'Codex',
  OPENCODE: 'OpenCode',
  GEMINI: 'Gemini',
  CURSOR_AGENT: 'Cursor',
  COPILOT: 'Copilot',
  QWEN_CODE: 'Qwen',
  AMP: 'Amp',
  DROID: 'Droid',
};

const CLI_BADGE_CLASS: Record<string, string> = {
  CLAUDE_CODE: 'border-brand/25 bg-brand/10 text-brand',
  CODEX:
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  OPENCODE: 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  GEMINI: 'border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  CURSOR_AGENT:
    'border-purple-500/25 bg-purple-500/10 text-purple-600 dark:text-purple-400',
  COPILOT:
    'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  QWEN_CODE:
    'border-indigo-500/25 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  AMP: 'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  DROID: 'border-teal-500/25 bg-teal-500/10 text-teal-600 dark:text-teal-400',
};

const SKILL_MODES: SkillMode[] = ['on', 'name_only', 'off'];
type SkillFilter = 'all' | SkillMode;

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
  const [cli, setCli] = useState<string>(ALL_CLIS_TAB);
  const [save, setSave] = useState<SaveState>('idle');
  const saveSeq = useRef(0);

  useEffect(() => {
    agentExtensionsApi
      .load()
      .then((res) => {
        setEntries(res.clis);
      })
      .catch(() => setLoadError(true));
  }, []);

  const entry = entries?.find((e) => e.inventory.cli === cli);

  const updateCli = useCallback(
    (targetCli: string, next: CliExtensionPrefs) => {
      setEntries(
        (prev) =>
          prev?.map((e) =>
            e.inventory.cli === targetCli ? { ...e, prefs: next } : e
          ) ?? prev
      );
      const seq = ++saveSeq.current;
      setSave('saving');
      agentExtensionsApi
        .save(targetCli, next)
        .then(() => seq === saveSeq.current && setSave('saved'))
        .catch(() => seq === saveSeq.current && setSave('error'));
    },
    []
  );

  const updateBatch = useCallback(
    (updates: { cli: string; prefs: CliExtensionPrefs }[]) => {
      if (!updates.length) return;
      const byCli = new Map(updates.map((u) => [u.cli, u.prefs]));
      setEntries(
        (prev) =>
          prev?.map((e) => {
            const next = byCli.get(e.inventory.cli);
            return next ? { ...e, prefs: next } : e;
          }) ?? prev
      );
      const seq = ++saveSeq.current;
      setSave('saving');
      (async () => {
        for (const u of updates) {
          await agentExtensionsApi.save(u.cli, u.prefs);
        }
      })()
        .then(() => seq === saveSeq.current && setSave('saved'))
        .catch(() => seq === saveSeq.current && setSave('error'));
    },
    []
  );

  const visibleEntries = useMemo(
    () =>
      entries?.filter((e) => {
        if (e.inventory.cli === 'CLAUDE_CODE' || e.inventory.cli === 'CODEX') {
          return true;
        }
        const total =
          e.inventory.skills.length +
          e.inventory.mcp_servers.length +
          e.inventory.plugins.length +
          e.inventory.subagents.length +
          e.inventory.hooks.length;
        return total > 0;
      }) ?? [],
    [entries]
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
      <div className="flex items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label={t('settings.extensions.cliLabel')}
          className="inline-flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-secondary/70 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <button
            type="button"
            role="tab"
            aria-selected={cli === ALL_CLIS_TAB}
            onClick={() => {
              setCli(ALL_CLIS_TAB);
              setSave('idle');
            }}
            className={cn(
              'shrink-0 rounded-sm px-2 py-1 text-xs font-medium transition-colors',
              cli === ALL_CLIS_TAB
                ? 'bg-brand text-white shadow-sm'
                : 'text-low hover:bg-panel/60 hover:text-high'
            )}
          >
            {t('settings.extensions.allClis')}
          </button>
          {visibleEntries.map((e) => {
            const count =
              e.inventory.skills.length + e.inventory.mcp_servers.length;
            return (
              <button
                key={e.inventory.cli}
                type="button"
                role="tab"
                aria-selected={e.inventory.cli === cli}
                onClick={() => {
                  setCli(e.inventory.cli);
                  setSave('idle');
                }}
                className={cn(
                  'shrink-0 rounded-sm px-2 py-1 text-xs font-medium transition-colors',
                  e.inventory.cli === cli
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-low hover:bg-panel/60 hover:text-high'
                )}
              >
                {CLI_LABELS[e.inventory.cli] ?? e.inventory.cli}
                {count > 0 ? ` (${count})` : ''}
              </button>
            );
          })}
        </div>
        <SaveIndicator state={save} />
      </div>
      <p className="text-sm text-low">
        {cli === ALL_CLIS_TAB
          ? t('settings.extensions.allClisIntro')
          : t('settings.extensions.intro')}
      </p>

      {cli === ALL_CLIS_TAB ? (
        <AllClisPanel entries={entries} onUpdateBatch={updateBatch} />
      ) : (
        entry && (
          <CliPanel
            entry={entry}
            onChange={(next) => updateCli(entry.inventory.cli, next)}
          />
        )
      )}
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

function CliBadgeList({ clis }: { clis: string[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {clis.map((cliKey) => (
        <span
          key={cliKey}
          className={cn(
            'inline-flex items-center rounded border px-1.5 py-0.5 text-2xs font-medium',
            CLI_BADGE_CLASS[cliKey] ?? 'border-border bg-secondary text-normal'
          )}
        >
          {CLI_LABELS[cliKey] ?? cliKey}
        </span>
      ))}
    </div>
  );
}

function SkillSearchToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  showModeFilter,
  bulkCount,
  bulkTurnOn,
  onBulkToggle,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  filter: SkillFilter;
  onFilterChange: (f: SkillFilter) => void;
  showModeFilter: boolean;
  bulkCount: number;
  bulkTurnOn: boolean;
  onBulkToggle: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="relative min-w-[180px] flex-1">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-low"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('settings.extensions.skills.searchPlaceholder')}
          className="w-full rounded-md border border-border bg-secondary/50 py-1.5 pl-8 pr-3 text-xs text-normal placeholder:text-low focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
      </div>
      {showModeFilter && (
        <div className="inline-flex rounded-md border border-border bg-secondary p-0.5">
          {(['all', ...SKILL_MODES] as SkillFilter[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onFilterChange(mode)}
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs transition-colors',
                filter === mode
                  ? 'bg-panel text-high shadow-sm'
                  : 'text-low hover:text-normal'
              )}
            >
              {mode === 'all'
                ? t('settings.extensions.skills.filterAll')
                : t(`settings.extensions.skills.mode.${mode}`)}
            </button>
          ))}
        </div>
      )}
      {bulkCount > 0 && (
        <button
          type="button"
          onClick={onBulkToggle}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
            bulkTurnOn
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400'
              : 'border-brand/50 bg-brand/10 text-brand hover:bg-brand/20'
          )}
        >
          <PowerIcon className="h-3.5 w-3.5" weight="bold" aria-hidden />
          {t(
            bulkTurnOn
              ? 'settings.extensions.skills.bulkOn'
              : 'settings.extensions.skills.bulkOff',
            { count: bulkCount }
          )}
        </button>
      )}
    </div>
  );
}

const SKILLS_PAGE_SIZE = 8;

const normalizeSkillKey = (name: string) =>
  name.trim().toLowerCase().replace(/:/g, '-');

function SkillPagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (next: number) => void;
}) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * SKILLS_PAGE_SIZE + 1;
  const end = Math.min(page * SKILLS_PAGE_SIZE, totalItems);
  return (
    <div className="flex items-center justify-between gap-2 pt-1 text-xs text-low">
      <span>
        {start}–{end} / {totalItems}
      </span>
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded border border-border bg-panel px-2 py-1 text-xs text-normal transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          ‹ Trước
        </button>
        <span className="px-2 text-2xs font-medium text-high">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded border border-border bg-panel px-2 py-1 text-xs text-normal transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sau ›
        </button>
      </div>
    </div>
  );
}

type GroupedSkill = {
  key: string;
  name: string;
  namePerCli: Record<string, string>;
  description?: string;
  clis: string[];
  controllableClis: string[];
};

type GroupedMcp = {
  name: string;
  description?: string;
  clis: string[];
  controllableClis: string[];
};

function AllClisPanel({
  entries,
  onUpdateBatch,
}: {
  entries: AgentExtensionsEntry[];
  onUpdateBatch: (updates: { cli: string; prefs: CliExtensionPrefs }[]) => void;
}) {
  const { t } = useTranslation('settings');
  const [skillQuery, setSkillQuery] = useState('');
  const [skillFilter, setSkillFilter] = useState<SkillFilter>('all');
  const [skillPage, setSkillPage] = useState(1);

  useEffect(() => {
    setSkillPage(1);
  }, [skillQuery, skillFilter]);

  const entryByCli = useMemo(
    () => new Map(entries.map((e) => [e.inventory.cli, e])),
    [entries]
  );

  const groupedSkills = useMemo(() => {
    const map = new Map<string, GroupedSkill>();
    for (const entry of entries) {
      for (const skill of entry.inventory.skills) {
        const key = normalizeSkillKey(skill.name);
        const existing = map.get(key);
        const canControl =
          entry.inventory.supports.skill_modes && skill.toggleable;
        if (existing) {
          existing.namePerCli[entry.inventory.cli] = skill.name;
          if (!skill.name.includes(':') && existing.name.includes(':')) {
            existing.name = skill.name;
          }
          if (!existing.clis.includes(entry.inventory.cli)) {
            existing.clis.push(entry.inventory.cli);
          }
          if (
            canControl &&
            !existing.controllableClis.includes(entry.inventory.cli)
          ) {
            existing.controllableClis.push(entry.inventory.cli);
          }
          if (!existing.description && skill.description) {
            existing.description = skill.description;
          }
        } else {
          map.set(key, {
            key,
            name: skill.name,
            namePerCli: { [entry.inventory.cli]: skill.name },
            description: skill.description,
            clis: [entry.inventory.cli],
            controllableClis: canControl ? [entry.inventory.cli] : [],
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const groupedMcp = useMemo(() => {
    const map = new Map<string, GroupedMcp>();
    for (const entry of entries) {
      for (const server of entry.inventory.mcp_servers) {
        const existing = map.get(server.name);
        const canControl = entry.inventory.supports.mcp;
        if (existing) {
          if (!existing.clis.includes(entry.inventory.cli)) {
            existing.clis.push(entry.inventory.cli);
          }
          if (
            canControl &&
            !existing.controllableClis.includes(entry.inventory.cli)
          ) {
            existing.controllableClis.push(entry.inventory.cli);
          }
          if (!existing.description && server.description) {
            existing.description = server.description;
          }
        } else {
          map.set(server.name, {
            name: server.name,
            description: server.description,
            clis: [entry.inventory.cli],
            controllableClis: canControl ? [entry.inventory.cli] : [],
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const effectiveSkillMode = useCallback(
    (skill: GroupedSkill): SkillMode => {
      if (skill.controllableClis.length === 0) return 'on';
      const modes = skill.controllableClis.map((c) => {
        const rawName = skill.namePerCli[c] ?? skill.name;
        return entryByCli.get(c)?.prefs.skills[rawName] ?? 'on';
      });
      if (modes.every((m) => m === 'off')) return 'off';
      if (modes.every((m) => m === 'name_only')) return 'name_only';
      return modes[0] ?? 'on';
    },
    [entryByCli]
  );

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    return groupedSkills.filter((skill) => {
      if (skillFilter !== 'all' && effectiveSkillMode(skill) !== skillFilter) {
        return false;
      }
      if (!q) return true;
      return (
        skill.name.toLowerCase().includes(q) ||
        skill.key.includes(q) ||
        Object.values(skill.namePerCli).some((n) =>
          n.toLowerCase().includes(q)
        ) ||
        (skill.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [effectiveSkillMode, groupedSkills, skillFilter, skillQuery]);

  const totalSkillPages = Math.max(
    1,
    Math.ceil(filteredSkills.length / SKILLS_PAGE_SIZE)
  );
  const safeSkillPage = Math.min(skillPage, totalSkillPages);
  const pagedSkills = useMemo(() => {
    const start = (safeSkillPage - 1) * SKILLS_PAGE_SIZE;
    return filteredSkills.slice(start, start + SKILLS_PAGE_SIZE);
  }, [filteredSkills, safeSkillPage]);

  const controllableFiltered = useMemo(
    () => filteredSkills.filter((s) => s.controllableClis.length > 0),
    [filteredSkills]
  );
  const allFilteredOff =
    controllableFiltered.length > 0 &&
    controllableFiltered.every((s) => effectiveSkillMode(s) === 'off');

  const setSkillsBatch = (targets: GroupedSkill[], mode: SkillMode) => {
    const byCli = new Map<string, CliExtensionPrefs>();
    for (const skill of targets) {
      for (const cliKey of skill.controllableClis) {
        const base = byCli.get(cliKey) ?? entryByCli.get(cliKey)?.prefs;
        if (!base) continue;
        const rawName = skill.namePerCli[cliKey] ?? skill.name;
        const nextSkills = { ...base.skills };
        if (mode === 'on') delete nextSkills[rawName];
        else nextSkills[rawName] = mode;
        byCli.set(cliKey, { ...base, skills: nextSkills });
      }
    }
    onUpdateBatch(
      [...byCli.entries()].map(([cliKey, prefs]) => ({ cli: cliKey, prefs }))
    );
  };

  const anySkillControllable = groupedSkills.some(
    (s) => s.controllableClis.length > 0
  );

  return (
    <>
      <SettingsCard
        title={`${t('settings.extensions.skills.title')} (${groupedSkills.length})`}
        description={t('settings.extensions.skills.description')}
      >
        {groupedSkills.length === 0 ? (
          <Empty>{t('settings.extensions.skills.empty')}</Empty>
        ) : (
          <div className="space-y-3">
            <SkillSearchToolbar
              query={skillQuery}
              onQueryChange={setSkillQuery}
              filter={skillFilter}
              onFilterChange={setSkillFilter}
              showModeFilter={anySkillControllable}
              bulkCount={
                skillQuery.trim() || skillFilter !== 'all'
                  ? controllableFiltered.length
                  : 0
              }
              bulkTurnOn={allFilteredOff}
              onBulkToggle={() =>
                setSkillsBatch(
                  controllableFiltered,
                  allFilteredOff ? 'on' : 'off'
                )
              }
            />
            {filteredSkills.length === 0 ? (
              <Empty>{t('settings.extensions.skills.empty')}</Empty>
            ) : (
              <>
                <ItemList>
                  {pagedSkills.map((skill) => {
                    const canControl = skill.controllableClis.length > 0;
                    return (
                      <li
                        key={skill.key}
                        className="flex flex-col justify-between gap-2 rounded-md border border-border bg-panel/60 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 truncate text-xs font-semibold text-high">
                            {skill.name}
                          </div>
                          {canControl ? (
                            <SkillModePicker
                              name={skill.name}
                              value={effectiveSkillMode(skill)}
                              onChange={(mode) => setSkillsBatch([skill], mode)}
                            />
                          ) : (
                            <ReadOnlyTag />
                          )}
                        </div>
                        {skill.description && (
                          <p
                            className="line-clamp-2 text-2xs text-low"
                            title={skill.description}
                          >
                            {skill.description}
                          </p>
                        )}
                        <CliBadgeList clis={skill.clis} />
                      </li>
                    );
                  })}
                </ItemList>
                <SkillPagination
                  page={safeSkillPage}
                  totalPages={totalSkillPages}
                  totalItems={filteredSkills.length}
                  onPageChange={setSkillPage}
                />
              </>
            )}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title={`${t('settings.extensions.mcp.title')} (${groupedMcp.length})`}
        description={t('settings.extensions.mcp.description')}
      >
        {groupedMcp.length === 0 ? (
          <Empty>{t('settings.extensions.mcp.empty')}</Empty>
        ) : (
          <ItemList>
            {groupedMcp.map((server) => {
              const canControl = server.controllableClis.length > 0;
              const isChecked = server.controllableClis.some(
                (cliKey) =>
                  !entryByCli
                    .get(cliKey)
                    ?.prefs.disabled_mcp.includes(server.name)
              );
              return (
                <li
                  key={server.name}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel/60 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-high">
                      {server.name}
                    </div>
                    <CliBadgeList clis={server.clis} />
                  </div>
                  {canControl ? (
                    <Switch
                      aria-label={server.name}
                      checked={isChecked}
                      onCheckedChange={(on) => {
                        const updates: {
                          cli: string;
                          prefs: CliExtensionPrefs;
                        }[] = [];
                        for (const cliKey of server.controllableClis) {
                          const base = entryByCli.get(cliKey)?.prefs;
                          if (!base) continue;
                          const nextDisabled = !on
                            ? [...new Set([...base.disabled_mcp, server.name])]
                            : base.disabled_mcp.filter(
                                (n) => n !== server.name
                              );
                          updates.push({
                            cli: cliKey,
                            prefs: { ...base, disabled_mcp: nextDisabled },
                          });
                        }
                        onUpdateBatch(updates);
                      }}
                    />
                  ) : (
                    <ReadOnlyTag />
                  )}
                </li>
              );
            })}
          </ItemList>
        )}
      </SettingsCard>
    </>
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
  const [skillQuery, setSkillQuery] = useState('');
  const [skillFilter, setSkillFilter] = useState<SkillFilter>('all');
  const [skillPage, setSkillPage] = useState(1);

  useEffect(() => {
    setSkillQuery('');
    setSkillFilter('all');
    setSkillPage(1);
  }, [inventory.cli]);

  useEffect(() => {
    setSkillPage(1);
  }, [skillQuery, skillFilter]);

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

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    return inventory.skills.filter((skill) => {
      const mode: SkillMode = prefs.skills[skill.name] ?? 'on';
      if (skillFilter !== 'all' && mode !== skillFilter) return false;
      if (!q) return true;
      return (
        skill.name.toLowerCase().includes(q) ||
        (skill.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [inventory.skills, prefs.skills, skillFilter, skillQuery]);

  const totalSkillPages = Math.max(
    1,
    Math.ceil(filteredSkills.length / SKILLS_PAGE_SIZE)
  );
  const safeSkillPage = Math.min(skillPage, totalSkillPages);
  const pagedSkills = useMemo(() => {
    const start = (safeSkillPage - 1) * SKILLS_PAGE_SIZE;
    return filteredSkills.slice(start, start + SKILLS_PAGE_SIZE);
  }, [filteredSkills, safeSkillPage]);

  const toggleIn = (list: string[], name: string, off: boolean) =>
    off ? [...new Set([...list, name])] : list.filter((n) => n !== name);

  return (
    <>
      {hasSavings && (
        <SettingsCard
          title={t('settings.extensions.savings.title')}
          description={t('settings.extensions.savings.description')}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {supports.cache_friendly_prompt && (
              <SwitchRow
                label={t('settings.extensions.savings.cache')}
                description={t('settings.extensions.savings.cacheHint')}
                checked={prefs.cache_friendly_prompt}
                onChange={(v) =>
                  onChange({ ...prefs, cache_friendly_prompt: v })
                }
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
          </div>
        </SettingsCard>
      )}

      <SettingsCard
        title={`${t('settings.extensions.skills.title')} (${inventory.skills.length})`}
        description={
          supports.skill_modes
            ? t('settings.extensions.skills.description')
            : t('settings.extensions.readOnly')
        }
      >
        {inventory.skills.length === 0 ? (
          <Empty>{t('settings.extensions.skills.empty')}</Empty>
        ) : (
          <div className="space-y-3">
            {(() => {
              const controllable = supports.skill_modes
                ? filteredSkills.filter((s) => s.toggleable)
                : [];
              const allOff =
                controllable.length > 0 &&
                controllable.every(
                  (s) => (prefs.skills[s.name] ?? 'on') === 'off'
                );
              return (
                <SkillSearchToolbar
                  query={skillQuery}
                  onQueryChange={setSkillQuery}
                  filter={skillFilter}
                  onFilterChange={setSkillFilter}
                  showModeFilter={supports.skill_modes}
                  bulkCount={
                    skillQuery.trim() || skillFilter !== 'all'
                      ? controllable.length
                      : 0
                  }
                  bulkTurnOn={allOff}
                  onBulkToggle={() => {
                    const skills = { ...prefs.skills };
                    for (const s of controllable) {
                      if (allOff) delete skills[s.name];
                      else skills[s.name] = 'off';
                    }
                    onChange({ ...prefs, skills });
                  }}
                />
              );
            })()}
            {filteredSkills.length === 0 ? (
              <Empty>{t('settings.extensions.skills.empty')}</Empty>
            ) : (
              <>
                <ItemList>
                  {pagedSkills.map((skill) => (
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
                <SkillPagination
                  page={safeSkillPage}
                  totalPages={totalSkillPages}
                  totalItems={filteredSkills.length}
                  onPageChange={setSkillPage}
                />
              </>
            )}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title={`${t('settings.extensions.mcp.title')} (${inventory.mcp_servers.length})`}
        description={
          supports.mcp
            ? t('settings.extensions.mcp.description')
            : t('settings.extensions.readOnly')
        }
      >
        {inventory.mcp_servers.length === 0 ? (
          <Empty>{t('settings.extensions.mcp.empty')}</Empty>
        ) : (
          <ItemList>
            {inventory.mcp_servers.map((server) => (
              <ItemRow key={server.name} item={server}>
                {supports.mcp && server.toggleable ? (
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
                ) : (
                  <ReadOnlyTag />
                )}
              </ItemRow>
            ))}
          </ItemList>
        )}
      </SettingsCard>

      {supports.plugins && inventory.plugins.length > 0 && (
        <SettingsCard
          title={`${t('settings.extensions.plugins.title')} (${inventory.plugins.length})`}
        >
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
          title={`${t('settings.extensions.subagents.title')} (${inventory.subagents.length})`}
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
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-border bg-secondary/20 p-3 transition-colors hover:bg-secondary/35">
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm font-medium text-high">{label}</span>
        <span className="block text-xs text-low">{description}</span>
      </span>
      <Switch
        className="mt-0.5 shrink-0"
        checked={checked}
        onCheckedChange={onChange}
      />
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
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-secondary/20 p-3">
      <div className="min-w-0 space-y-0.5">
        <label
          htmlFor="extensions-budget"
          className="block text-sm font-medium text-high"
        >
          {t('settings.extensions.savings.budget')}
        </label>
        <p className="text-xs text-low">
          {t('settings.extensions.savings.budgetHint')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 rounded-md border border-border/90 bg-panel px-2.5 py-1 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
        <span className="text-xs font-medium text-low">$</span>
        <input
          id="extensions-budget"
          inputMode="decimal"
          value={draft}
          placeholder="—"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="w-16 bg-transparent text-right text-xs font-medium text-high placeholder:text-low focus:outline-none"
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
  return <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</ul>;
}

function ItemRow({
  item,
  children,
}: {
  item: InstalledItem;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col justify-between gap-1.5 rounded-md border border-border bg-panel/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-semibold text-high">
          {item.name}
        </div>
        {children}
      </div>
      <div className="line-clamp-2 text-2xs text-low" title={item.description}>
        {item.description ?? item.source}
      </div>
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
