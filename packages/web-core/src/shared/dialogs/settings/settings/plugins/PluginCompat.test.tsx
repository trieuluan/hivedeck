import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PluginMcpEntry } from 'shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CompatBadge, mcpCompat, secretRefs } from './pluginCompat';

const entry = (patch: Partial<PluginMcpEntry> = {}): PluginMcpEntry => ({
  name: 'tool',
  transport: 'stdio',
  command: 'node',
  args: [],
  headers: {},
  env: {},
  roles: ['crew'],
  boards: [],
  oauth: false,
  enabled: true,
  ...patch,
});

describe('mcpCompat', () => {
  it('plain server is ok', () => {
    expect(mcpCompat(entry())).toBe('ok');
  });
  it('secret refs or oauth need setup', () => {
    expect(mcpCompat(entry({ env: { TOKEN: 'API_KEY' } }))).toBe('needs_setup');
    expect(mcpCompat(entry({ transport: 'http', oauth: true }))).toBe(
      'needs_setup'
    );
  });
  it('unknown transport is unsupported', () => {
    expect(mcpCompat(entry({ transport: 'websocket' }))).toBe('unsupported');
  });
  it('dedupes secret refs', () => {
    expect(
      secretRefs(entry({ env: { A: 'KEY', B: 'KEY' }, headers: { H: 'TOK' } }))
    ).toEqual(['TOK', 'KEY']);
  });
});

describe('CompatBadge', () => {
  it('renders an accessible label', () => {
    const html = renderToStaticMarkup(<CompatBadge compat="unsupported" />);
    expect(html).toContain('aria-label="settings.plugins.compat.unsupported"');
  });
});
