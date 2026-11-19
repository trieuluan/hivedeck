import type { JsonValue } from 'shared/types';

export function removeMcpOAuthSecrets(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const cleaned: JsonValue[] = [];
    let skipNext = false;
    for (const item of value) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (
        typeof item === 'string' &&
        /^--[^=]*(?:token|oauth|credential|secret)/i.test(item)
      ) {
        skipNext = !item.includes('=');
        continue;
      }
      cleaned.push(removeMcpOAuthSecrets(item));
    }
    return cleaned;
  }
  if (typeof value === 'string') {
    if (/^bearer\s+/i.test(value)) return '';
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      url.username = '';
      url.password = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/token|secret|oauth|credential/i.test(key))
          url.searchParams.delete(key);
      }
      return url.toString();
    }
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/authorization|oauth|token|credential|client[_-]?secret/i.test(key)
      )
      .map(([key, item]) => [key, removeMcpOAuthSecrets(item ?? null)])
  );
}
