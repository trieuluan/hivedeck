import { useTranslation } from 'react-i18next';
import {
  CheckCircleIcon,
  WarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import type { PluginMcpEntry } from 'shared/types';
import { Tooltip } from '@vibe/ui/components/Tooltip';
import { cn } from '@/shared/lib/utils';

export type Compat = 'ok' | 'needs_setup' | 'unsupported';

export const secretRefs = (entry: PluginMcpEntry): string[] => [
  ...new Set(
    [...Object.values(entry.headers), ...Object.values(entry.env)].filter(
      (ref): ref is string => !!ref
    )
  ),
];

export function mcpCompat(entry: PluginMcpEntry): Compat {
  if (entry.transport !== 'stdio' && entry.transport !== 'http')
    return 'unsupported';
  if (entry.oauth || secretRefs(entry).length) return 'needs_setup';
  return 'ok';
}

const STYLE = {
  ok: { Icon: CheckCircleIcon, tone: 'text-success' },
  needs_setup: { Icon: WarningIcon, tone: 'text-warning' },
  unsupported: { Icon: XCircleIcon, tone: 'text-error' },
} as const;

export function CompatBadge({
  compat,
  className,
}: {
  compat: Compat;
  className?: string;
}) {
  const { t } = useTranslation('settings');
  const { Icon, tone } = STYLE[compat];
  const label = t(`settings.plugins.compat.${compat}`);
  return (
    <Tooltip content={t(`settings.plugins.compat.${compat}Hint`)}>
      <span
        tabIndex={0}
        role="img"
        aria-label={label}
        className={cn(
          'inline-flex items-center gap-1 text-xs',
          tone,
          className
        )}
      >
        <Icon className="h-4 w-4" weight="fill" aria-hidden />
        {label}
      </span>
    </Tooltip>
  );
}
