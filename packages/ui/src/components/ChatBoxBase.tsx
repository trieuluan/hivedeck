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
      {/* Status strip above the box: changes, turns, todos, session. */}
      {visualVariant === VisualVariant.NORMAL && (headerLeft || headerRight) && (
        <div className="flex min-h-8 items-center gap-base px-1 pb-1">
          <div className="flex flex-1 items-center gap-base text-xs text-low min-w-0 overflow-hidden">
            {headerLeft}
          </div>
          <Toolbar className="gap-[9px]">{headerRight}</Toolbar>
        </div>
      )}
      <div
        {...(dropzone?.getRootProps() ?? {})}
        className={cn(
          'relative flex flex-col rounded-2xl border border-border bg-secondary',
          className,
          (visualVariant === VisualVariant.FEEDBACK ||
            visualVariant === VisualVariant.EDIT ||
            visualVariant === VisualVariant.PLAN) &&
            'border-brand bg-brand/10',
          isRunning && 'chat-box-running'
        )}
      >
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

          {/* One row: attach & tools on the left; model and send on the right. */}
          <div className="flex items-center justify-between gap-base">
            <Toolbar className="min-w-0 flex-wrap !gap-half">
              {footerLeft}
            </Toolbar>
            <div className="flex min-w-0 shrink items-center justify-end gap-half">
              <Toolbar className="min-w-0 flex-wrap justify-end !gap-half">
                {modelSelector}
              </Toolbar>
              <div className="flex shrink-0 gap-half">{footerRight}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
