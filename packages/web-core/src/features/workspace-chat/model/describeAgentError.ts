/**
 * Turn a raw agent error (often a JSON blob from a provider) into something
 * the owner can act on: a short title, a hint, and where to fix it. The raw
 * text stays available as details.
 */

export type AgentErrorKind =
  | 'modelUnavailable'
  | 'routerUnreachable'
  | 'rateLimited'
  | 'authExpired'
  | 'generic';

export type AgentErrorAction = 'router';

export interface AgentErrorDescription {
  kind: AgentErrorKind;
  /** Model name for `modelUnavailable`. */
  model?: string;
  /** Provider message extracted from a JSON payload, if any. */
  message?: string;
  action?: AgentErrorAction;
}

/** Pull `error.message` (or `message`) out of the first JSON object found. */
export function extractProviderMessage(content: string): string | undefined {
  const start = content.indexOf('{');
  if (start === -1) return undefined;
  const end = content.lastIndexOf('}');
  if (end <= start) return undefined;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      message?: unknown;
      error?: { message?: unknown } | string;
    };
    const nested =
      typeof parsed.error === 'object' && parsed.error !== null
        ? parsed.error.message
        : undefined;
    const message =
      nested ??
      parsed.message ??
      (typeof parsed.error === 'string' ? parsed.error : undefined);
    return typeof message === 'string' && message.trim()
      ? message.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export function describeAgentError(content: string): AgentErrorDescription {
  const text = content.toLowerCase();
  const message = extractProviderMessage(content);

  const modelMatch =
    /the '([^']+)' model is not supported/i.exec(content) ??
    /model[ `'"]+([\w./:-]+)[`'"]? (?:does not exist|not found|is not available)/i.exec(
      content
    );
  if (text.includes('model_not_found') || modelMatch) {
    return {
      kind: 'modelUnavailable',
      model: modelMatch?.[1],
      message,
      action: 'router',
    };
  }

  if (
    (text.includes('127.0.0.1:20128') || text.includes('9router')) &&
    /(connection refused|error sending request|connect|unreachable|econnrefused)/.test(
      text
    )
  ) {
    return { kind: 'routerUnreachable', message, action: 'router' };
  }

  if (/\b429\b|rate.?limit|usage limit|quota|too many requests/.test(text)) {
    return { kind: 'rateLimited', message, action: 'router' };
  }

  if (
    /\b401\b|oauth token has expired|authentication_error|please run \/login|not logged in|invalid api key|unauthorized/.test(
      text
    )
  ) {
    return { kind: 'authExpired', message };
  }

  return { kind: 'generic', message };
}

/** An answer that is really a provider error ("API Error: 503 …"). */
export function isAgentErrorText(content: string): boolean {
  return /^\s*API Error:/.test(content);
}
