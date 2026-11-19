import { describe, expect, it } from 'vitest';
import { removeMcpOAuthSecrets } from './mcpSync';

describe('removeMcpOAuthSecrets', () => {
  it('removes OAuth material while retaining ordinary settings', () => {
    expect(
      removeMcpOAuthSecrets({
        url: 'https://user:pass@example.com/mcp?access_token=secret&mode=ok',
        headers: { Authorization: 'Bearer secret', 'X-Test': 'ok' },
        env: { ACCESS_TOKEN: 'secret', SAFE: 'ok' },
        args: ['--token', 'secret', '--safe', 'ok', '--oauth-token=secret'],
      })
    ).toEqual({
      url: 'https://example.com/mcp?mode=ok',
      headers: { 'X-Test': 'ok' },
      env: { SAFE: 'ok' },
      args: ['--safe', 'ok'],
    });
  });
});
