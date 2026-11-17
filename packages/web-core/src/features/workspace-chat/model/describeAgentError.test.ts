import { describe, expect, it } from 'vitest';
import {
  describeAgentError,
  extractProviderMessage,
} from './describeAgentError';

describe('describeAgentError', () => {
  it('recognises a combo model sent to ChatGPT', () => {
    const raw =
      'Error: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'planner\' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}';
    const d = describeAgentError(raw);
    expect(d.kind).toBe('modelUnavailable');
    expect(d.model).toBe('planner');
    expect(d.action).toBe('router');
    expect(d.message).toContain('not supported');
  });

  it('recognises an unreachable 9router', () => {
    const d = describeAgentError(
      'stream error: error sending request for url (http://127.0.0.1:20128/v1/responses): connection refused'
    );
    expect(d.kind).toBe('routerUnreachable');
  });

  it('recognises rate limits and expired logins', () => {
    expect(describeAgentError('HTTP 429 Too Many Requests').kind).toBe(
      'rateLimited'
    );
    expect(
      describeAgentError(
        'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}'
      ).kind
    ).toBe('authExpired');
  });

  it('falls back to generic with the provider message', () => {
    const d = describeAgentError(
      'Error: {"error":{"message":"Something odd"}}'
    );
    expect(d).toEqual({ kind: 'generic', message: 'Something odd' });
    expect(describeAgentError('plain failure').kind).toBe('generic');
  });
});

describe('extractProviderMessage', () => {
  it('handles top-level message, string error and bad JSON', () => {
    expect(extractProviderMessage('x {"message":"hi"}')).toBe('hi');
    expect(extractProviderMessage('{"error":"boom"}')).toBe('boom');
    expect(extractProviderMessage('{not json}')).toBeUndefined();
    expect(extractProviderMessage('no json')).toBeUndefined();
  });
});
