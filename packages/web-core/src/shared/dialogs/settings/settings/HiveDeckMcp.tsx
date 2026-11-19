import { useCallback, useEffect, useState } from 'react';
import type {
  AgentExtensionsResponse,
  JsonValue,
  RegistryEntry,
  RegistryRole,
  RegistrySecretStatus,
} from 'shared/types';
import { BaseCodingAgent } from 'shared/types';
import { handleApiResponse } from '@/shared/lib/api';
import { useProjects } from '@/shared/hooks/useProjects';
import { useSettingsMachineClient } from './SettingsHostContext';
import {
  SettingsCard,
  SettingsCheckbox,
  SettingsField,
  SettingsInput,
  SettingsTextarea,
} from './SettingsComponents';

type Candidate = { name: string; exists: boolean };
type Pair = { key: string; reference: string; value: string };
const roles: RegistryRole[] = ['captain', 'crew'];
const empty = (): RegistryEntry => ({
  name: '',
  transport: 'http',
  command: null,
  args: [],
  url: '',
  headers: {},
  env: {},
  roles: ['crew'],
  boards: [],
  oauth: false,
});
const button =
  'rounded-sm border border-border px-3 py-1.5 text-sm text-normal hover:bg-secondary disabled:opacity-50';
const request = async <T,>(path: string, init?: RequestInit): Promise<T> =>
  handleApiResponse<T>(await fetch(`/api/${path}`, init));
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const reference = () => `secret_${crypto.randomUUID().replaceAll('-', '')}`;

