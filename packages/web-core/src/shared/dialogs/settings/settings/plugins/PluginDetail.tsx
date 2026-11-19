import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  PluginMcpEntry,
  PluginSkillEntry,
  PluginView,
} from 'shared/types';
import { pluginsApi, type ScopePatch } from './pluginsApi';
import { CompatBadge, mcpCompat } from './pluginCompat';
import { PluginScopeEditor } from './PluginScopeEditor';
import { errorText, type Notice } from './pluginNotice';

const button =
  'rounded-sm border border-border px-3 py-1.5 text-sm text-normal hover:bg-secondary disabled:opacity-50';

export function PluginDetail({
  plugin,
  onChanged,
  notify,
}: {
  plugin: PluginView;
  onChanged: () => Promise<void>;
  notify: (notice: Notice) => void;
}) {
  const { t } = useTranslation('settings');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const status = (mcp: string, name: string) =>
    plugin.secret_status.find((s) => s.mcp === mcp && s.name === name)
      ?.has_value ?? false;

  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
      notify({ kind: 'ok', text: ok });
    } catch (reason) {
      notify({ kind: 'error', text: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  const key = (mcp: string, ref: string) => `${mcp}/${ref}`;
  const pin = plugin.tag
    ? { label: t('settings.plugins.detail.tag'), value: plugin.tag }
    : plugin.commit
      ? { label: t('settings.plugins.detail.commit'), value: plugin.commit }
      : null;

  const mcpRow = (entry: PluginMcpEntry) => {
    const refs = plugin.secret_status.filter((s) => s.mcp === entry.name);
    return (
      <li
        key={entry.name}
        className="space-y-2 rounded-sm border border-border p-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PluginScopeEditor
            id={`mcp-${plugin.name}-${entry.name}`}
            name={entry.name}
            scope={entry}
            disabled={busy}
            onChange={(patch: ScopePatch) =>
              void run(
                () => pluginsApi.updateMcp(plugin.name, entry.name, patch),
                t('settings.plugins.notice.saved')
              )
            }
          />
          <CompatBadge compat={mcpCompat(entry)} />
        </div>
        <p className="text-xs text-low break-all">
          {entry.transport} ·{' '}
          {entry.transport === 'http'
            ? entry.url
            : [entry.command, ...entry.args].join(' ')}
        </p>
        {entry.oauth && (
          <p className="text-xs text-warning">
            {t('settings.plugins.detail.oauth')}
          </p>
        )}
        {refs.map((ref) => {
          const id = key(entry.name, ref.name);
          const draft = drafts[id] ?? '';
          return (
            <div key={id} className="space-y-1">
              <label className="block text-sm text-low">
                {ref.name}:{' '}
                {ref.has_value
                  ? t('settings.plugins.detail.secretSet')
                  : t('settings.plugins.detail.secretUnset')}
                <input
                  type="password"
                  autoComplete="new-password"
                  aria-label={t('settings.plugins.detail.secretInput', {
                    name: ref.name,
                  })}
                  value={draft}
                  onChange={(event) =>
                    setDrafts({ ...drafts, [id]: event.target.value })
                  }
                  className="mt-1 w-full rounded-sm border border-border bg-secondary px-base py-half text-sm text-high"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={busy || !draft}
                  onClick={() =>
                    void run(async () => {
                      await pluginsApi.setSecret(
                        plugin.name,
                        entry.name,
                        ref.name,
                        draft
                      );
                      setDrafts({ ...drafts, [id]: '' });
                    }, t('settings.plugins.notice.secretSaved'))
                  }
                >
                  {t('settings.plugins.detail.secretSave')}
                </button>
                {status(entry.name, ref.name) && (
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          pluginsApi.clearSecret(
                            plugin.name,
                            entry.name,
                            ref.name
                          ),
                        t('settings.plugins.notice.secretCleared')
                      )
                    }
                  >
                    {t('settings.plugins.detail.secretClear')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </li>
    );
  };

  const skillRow = (skill: PluginSkillEntry) => (
    <li key={skill.name} className="rounded-sm border border-border p-2">
      <PluginScopeEditor
        id={`skill-${plugin.name}-${skill.name}`}
        name={skill.name}
        scope={skill}
        disabled={busy}
        onChange={(patch: ScopePatch) =>
          void run(
            () => pluginsApi.updateSkill(plugin.name, skill.name, patch),
            t('settings.plugins.notice.saved')
          )
        }
      />
    </li>
  );

  return (
    <div className="space-y-4 border-t border-border pt-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-low">{t('settings.plugins.detail.source')}</dt>
        <dd className="text-normal break-all">{plugin.source}</dd>
        {pin ? (
          <>
            <dt className="text-low">{pin.label}</dt>
            <dd className="text-normal break-all">{pin.value}</dd>
          </>
        ) : (
          <>
            <dt className="text-low">{t('settings.plugins.detail.tag')}</dt>
            <dd className="text-normal">
              {t('settings.plugins.detail.noPin')}
            </dd>
          </>
        )}
        {plugin.commit && plugin.tag && (
          <>
            <dt className="text-low">{t('settings.plugins.detail.commit')}</dt>
            <dd className="text-normal break-all">{plugin.commit}</dd>
          </>
        )}
      </dl>
      <section className="space-y-2">
        <h4 className="text-sm font-medium text-high">
          {t('settings.plugins.detail.mcpTitle')}
        </h4>
        {plugin.mcp.length ? (
          <ul className="space-y-2">{plugin.mcp.map(mcpRow)}</ul>
        ) : (
          <p className="text-sm text-low">
            {t('settings.plugins.addDialog.noMcp')}
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h4 className="text-sm font-medium text-high">
          {t('settings.plugins.detail.skillsTitle')}
        </h4>
        {plugin.skills.length ? (
          <ul className="space-y-2">{plugin.skills.map(skillRow)}</ul>
        ) : (
          <p className="text-sm text-low">
            {t('settings.plugins.addDialog.noSkills')}
          </p>
        )}
      </section>
      {plugin.unsupported.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-sm font-medium text-high">
            {t('settings.plugins.detail.unsupportedTitle')}
          </h4>
          <ul className="flex flex-wrap gap-2">
            {plugin.unsupported.map((item) => (
              <li key={item}>
                <code className="rounded-sm bg-secondary px-2 py-0.5 text-xs text-error">
                  {item}
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {plugin.notes.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-sm font-medium text-high">
            {t('settings.plugins.detail.notesTitle')}
          </h4>
          <ul className="text-xs text-low">
            {plugin.notes.map((note) => (
              <li key={`${note.kind}-${note.name}-${note.against}`}>
                {t('settings.plugins.addDialog.conflictBody', {
                  kind: note.kind,
                  name: note.name,
                  against: note.against,
                })}
                {note.action ? ` (${note.action})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
