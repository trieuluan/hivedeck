import type {
  ConflictPolicy,
  ExecutorCompatibility,
  PluginConflict,
  InstalledPlugin,
  InstallPluginRequest,
  McpToolPolicy,
  PluginMcpEntry,
  PluginMcpOAuthStatus,
  PluginMcpToolInfo,
  PluginSecretStatus,
  PluginSkillEntry,
  PluginView,
  StartPluginOAuthResponse,
  UpgradePluginRequest,
} from 'shared/types';
import { handleApiResponse } from '@/shared/lib/api';

export class PluginConflictError extends Error {
  constructor(public conflicts: PluginConflict[]) {
    super('plugin_conflict');
    this.name = 'PluginConflictError';
  }
}

const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/plugins${path}`, init);
  if (response.status === 409) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as {
      error_data?: { conflicts?: PluginConflict[] };
    } | null;
    const conflicts = body?.error_data?.conflicts;
    if (conflicts?.length) throw new PluginConflictError(conflicts);
  }
  return handleApiResponse<T>(response);
};

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const seg = encodeURIComponent;

export type InstallInput = {
  source: string;
  singleMcp?: PluginMcpEntry;
  tag?: string;
  commit?: string;
  conflictPolicy?: ConflictPolicy;
  secrets?: InstallPluginRequest['secrets'];
};

const toRequest = (input: InstallInput): InstallPluginRequest => ({
  source: input.source.trim(),
  ...(input.singleMcp ? { single_mcp: input.singleMcp } : {}),
  version: null,
  commit: input.commit?.trim() || null,
  tag: input.tag?.trim() || null,
  roles: null,
  boards: null,
  skill_clis: null,
  conflict_policy: input.conflictPolicy ?? 'abort',
  secrets: input.secrets ?? {},
});

export type ScopePatch = {
  roles?: string[];
  boards?: string[];
  enabled?: boolean;
  tool_policies?: Record<string, McpToolPolicy | undefined>;
  instructions?: string;
};

export const pluginsApi = {
  list: () => call<PluginView[]>(''),
  compatibility: () => call<ExecutorCompatibility[]>('/compatibility'),
  preview: (input: InstallInput) =>
    call<InstalledPlugin>('/preview', json('POST', toRequest(input))),
  install: (input: InstallInput) =>
    call<PluginView>('/install', json('POST', toRequest(input))),
  upgrade: (name: string, req: Partial<UpgradePluginRequest>) =>
    call<PluginView>(
      `/${seg(name)}/upgrade`,
      json('POST', {
        source: null,
        version: null,
        commit: null,
        tag: null,
        conflict_policy: 'abort',
        ...req,
      })
    ),
  latestTag: (name: string) => call<string | null>(`/${seg(name)}/latest-tag`),
  remove: (name: string) => call<void>(`/${seg(name)}`, json('DELETE')),
  setEnabled: (name: string, enabled: boolean) =>
    call<PluginView>(
      `/${seg(name)}/${enabled ? 'enable' : 'disable'}`,
      json('POST')
    ),
  updateMcp: (name: string, mcp: string, patch: ScopePatch) =>
    call<PluginMcpEntry>(`/${seg(name)}/mcp/${seg(mcp)}`, json('PUT', patch)),
  updateSkill: (name: string, skill: string, patch: ScopePatch) =>
    call<PluginSkillEntry>(
      `/${seg(name)}/skills/${seg(skill)}`,
      json('PUT', patch)
    ),
  setSecret: (name: string, mcp: string, secret: string, value: string) =>
    call<PluginSecretStatus>(
      `/${seg(name)}/mcp/${seg(mcp)}/secrets/${seg(secret)}`,
      json('PUT', { value })
    ),
  clearSecret: (name: string, mcp: string, secret: string) =>
    call<PluginSecretStatus>(
      `/${seg(name)}/mcp/${seg(mcp)}/secrets/${seg(secret)}`,
      json('DELETE')
    ),
  startOAuth: (name: string, mcp: string, redirectUri: string) =>
    call<StartPluginOAuthResponse>(
      `/${seg(name)}/mcp/${seg(mcp)}/oauth/start`,
      json('POST', { redirect_uri: redirectUri })
    ),
  disconnectOAuth: (name: string, mcp: string) =>
    call<PluginMcpOAuthStatus>(
      `/${seg(name)}/mcp/${seg(mcp)}/oauth`,
      json('DELETE')
    ),
  listMcpTools: (name: string, mcp: string) =>
    call<PluginMcpToolInfo[]>(`/${seg(name)}/mcp/${seg(mcp)}/tools`),
};