export function HiveDeckMcp() {
  const client = useSettingsMachineClient();
  const { data: boards } = useProjects();
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<string, boolean>>({});
  const [inventory, setInventory] = useState<AgentExtensionsResponse | null>(
    null
  );
  const [presets, setPresets] = useState<Record<string, JsonValue>>({});
  const [draft, setDraft] = useState<RegistryEntry | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [source, setSource] = useState<'claude_code' | 'codex'>('claude_code');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const next = await request<RegistryEntry[]>('mcp-registry/entries');
    const refs = [
      ...new Set(
        next
          .flatMap((entry) => [
            ...Object.values(entry.headers),
            ...Object.values(entry.env),
          ])
          .filter((item): item is string => !!item)
      ),
    ];
    const found = await Promise.all(
      refs.map((name) =>
        request<RegistrySecretStatus>(
          `mcp-registry/secrets/${encodeURIComponent(name)}`
        )
      )
    );
    setEntries(next);
    setStatuses(
      Object.fromEntries(found.map((item) => [item.name, item.has_value]))
    );
  }, []);
  useEffect(() => {
    reload().catch((reason: unknown) => setError(String(reason)));
    request<AgentExtensionsResponse>('agent-extensions')
      .then(setInventory)
      .catch((reason: unknown) => setError(String(reason)));
  }, [reload]);
  useEffect(() => {
    if (!client) return;
    client
      .loadMcpServers({ executor: BaseCodingAgent.CLAUDE_CODE })
      .then(({ mcp_config }) => {
        const value = mcp_config.preconfigured;
        if (value && typeof value === 'object' && !Array.isArray(value))
          setPresets(
            Object.fromEntries(
              Object.entries(value).map(([key, item]) => [key, item ?? null])
            )
          );
      })
      .catch(() => {});
  }, [client]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const edit = (entry: RegistryEntry | null) => {
    setOriginal(entry?.name ?? null);
    setDraft(entry ? structuredClone(entry) : empty());
    setPairs(
      entry
        ? Object.entries(
            entry.transport === 'http' ? entry.headers : entry.env
          ).map(([key, value]) => ({ key, reference: value || '', value: '' }))
        : []
    );
  };
  const clashes = (entry: RegistryEntry) =>
    inventory?.clis.some(({ inventory: item }) =>
      item.mcp_servers.some((server) => server.name === entry.name)
    );
  const warning = (name: string) => (
    <p key={name} className="text-sm text-warning">
      Cần đặt secret cho header {name}
    </p>
  );
  const save = () =>
    run(async () => {
      if (!draft) return;
      if (draft.name === 'hivedeck')
        throw new Error('Tên hivedeck được dành riêng cho HiveDeck.');
      if (!/^[A-Za-z0-9_-]+$/.test(draft.name) || !draft.roles.length)
        throw new Error('Tên và vai trò không hợp lệ.');
      if (
        pairs.some((pair) => !pair.key.trim()) ||
        new Set(pairs.map((pair) => pair.key.trim().toLowerCase())).size !==
          pairs.length
      )
        throw new Error(
          'Tên header hoặc biến môi trường không hợp lệ hoặc bị trùng.'
        );
      const mapping = Object.fromEntries(
        pairs.map((pair) => [pair.key.trim(), pair.reference])
      );
      const payload = {
        ...draft,
        boards: draft.boards.filter(Boolean),
        headers: draft.transport === 'http' ? mapping : {},
        env: draft.transport === 'stdio' ? mapping : {},
        command: draft.transport === 'stdio' ? draft.command : null,
        args: draft.transport === 'stdio' ? draft.args.filter(Boolean) : [],
        url: draft.transport === 'http' ? draft.url : null,
      };
      await request(
        original
          ? `mcp-registry/entries/${encodeURIComponent(original)}`
          : 'mcp-registry/entries',
        json(original ? 'PUT' : 'POST', payload)
      );
      setOriginal(payload.name);
      try {
        for (const pair of pairs)
          if (pair.value)
            await request(
              `mcp-registry/secrets/${encodeURIComponent(pair.reference)}`,
              json('PUT', { value: pair.value })
            );
      } catch (reason) {
        await reload();
        throw new Error(
          `Entry đã lưu nhưng không lưu được secret: ${String(reason)}`
        );
      }
      setDraft(null);
      setPairs([]);
      await reload();
      setMessage('Đã lưu HiveDeck MCP.');
    });
  const preset = (key: string) => {
    const value = presets[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const http = value.type === 'http' || typeof value.url === 'string';
    setDraft({
      ...empty(),
      name: key,
      transport: http ? 'http' : 'stdio',
      url: http ? String(value.url || '') : null,
      command: http ? null : String(value.command || ''),
      args: Array.isArray(value.args) ? value.args.map(String) : [],
    });
    const values = http ? value.headers : value.env;
    setPairs(
      values && typeof values === 'object' && !Array.isArray(values)
        ? Object.keys(values).map((name) => ({
            key: name,
            reference: reference(),
            value: '',
          }))
        : []
    );
  };
  return (
    <SettingsCard
      title="HiveDeck MCP"
      description="Server ở đây chạy trên mọi CLI trong run HiveDeck; không sửa config của CLI."
    >
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-normal">
          {message}
        </p>
      )}
      {entries.map((entry) => (
        <div
          key={entry.name}
          className="rounded-sm border border-border p-3 space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm text-high">{entry.name}</strong>
            <div className="flex gap-2">
              <button
                type="button"
                className={button}
                onClick={() => edit(entry)}
              >
                Sửa
              </button>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Xoá ${entry.name}?`))
                    void run(async () => {
                      const response = await fetch(
                        `/api/mcp-registry/entries/${encodeURIComponent(entry.name)}`,
                        { method: 'DELETE' }
                      );
                      if (!response.ok)
                        throw new Error('Không xoá được entry.');
                      await reload();
                    });
                }}
              >
                Xoá
              </button>
            </div>
          </div>
          <p className="text-sm text-low">
            {entry.transport} · {entry.roles.join(', ')} ·{' '}
            {entry.boards.length
              ? entry.boards
                  .map(
                    (id) => boards.find((board) => board.id === id)?.name || id
                  )
                  .join(', ')
              : 'Mọi board'}
          </p>
          {clashes(entry) && (
            <p className="text-sm text-warning">
              HiveDeck MCP sẽ thay server này trong run HiveDeck
            </p>
          )}
          {Object.entries(entry.headers)
            .filter(([, ref]) => !ref || !statuses[ref])
            .map(([name]) => warning(name))}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => edit(null)}>
          Thêm entry
        </button>
      </div>
      <details
        className="space-y-2"
        onToggle={(event) => {
          if (event.currentTarget.open)
            void run(async () => {
              setCandidates(
                await request<Candidate[]>(
                  `mcp-registry/import-candidates/${source}`
                )
              );
              setSelected([]);
            });
        }}
      >
        <summary className="cursor-pointer text-sm text-low underline">
          Lấy từ config CLI có sẵn
        </summary>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setCandidates(
                await request<Candidate[]>(
                  `mcp-registry/import-candidates/${source}`
                )
              );
              setSelected([]);
            })
          }
        >
          Xem server
        </button>
        <select
          aria-label="CLI import"
          className={button}
          value={source}
          onChange={(event) => {
            setSource(event.target.value as typeof source);
            setCandidates(null);
          }}
        >
          <option value="claude_code">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
        {candidates && (
          <div className="space-y-2">
            <p className="text-sm text-normal">Chọn server cần import</p>
            {candidates.map((candidate) => (
              <SettingsCheckbox
                key={candidate.name}
                id={`import-${candidate.name}`}
                label={`${candidate.name}${candidate.exists ? ' (đã tồn tại)' : ''}`}
                checked={selected.includes(candidate.name)}
                onChange={(checked) =>
                  setSelected(
                    checked
                      ? [...selected, candidate.name]
                      : selected.filter((name) => name !== candidate.name)
                  )
                }
              />
            ))}
            <button
              type="button"
              className={button}
              disabled={busy || !selected.length}
              onClick={() =>
                void run(async () => {
                  const result = await request<{
                    imported: string[];
                    skipped: string[];
                  }>(
                    'mcp-registry/import',
                    json('POST', { source, names: selected })
                  );
                  await reload();
                  setCandidates(null);
                  setMessage(
                    `Đã import: ${result.imported.join(', ') || 'không có'}. Bỏ qua: ${result.skipped.join(', ') || 'không có'}.`
                  );
                })
              }
            >
              Import đã chọn
            </button>
          </div>
        )}
      </details>
      {draft && (
        <div className="space-y-4 rounded-sm border border-border p-4">
          <h4 className="text-sm font-medium text-high">
            {original ? 'Sửa entry' : 'Thêm entry'}
          </h4>
          {!original && Object.keys(presets).length > 0 && (
            <label className="block text-sm text-normal">
              Preset{' '}
              <select
                aria-label="Preset"
                className={`${button} ml-2`}
                defaultValue=""
                onChange={(event) => preset(event.target.value)}
              >
                <option value="">Chọn preset</option>
                {Object.keys(presets).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <SettingsField label="Tên">
            <SettingsInput
              ariaLabel="Tên HiveDeck MCP"
              value={draft.name}
              onChange={(name) => setDraft({ ...draft, name })}
            />
            {draft.name === 'hivedeck' && (
              <p role="alert" className="text-sm text-error">
                Tên hivedeck được dành riêng cho HiveDeck.
              </p>
            )}
          </SettingsField>
          {clashes(draft) && (
            <p className="text-sm text-warning">
              HiveDeck MCP sẽ thay server này trong run HiveDeck
            </p>
          )}
          <label className="block text-sm text-normal">
            Transport{' '}
            <select
              aria-label="Transport"
              className={`${button} ml-2`}
              value={draft.transport}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  transport: event.target.value as 'http' | 'stdio',
                });
                setPairs([]);
              }}
            >
              <option value="http">HTTP</option>
              <option value="stdio">stdio</option>
            </select>
          </label>
          <SettingsField label={draft.transport === 'http' ? 'URL' : 'Command'}>
            <SettingsInput
              ariaLabel={draft.transport === 'http' ? 'URL' : 'Command'}
              value={
                (draft.transport === 'http' ? draft.url : draft.command) || ''
              }
              onChange={(value) =>
                setDraft(
                  draft.transport === 'http'
                    ? { ...draft, url: value }
                    : { ...draft, command: value }
                )
              }
            />
          </SettingsField>
          {draft.transport === 'stdio' && (
            <SettingsField label="Arguments (mỗi dòng một tham số)">
              <SettingsTextarea
                ariaLabel="Arguments"
                value={draft.args.join('\n')}
                onChange={(value) =>
                  setDraft({ ...draft, args: value.split('\n') })
                }
              />
            </SettingsField>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm text-normal">Vai trò</legend>
            {roles.map((role) => (
              <SettingsCheckbox
                key={role}
                id={`role-${role}`}
                label={role}
                checked={draft.roles.includes(role)}
                onChange={(checked) =>
                  setDraft({
                    ...draft,
                    roles: checked
                      ? [...draft.roles, role]
                      : draft.roles.filter((item) => item !== role),
                  })
                }
              />
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm text-normal">
              Board (không chọn = mọi board)
            </legend>
            {boards.map((board) => (
              <SettingsCheckbox
                key={board.id}
                id={`board-${board.id}`}
                label={board.name}
                checked={draft.boards.includes(board.id)}
                onChange={(checked) =>
                  setDraft({
                    ...draft,
                    boards: checked
                      ? [...draft.boards, board.id]
                      : draft.boards.filter((id) => id !== board.id),
                  })
                }
              />
            ))}
            {draft.boards
              .filter((id) => !boards.some((board) => board.id === id))
              .map((id) => (
                <SettingsCheckbox
                  key={id}
                  id={`board-${id}`}
                  label={id}
                  checked
                  onChange={() =>
                    setDraft({
                      ...draft,
                      boards: draft.boards.filter((item) => item !== id),
                    })
                  }
                />
              ))}
          </fieldset>
          <SettingsCheckbox
            id="registry-oauth"
            label="OAuth"
            checked={draft.oauth}
            onChange={(oauth) => setDraft({ ...draft, oauth })}
          />
          {draft.oauth && (
            <p className="text-sm text-warning">
              đăng nhập trong từng CLI; Claude Code chưa kiểm chứng
            </p>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm text-normal">
              {draft.transport === 'http' ? 'Headers' : 'Biến môi trường'}
            </legend>
            {pairs.map((pair, index) => (
              <div
                key={pair.reference}
                className="space-y-2 rounded-sm border border-border p-2"
              >
                <SettingsInput
                  ariaLabel={`Tên ${index + 1}`}
                  value={pair.key}
                  onChange={(key) =>
                    setPairs(
                      pairs.map((item, pos) =>
                        pos === index ? { ...item, key } : item
                      )
                    )
                  }
                />
                <label className="block text-sm text-low">
                  Secret: {statuses[pair.reference] ? 'đã đặt' : 'chưa đặt'}
                  <input
                    type="password"
                    autoComplete="new-password"
                    aria-label={`Secret ${pair.key || index + 1}`}
                    value={pair.value}
                    onChange={(event) =>
                      setPairs(
                        pairs.map((item, pos) =>
                          pos === index
                            ? { ...item, value: event.target.value }
                            : item
                        )
                      )
                    }
                    className="mt-1 w-full rounded-sm border border-border bg-secondary px-base py-half text-sm text-high"
                  />
                </label>
                {draft.transport === 'http' &&
                  !statuses[pair.reference] &&
                  !pair.value &&
                  warning(pair.key)}
                {pair.key.toLowerCase() === 'authorization' && (
                  <p className="text-xs text-low">
                    Nhập token, không gồm tiền tố Bearer.
                  </p>
                )}
                <button
                  type="button"
                  className={button}
                  onClick={() =>
                    setPairs(pairs.filter((_, pos) => pos !== index))
                  }
                >
                  Bỏ
                </button>
              </div>
            ))}
            <button
              type="button"
              className={button}
              onClick={() =>
                setPairs([
                  ...pairs,
                  { key: '', reference: reference(), value: '' },
                ])
              }
            >
              Thêm {draft.transport === 'http' ? 'header' : 'biến'}
            </button>
          </fieldset>
          <div className="flex gap-2">
            <button
              type="button"
              className={button}
              disabled={busy || draft.name === 'hivedeck'}
              onClick={save}
            >
              Lưu entry
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                setDraft(null);
                setPairs([]);
              }}
            >
              Huỷ
            </button>
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
