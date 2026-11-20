import { useState } from 'react';
import { cn } from '@/shared/lib/utils';

const TONES = [
  'bg-brand/15 text-brand border-brand/25',
  'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
  'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/25',
  'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25',
] as const;

const KNOWN_EXTERNAL_PLUGIN_OWNERS: Record<string, string> = {
  asana: 'Asana',
  context7: 'upstash',
  discord: 'discord',
  firebase: 'firebase',
  github: 'github',
  gitlab: 'gitlabhq',
  higgsfield: 'higgsfield-ai',
  'laravel-boost': 'laravel',
  linear: 'linear',
  playwright: 'microsoft',
  serena: 'oraios',
  telegram: 'telegramdesktop',
  terraform: 'hashicorp',
};

function extractGithubOwner(value?: string | null): string | null {
  if (!value) return null;
  const match = value.match(/github\.com[:/]([a-zA-Z0-9_.-]+)\//i);
  if (match?.[1] && match[1] !== '.' && match[1] !== '..') {
    return match[1];
  }
  return null;
}

export function resolvePluginSourceOwner(
  name: string,
  source?: unknown,
  installSource?: string | null
): string | null {
  const normalizedName = name.trim().toLowerCase();
  if (KNOWN_EXTERNAL_PLUGIN_OWNERS[normalizedName]) {
    return KNOWN_EXTERNAL_PLUGIN_OWNERS[normalizedName]!;
  }

  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed.startsWith('./external_plugins/')) {
      const slug = trimmed
        .slice('./external_plugins/'.length)
        .split('/')[0]
        ?.toLowerCase();
      if (slug && KNOWN_EXTERNAL_PLUGIN_OWNERS[slug]) {
        return KNOWN_EXTERNAL_PLUGIN_OWNERS[slug]!;
      }
    }
    if (trimmed.startsWith('./plugins/')) {
      return 'anthropics';
    }
    const fromString = extractGithubOwner(trimmed);
    if (fromString) return fromString;
  } else if (source && typeof source === 'object') {
    const record = source as Record<string, unknown>;
    if (typeof record.repo === 'string') {
      const repoOwner = record.repo.trim().split('/')[0];
      if (repoOwner && /^[a-zA-Z0-9_.-]+$/.test(repoOwner)) {
        return repoOwner;
      }
    }
    if (typeof record.url === 'string') {
      const fromUrl = extractGithubOwner(record.url);
      if (fromUrl) return fromUrl;
    }
  }

  return extractGithubOwner(installSource);
}

export function resolvePluginSourceLogoUrl(
  name: string,
  source?: unknown,
  installSource?: string | null
): string | null {
  const owner = resolvePluginSourceOwner(name, source, installSource);
  if (!owner) return null;
  return `https://github.com/${encodeURIComponent(owner)}.png?size=64`;
}

export function resolvePluginLogoUrl(
  icon?: string | null,
  logo?: string | null
): string | null {
  for (const candidate of [icon, logo]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith('https://') ||
      trimmed.startsWith('http://') ||
      (trimmed.startsWith('/') && !trimmed.startsWith('//'))
    ) {
      return trimmed;
    }
  }
  return null;
}

export function pluginInitials(name: string): string {
  const parts = name
    .trim()
    .split(/[-_\s./@]+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return 'P';
}

export function pluginAvatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TONES[hash % TONES.length]!;
}

export function PluginAvatar({
  name,
  icon,
  logo,
  source,
  installSource,
  size = 'md',
  className,
}: {
  name: string;
  icon?: string | null;
  logo?: string | null;
  source?: unknown;
  installSource?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const logoUrl =
    resolvePluginLogoUrl(icon, logo) ??
    resolvePluginSourceLogoUrl(name, source, installSource);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(logoUrl && failedUrl !== logoUrl);
  const boxSize = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';

  if (showImage && logoUrl) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-panel p-0.5',
          boxSize,
          className
        )}
      >
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full rounded-[4px] object-contain"
          onError={() => setFailedUrl(logoUrl)}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-md border font-semibold tracking-tight',
        boxSize,
        pluginAvatarTone(name),
        className
      )}
    >
      {pluginInitials(name)}
    </span>
  );
}
