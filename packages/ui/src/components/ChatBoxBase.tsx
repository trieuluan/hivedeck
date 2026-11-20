import { type ReactNode } from 'react';
import { ImageIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { Toolbar } from './Toolbar';

export enum VisualVariant {
  NORMAL = 'NORMAL',
  FEEDBACK = 'FEEDBACK',
  EDIT = 'EDIT',
  PLAN = 'PLAN',
}

export interface DropzoneProps {
  getRootProps: () => Record<string, unknown>;
  getInputProps: () => Record<string, unknown>;
  isDragActive: boolean;
}

interface ChatBoxBaseProps {
  className?: string;
  keyboardHint?: ReactNode;
  // Editor node (provided by frontend)
  editor: ReactNode;

  // Error display
  error?: string | null;

  // Header content (right side - session/executor dropdown)
  headerRight?: ReactNode;

  // Header content (left side - stats)
  headerLeft?: ReactNode;

  // Footer left content (additional toolbar items like attach button)
  footerLeft?: ReactNode;

  // Footer right content (action buttons)
  footerRight: ReactNode;

  // Model selector node (rendered with footer controls)
  modelSelector?: ReactNode;

  // Banner content (queued message indicator, feedback mode indicator)
  banner?: ReactNode;

  // visualVariant
  visualVariant: VisualVariant;

  // Whether the workspace is running (shows animated border)
  isRunning?: boolean;

  // Dropzone props for drag-and-drop image uploads
  dropzone?: DropzoneProps;
}

/**
 * Base chat box layout component.
 * Provides shared structure for CreateChatBox and SessionChatBox.
 */
export function ChatBoxBase({
  editor,
  error,
  headerRight,
  headerLeft,
  footerLeft,
  footerRight,
  modelSelector,
  banner,
  visualVariant,
  isRunning,
  dropzone,
  className,
}: ChatBoxBaseProps) {
  const { t } = useTranslation(['common', 'tasks']);

  const isDragActive = dropzone?.isDragActive ?? false;

  return (
    <div className="flex w-chat max-w-full flex-col">
      <div
        {...(dropzone?.getRootProps() ?? {})}
        className={cn(
          'relative flex flex-col rounded-xl border border-border/90 bg-secondary/95 shadow-sm transition-colors focus-within:border-brand/50',
          className,
          (visualVariant === VisualVariant.FEEDBACK ||
            visualVariant === VisualVariant.EDIT ||
            visualVariant === VisualVariant.PLAN) &&
            'border-brand bg-brand/10',
          isRunning && 'chat-box-running'
        )}
      >
        {/* Status strip integrated cleanly at top of the composer card */}
        {visualVariant === VisualVariant.NORMAL &&
          (headerLeft || headerRight) && (
            <div className="flex min-h-9 items-center gap-base rounded-t-xl border-b border-border/60 bg-panel/45 px-3 py-1">
              <div className="flex min-w-0 flex-1 items-center gap-base overflow-hidden text-xs text-low">
                {headerLeft}
              </div>
              <Toolbar className="gap-1.5">{headerRight}</Toolbar>
            </div>
          )}
        {dropzone && <input {...dropzone.getInputProps()} />}

        {isDragActive && (
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-primary/80 backdrop-blur-sm pointer-events-none animate-in fade-in-0 duration-150">
            <div className="text-center">
              <div className="mx-auto mb-2 w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
                <ImageIcon className="h-5 w-5 text-brand" />
              </div>
              <p className="text-sm font-medium text-high">
                {t('tasks:dropzone.dropImagesHere')}
              </p>
              <p className="text-xs text-low mt-0.5">
                {t('tasks:dropzone.supportedFormats')}
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-t-2xl bg-error/10 border-b px-double py-base">
            <p className="text-error text-sm">{error}</p>
          </div>
        )}

        {/* Banner content (queued indicator, feedback mode, etc.) */}
        {banner}

        <div className="flex flex-col gap-base px-base pt-base pb-half">
          {editor}

          {/* Tools and model on the left (they wrap when narrow); send
              stays pinned bottom-right. */}
          <div className="flex items-end justify-between gap-base">
            <Toolbar className="min-w-0 flex-1 flex-wrap !gap-half">
              {footerLeft}
              {modelSelector}
            </Toolbar>
            <div className="flex shrink-0 items-center gap-half">
              {footerRight}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
