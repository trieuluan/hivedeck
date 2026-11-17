import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { IconButtonGroup, IconButtonGroupItem } from './IconButtonGroup';

export interface PreviewNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

interface PreviewNavigationProps {
  navigation: PreviewNavigationState | null;
  onBack: () => void;
  onForward: () => void;
  disabled?: boolean;
  className?: string;
}

export function PreviewNavigation({
  navigation,
  onBack,
  onForward,
  disabled = false,
  className,
}: PreviewNavigationProps) {
  const { t } = useTranslation();
  return (
    <IconButtonGroup className={className}>
      <IconButtonGroupItem
        icon={ArrowLeftIcon}
        onClick={onBack}
        disabled={!navigation?.canGoBack || disabled}
        aria-label={t('common:ui.goBack')}
        title={t('common:ui.goBack')}
      />
      <IconButtonGroupItem
        icon={ArrowRightIcon}
        onClick={onForward}
        disabled={!navigation?.canGoForward || disabled}
        aria-label={t('common:ui.goForward')}
        title={t('common:ui.goForward')}
      />
    </IconButtonGroup>
  );
}
