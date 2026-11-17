import type { ReactNode } from 'react';
import { CaretDownIcon, SlidersHorizontalIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export function ChatSettingsPopover({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const { t } = useTranslation('common');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('modelSelector.agentModelThinking')}
          disabled={disabled}
          className="flex h-cta min-w-0 items-center gap-half rounded-sm border border-border bg-secondary px-base py-half text-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SlidersHorizontalIcon
            aria-hidden="true"
            className="size-icon-xs shrink-0 text-normal"
          />
          <span className="truncate text-normal">
            {t('modelSelector.agentModelThinking')}
          </span>
          <CaretDownIcon
            aria-hidden="true"
            className="size-icon-2xs shrink-0 text-normal"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))]"
        aria-label={t('modelSelector.agentModelThinking')}
      >
        <div className="flex flex-wrap items-center gap-half">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
