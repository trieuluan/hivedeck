import { type ChangeEvent, type ReactNode, useRef } from 'react';
import {
  type Icon,
  PaperclipIcon,
  CheckIcon,
  ClockIcon,
  XIcon,
  PlusIcon,
  SpinnerIcon,
  ChatCircleIcon,
  TrashIcon,
  WarningIcon,
  ArrowUpIcon,
  ArrowsOutIcon,
  GithubLogoIcon,
  PencilSimpleIcon,
  SquareIcon,
  DotsThreeIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { SendMessageShortcut } from 'shared/types';
import { getModifierKey } from '../lib/platform';
import { ChatBoxBase, VisualVariant, type DropzoneProps } from './ChatBoxBase';
import { PulsingDot } from './PulsingDot';
import { type EditorProps, type ExecutorProps } from './CreateChatBox';
import type { AskUserQuestionItem, QuestionAnswer } from 'shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTriggerButton,
} from './Dropdown';
import { PrimaryButton } from './PrimaryButton';
import type { LocalAttachmentMetadata } from './WorkspaceContext';
import { ToolbarDropdown, ToolbarIconButton } from './Toolbar';
import { ContextUsageGauge, type ContextUsageInfo } from './ContextUsageGauge';
import { TodoProgressPopup, type TodoProgressItem } from './TodoProgressPopup';
import {
  AskUserQuestionBanner,
  type AskUserQuestionBannerHandle,
} from './AskUserQuestionBanner';
import {
  TurnNavigationPopup,
  type TurnNavigationItem,
} from './TurnNavigationPopup';
import { ChatSettingsPopover } from './ChatSettingsPopover';
import {
  AgentActivityIndicator,
  type AgentActivity,
} from './AgentActivityIndicator';

// Status enum - single source of truth for execution state
export type ExecutionStatus =
  | 'idle'
  | 'sending'
  | 'running'
  | 'queued'
  | 'stopping'
  | 'queue-loading'
  | 'feedback'
  | 'edit'
  // Headed mid-turn: compose is disabled; Stop uses the existing execution stop.
  // Headed-idle reuses 'idle' with onSend routed to live send-input.
  | 'headed-busy';

interface ActionsProps {
  onSend: () => void;
  onQueue: () => void;
  onCancelQueue: () => void;
  onStop: () => void;
  onPasteFiles: (files: File[]) => void;
}

export interface SessionOption<TExecutor extends string = string> {
  id: string;
  name?: string | null;
  created_at: string | Date;
  executor?: TExecutor | string | null;
}

interface SessionProps<TExecutor extends string = string> {
  sessions: SessionOption<TExecutor>[];
  selectedSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  isNewSessionMode?: boolean;
  onNewSession?: () => void;
  onRenameSession?: (sessionId: string, currentName: string) => void;
}

export interface SessionToolbarActionItem {
  id: string;
  icon: Icon;
  label: string;
  tooltip?: string;
  onClick: () => void;
  disabled?: boolean;
}

interface ToolbarActionsProps {
  items: SessionToolbarActionItem[];
}

interface StatsProps {
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
  hasConflicts?: boolean;
  conflictedFilesCount?: number;
  onResolveConflicts?: () => void;
}

interface FeedbackModeProps {
  isActive: boolean;
  onSubmitFeedback: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error?: string | null;
  isTimedOut: boolean;
}

interface EditModeProps {
  isActive: boolean;
  onSubmitEdit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

interface ApprovalModeProps {
  isActive: boolean;
  onApprove: () => void;
  onRequestChanges: () => void;
  isSubmitting: boolean;
  isTimedOut: boolean;
  error?: string | null;
}

interface AskQuestionModeProps {
  isActive: boolean;
  questions: AskUserQuestionItem[];
  onSubmitAnswers: (answers: QuestionAnswer[]) => void;
  isSubmitting: boolean;
  isTimedOut: boolean;
  error?: string | null;
}

interface ReviewCommentsProps {
  /** Number of review comments */
  count: number;
  /** Preview markdown of the comments */
  previewMarkdown: string;
  /** Clear all comments */
  onClear: () => void;
}

export interface SessionChatBoxEditorRenderProps<
  TExecutor extends string = string,
> {
  focusKey: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onCmdEnter: () => void;
  disabled: boolean;
  repoIds?: string[];
  executor: TExecutor | null;
  onPasteFiles: (files: File[]) => void;
  localAttachments?: LocalAttachmentMetadata[];
}

interface SessionChatBoxProps<TExecutor extends string = string> {
  status: ExecutionStatus;
  editor: EditorProps;
  renderEditor: (
    props: SessionChatBoxEditorRenderProps<TExecutor>
  ) => ReactNode;
  actions: ActionsProps;
  session: SessionProps<TExecutor>;
  stats?: StatsProps;
  feedbackMode?: FeedbackModeProps;
  editMode?: EditModeProps;
  approvalMode?: ApprovalModeProps;
  askQuestionMode?: AskQuestionModeProps;
  reviewComments?: ReviewCommentsProps;
  toolbarActions?: ToolbarActionsProps;
  modelSelector?: ReactNode;
  error?: string | null;
  /** The chat is with a project's captain (not a coding agent). */
  isCaptain?: boolean;
  repoIds?: string[];
  agent?: TExecutor | null;
  executor?: ExecutorProps<TExecutor>;
  formatExecutorLabel?: (executor: TExecutor) => string;
  emptyExecutorLabel?: string;
  renderAgentIcon?: (
    executor: TExecutor | string | null | undefined,
    className?: string
  ) => ReactNode;
  formatSessionDate?: (createdAt: string | Date) => string;
  /** Run timing of the active agent process; drives elapsed/stale display. */
  activity?: AgentActivity | null;
  todos?: TodoProgressItem[];
  inProgressTodo?: TodoProgressItem | null;
  localAttachments?: LocalAttachmentMetadata[];
  onPrCommentClick?: () => void;
  onViewCode?: () => void;
  onOpenWorkspace?: () => void;
  onScrollToPreviousMessage?: () => void;
  userMessageTurns?: TurnNavigationItem[];
  onScrollToUserMessage?: (patchKey: string) => void;
  getActiveTurnPatchKey?: () => string | null;
  tokenUsageInfo?: ContextUsageInfo | null;
  supportsContextUsage?: boolean;
  sendShortcut?: SendMessageShortcut;
  dropzone?: DropzoneProps;
  /**
   * Disable all content-insertion affordances (attachment paperclip + dropzone).
   * Used by headed-live (interactive) sessions where input is plain tmux typing
   * and files cannot be uploaded. Default false.
   */
  disableContentInsert?: boolean;
  /**
   * Whether to show the animated (shimmering) border around the message box
   * while working. Default true. A subtle pulsating dot is always shown while
   * working regardless of this flag.
   */
  animateRunningOutline?: boolean;
}

function defaultExecutorLabel(executor: string) {
  return executor
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function defaultFormatSessionDate(createdAt: string | Date) {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return String(createdAt);
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Full-featured chat box for session mode.
 * Supports queue, stop, attach, feedback mode, stats, and session switching.
 */
export function SessionChatBox<TExecutor extends string = string>({
  status,
  editor,
  renderEditor,
  actions,
  session,
  stats,
  feedbackMode,
  editMode,
  approvalMode,
  askQuestionMode,
  reviewComments,
  toolbarActions,
  modelSelector,
  error,
  repoIds,
  agent,
  executor,
  formatExecutorLabel = defaultExecutorLabel,
  emptyExecutorLabel = 'Select Executor',
  renderAgentIcon,
  formatSessionDate = defaultFormatSessionDate,
  activity,
  todos,
  inProgressTodo,
  localAttachments,
  onPrCommentClick,
  onViewCode,
  onOpenWorkspace,
  onScrollToPreviousMessage,
  userMessageTurns,
  onScrollToUserMessage,
  getActiveTurnPatchKey,
  tokenUsageInfo,
  supportsContextUsage,
  sendShortcut = 'ModifierEnter',
  dropzone,
  disableContentInsert = false,
  animateRunningOutline = true,
  isCaptain = false,
}: SessionChatBoxProps<TExecutor>) {
  const { t, i18n } = useTranslation('tasks');
  const isVietnamese = (i18n.resolvedLanguage ?? i18n.language).startsWith(
    'vi'
  );
  const sendIconLabel = t('conversation.actions.send');
  const sendKeys =
    sendShortcut === 'Enter' ? 'Enter' : `${getModifierKey()}+Enter`;
  const sendTitle = `${sendIconLabel} · ${t('conversation.composer.sendHint', {
    shortcut: sendKeys,
    defaultValue: isVietnamese
      ? '{{shortcut}} để gửi · Shift+Enter xuống dòng'
      : '{{shortcut}} to send · Shift+Enter for a new line',
  })}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const askQuestionBannerRef = useRef<AskUserQuestionBannerHandle>(null);

  // Determine if in feedback mode, edit mode, or approval mode
  const isInFeedbackMode = feedbackMode?.isActive ?? false;
  const isInEditMode = editMode?.isActive ?? false;
  const isInApprovalMode = approvalMode?.isActive ?? false;
  const isInAskQuestionMode = askQuestionMode?.isActive ?? false;

  // Key to force editor remount when entering feedback/edit/approval/question mode (triggers auto-focus)
  const focusKey = isInFeedbackMode
    ? 'feedback'
    : isInEditMode
      ? 'edit'
      : isInApprovalMode
        ? 'approval'
        : isInAskQuestionMode
          ? 'question'
          : 'normal';

  const isDisabled = Boolean(
    status === 'sending' ||
      status === 'stopping' ||
      status === 'queue-loading' ||
      feedbackMode?.isSubmitting ||
      editMode?.isSubmitting ||
      approvalMode?.isSubmitting ||
      askQuestionMode?.isSubmitting
  );
  const isQueued = status === 'queued';
  const isRunning = status === 'running' || isQueued;
  const isComposerDisabled =
    isDisabled ||
    ((isRunning || status === 'headed-busy') &&
      !isInFeedbackMode &&
      !isInEditMode &&
      !isInApprovalMode &&
      !isInAskQuestionMode);
  const hasContent =
    editor.value.trim().length > 0 || (reviewComments?.count ?? 0) > 0;
  // Existing drafts can still be queued while the editor is locked.
  const canSend = hasContent && !isDisabled;
  const areContentInsertActionsDisabled =
    isComposerDisabled || isQueued || disableContentInsert;
  // The pulsating dot (subtle, always on) shows for every actively-working
  // state including headed-live mid-turn turns. The animated border is the
  // eye-catching variant, gated behind the settings toggle, and only for the
  // classic headless statuses (not headed-live, where the tmux timeline
  // already signals activity).
  const isActivelyWorking =
    status === 'running' || status === 'queued' || status === 'sending';
  const showRunningAnimation =
    (isActivelyWorking || status === 'headed-busy') &&
    !isInApprovalMode &&
    !isInAskQuestionMode &&
    editor.value.trim().length === 0;
  const showRunningOutline =
    isActivelyWorking &&
    !isInApprovalMode &&
    !isInAskQuestionMode &&
    editor.value.trim().length === 0 &&
    animateRunningOutline;

  const placeholder = isInFeedbackMode
    ? 'Provide feedback for the plan...'
    : isInEditMode
      ? 'Edit your message...'
      : isInApprovalMode
        ? 'Provide feedback to request changes...'
        : isInAskQuestionMode
          ? 'Type a different answer...'
          : isCaptain
            ? t('conversation.composer.placeholder', {
                defaultValue: isVietnamese
                  ? 'Nhắn thuyền trưởng…'
                  : 'Message the captain…',
              })
            : t('conversation.composer.agentPlaceholder', {
                defaultValue: isVietnamese
                  ? 'Nhắn agent…'
                  : 'Message the agent…',
              });

  // Cmd+Enter handler
  const handleCmdEnter = () => {
    if (isComposerDisabled) return;
    // AskUserQuestion mode: Enter submits custom text as answer
    if (isInAskQuestionMode && hasContent && !askQuestionMode?.isTimedOut) {
      askQuestionBannerRef.current?.submitCustomAnswer(editor.value);
      editor.onChange('');
      return;
    }
    // Approval mode: Cmd+Enter triggers approve or request changes based on input
    if (isInApprovalMode && !approvalMode?.isTimedOut) {
      if (canSend) {
        approvalMode?.onRequestChanges();
      } else {
        approvalMode?.onApprove();
      }
      return;
    }
    if (isInFeedbackMode && canSend && !feedbackMode?.isTimedOut) {
      feedbackMode?.onSubmitFeedback();
    } else if (isInEditMode && canSend) {
      editMode?.onSubmitEdit();
    } else if (status === 'running' && canSend) {
      actions.onQueue();
    } else if (status === 'idle' && canSend) {
      actions.onSend();
    }
  };

  // File input handlers
  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      actions.onPasteFiles(files);
    }
    e.target.value = '';
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const {
    sessions,
    selectedSessionId,
    onSelectSession,
    isNewSessionMode,
    onNewSession,
    onRenameSession,
  } = session;
  const isLatestSelected =
    sessions.length > 0 && selectedSessionId === sessions[0].id;
  const selectedSessionObj = sessions.find((s) => s.id === selectedSessionId);
  const sessionLabel = isNewSessionMode
    ? t('conversation.sessions.newSession')
    : selectedSessionObj?.name
      ? selectedSessionObj.name
      : isLatestSelected
        ? t('conversation.sessions.latest')
        : t('conversation.sessions.previous');

  // Stats
  const filesChanged = stats?.filesChanged ?? 0;
  const linesAdded = stats?.linesAdded;
  const linesRemoved = stats?.linesRemoved;

  // Render action buttons based on status
  const stopButton = (
    <button
      type="button"
      onClick={actions.onStop}
      disabled={status === 'stopping'}
      aria-label={t('conversation.actions.stop')}
      title={t('conversation.actions.stop')}
      className="ship-stop flex size-8 items-center justify-center rounded-full border border-border bg-primary text-high hover:border-error hover:text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <SquareIcon aria-hidden="true" className="size-3" weight="fill" />
    </button>
  );
  const sendButton = (disabled: boolean) => (
    <button
      type="button"
      onClick={actions.onSend}
      disabled={disabled}
      aria-label={sendIconLabel}
      title={sendTitle}
      className="ship-send flex size-8 items-center justify-center rounded-full bg-brand text-on-brand hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40"
    >
      <ArrowUpIcon aria-hidden="true" className="size-4" weight="bold" />
    </button>
  );

  const renderActionButtons = () => {
    // Feedback mode takes precedence.
    if (isInFeedbackMode) {
      if (feedbackMode?.isTimedOut) {
        return (
          <PrimaryButton
            variant="secondary"
            onClick={feedbackMode.onCancel}
            value={t('conversation.actions.cancel')}
          />
        );
      }
      return (
        <>
          <PrimaryButton
            variant="secondary"
            onClick={feedbackMode?.onCancel}
            value={t('conversation.actions.cancel')}
          />
          <PrimaryButton
            onClick={feedbackMode?.onSubmitFeedback}
            disabled={!canSend || feedbackMode?.isSubmitting}
            actionIcon={feedbackMode?.isSubmitting ? 'spinner' : undefined}
            value={t('conversation.actions.submitFeedback')}
          />
        </>
      );
    }

    // Edit mode
    if (isInEditMode) {
      return (
        <>
          <PrimaryButton
            variant="secondary"
            onClick={editMode?.onCancel}
            value={t('conversation.actions.cancel')}
          />
          <PrimaryButton
            onClick={editMode?.onSubmitEdit}
            disabled={!canSend || editMode?.isSubmitting}
            actionIcon={editMode?.isSubmitting ? 'spinner' : undefined}
            value={t('conversation.retry')}
          />
        </>
      );
    }

    // Approval mode
    if (isInApprovalMode) {
      if (approvalMode?.isTimedOut) {
        return stopButton;
      }

      const hasMessage = editor.value.trim().length > 0;

      return (
        <>
          {stopButton}
          {hasMessage ? (
            <PrimaryButton
              onClick={approvalMode?.onRequestChanges}
              disabled={approvalMode?.isSubmitting}
              actionIcon={approvalMode?.isSubmitting ? 'spinner' : undefined}
              value={t('conversation.actions.requestChanges')}
            />
          ) : (
            <PrimaryButton
              onClick={approvalMode?.onApprove}
              disabled={approvalMode?.isSubmitting}
              actionIcon={approvalMode?.isSubmitting ? 'spinner' : undefined}
              value={t('conversation.actions.approve')}
            />
          )}
        </>
      );
    }

    // AskUserQuestion mode
    if (isInAskQuestionMode) {
      if (askQuestionMode?.isTimedOut) {
        return stopButton;
      }

      const hasMessage = editor.value.trim().length > 0;

      return (
        <>
          {stopButton}
          {hasMessage && (
            <PrimaryButton
              onClick={() => {
                askQuestionBannerRef.current?.submitCustomAnswer(editor.value);
                editor.onChange('');
              }}
              disabled={askQuestionMode?.isSubmitting}
              actionIcon={askQuestionMode?.isSubmitting ? 'spinner' : undefined}
              value={t('conversation.actions.send')}
            />
          )}
        </>
      );
    }

    switch (status) {
      case 'idle':
        return sendButton(!canSend);

      case 'sending':
        return (
          <>
            {stopButton}
            {sendButton(true)}
          </>
        );

      case 'running':
        // While the agent works, typed text is queued for its next turn.
        return (
          <>
            {canSend && (
              <button
                type="button"
                onClick={actions.onQueue}
                aria-label={t('conversation.actions.queue')}
                title={t('conversation.actions.queue')}
                className="flex size-8 items-center justify-center rounded-full bg-brand text-on-brand hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                <ClockIcon
                  aria-hidden="true"
                  className="size-4"
                  weight="bold"
                />
              </button>
            )}
            {stopButton}
          </>
        );

      case 'queued':
        return (
          <>
            <PrimaryButton
              onClick={actions.onCancelQueue}
              value={t('conversation.actions.cancelQueue')}
              actionIcon={XIcon}
              className="h-8 rounded-full text-xs"
            />
            {stopButton}
          </>
        );

      case 'stopping':
        return stopButton;
      case 'queue-loading':
        return sendButton(true);
      case 'headed-busy':
        // Headed session mid-turn: Send disabled until the turn settles (the
        // live agent is driven via send-input on idle). Stop uses the existing
        // onStop wiring (stopExecution).
        return (
          <>
            {stopButton}
            {sendButton(true)}
          </>
        );
      case 'feedback':
      case 'edit':
        return null;
    }
  };

  // Banner content
  const renderBanner = () => {
    const banners: ReactNode[] = [];

    // Review comments banner
    if (reviewComments && reviewComments.count > 0) {
      banners.push(
        <div
          key="review-comments"
          className="bg-accent/5 border-b px-double py-base flex items-center gap-base"
        >
          <ChatCircleIcon className="h-4 w-4 text-brand flex-shrink-0" />
          <span className="text-sm text-normal flex-1">
            {t('conversation.reviewComments.count', {
              count: reviewComments.count,
            })}
          </span>
          <button
            onClick={reviewComments.onClear}
            className="text-low hover:text-normal transition-colors p-1 -m-1"
            title={t('conversation.actions.clearReviewComments')}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      );
    }

    // AskUserQuestion banner (renders above input)
    if (isInAskQuestionMode && askQuestionMode) {
      banners.push(
        <AskUserQuestionBanner
          key="ask-question"
          ref={askQuestionBannerRef}
          questions={askQuestionMode.questions}
          onSubmitAnswers={askQuestionMode.onSubmitAnswers}
          isSubmitting={askQuestionMode.isSubmitting}
          isTimedOut={askQuestionMode.isTimedOut}
          error={askQuestionMode.error ?? null}
        />
      );
    }

    // Queued message banner
    if (isQueued) {
      banners.push(
        <div
          key="queued"
          className="bg-secondary border-b px-double py-base flex items-center gap-base"
        >
          <ClockIcon className="h-4 w-4 text-low" />
          <span className="text-sm text-low">
            {t('followUp.queuedMessage')}
          </span>
        </div>
      );
    }

    return banners.length > 0 ? <>{banners}</> : null;
  };

  // Combine errors
  const displayError =
    feedbackMode?.error ??
    approvalMode?.error ??
    askQuestionMode?.error ??
    error;

  // Determine visual variant
  const getVisualVariant = () => {
    if (isInFeedbackMode) return VisualVariant.FEEDBACK;
    if (isInEditMode) return VisualVariant.EDIT;
    if (isInApprovalMode || isInAskQuestionMode) return VisualVariant.PLAN;
    return VisualVariant.NORMAL;
  };

  return (
    <ChatBoxBase
      editor={renderEditor({
        focusKey,
        placeholder,
        value: editor.value,
        onChange: editor.onChange,
        onCmdEnter: handleCmdEnter,
        disabled: isComposerDisabled,
        repoIds,
        executor: agent || executor?.selected || null,
        onPasteFiles: actions.onPasteFiles,
        localAttachments,
      })}
      error={displayError}
      banner={renderBanner()}
      visualVariant={getVisualVariant()}
      isRunning={showRunningOutline}
      dropzone={disableContentInsert ? undefined : dropzone}
      headerLeft={
        <>
          {!isNewSessionMode && activity && showRunningAnimation && (
            <AgentActivityIndicator activity={activity} />
          )}
          {/* Existing session mode: show in-progress todo when running, otherwise file stats */}
          {!isNewSessionMode && (
            <>
              {isRunning && inProgressTodo ? (
                <span className="text-sm flex items-center gap-1 min-w-0">
                  <SpinnerIcon className="size-icon-sm animate-spin flex-shrink-0" />
                  <span className="truncate">{inProgressTodo.content}</span>
                </span>
              ) : (
                <>
                  {stats?.hasConflicts && (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-warning text-sm min-w-0 cursor-pointer hover:underline"
                      title={t('conversation.approval.conflictWarning')}
                      onClick={stats.onResolveConflicts}
                    >
                      <WarningIcon className="size-icon-sm flex-shrink-0" />
                      <span className="truncate">
                        {t('conversation.approval.conflicts', {
                          count: stats.conflictedFilesCount,
                        })}
                      </span>
                    </button>
                  )}
                  {onOpenWorkspace ? (
                    <button
                      type="button"
                      onClick={onOpenWorkspace}
                      className="flex min-w-0 items-center gap-1 rounded-sm text-xs text-low hover:text-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <ArrowsOutIcon className="size-icon-xs shrink-0" />
                      <span className="truncate">
                        {t('common:ui.openWorkspace')}
                      </span>
                    </button>
                  ) : onViewCode ? (
                    <PrimaryButton
                      variant="tertiary"
                      onClick={onViewCode}
                      className="min-w-0"
                    >
                      <span className="text-sm space-x-half whitespace-nowrap truncate">
                        <span>
                          {t('diff.filesChanged', { count: filesChanged })}
                        </span>
                        {(linesAdded !== undefined ||
                          linesRemoved !== undefined) && (
                          <span className="space-x-half">
                            {linesAdded !== undefined && (
                              <span className="text-success">
                                +{linesAdded}
                              </span>
                            )}
                            {linesRemoved !== undefined && (
                              <span className="text-error">
                                -{linesRemoved}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </PrimaryButton>
                  ) : (
                    <span className="text-sm text-low space-x-half whitespace-nowrap truncate min-w-0">
                      <span>
                        {t('diff.filesChanged', { count: filesChanged })}
                      </span>
                      {(linesAdded !== undefined ||
                        linesRemoved !== undefined) && (
                        <span className="space-x-half">
                          {linesAdded !== undefined && (
                            <span className="text-success">+{linesAdded}</span>
                          )}
                          {linesRemoved !== undefined && (
                            <span className="text-error">-{linesRemoved}</span>
                          )}
                        </span>
                      )}
                    </span>
                  )}
                </>
              )}
            </>
          )}
        </>
      }
      headerRight={
        <>
          {/* Turn navigation + Agent icon for existing session mode */}
          {!isNewSessionMode && (
            <>
              {onScrollToPreviousMessage && (
                <TurnNavigationPopup
                  turns={userMessageTurns ?? []}
                  onNavigateToTurn={onScrollToUserMessage ?? (() => {})}
                  getActiveTurnPatchKey={getActiveTurnPatchKey}
                >
                  <ToolbarIconButton
                    icon={ArrowUpIcon}
                    title={t('conversation.actions.scrollToPreviousMessage')}
                    aria-label={t(
                      'conversation.actions.scrollToPreviousMessage'
                    )}
                    onClick={onScrollToPreviousMessage}
                  />
                </TurnNavigationPopup>
              )}
              {renderAgentIcon?.(agent, 'size-icon-xl')}
            </>
          )}
          {/* Todo progress popup - always rendered, disabled when no todos */}
          <TodoProgressPopup todos={todos ?? []} />
          {supportsContextUsage && (
            <ContextUsageGauge tokenUsageInfo={tokenUsageInfo} />
          )}
          <ToolbarDropdown
            label={sessionLabel}
            disabled={isInFeedbackMode || isInEditMode || isInApprovalMode}
            className="min-w-0 max-w-[120px]"
          >
            {/* New Session option */}
            <DropdownMenuItem
              icon={isNewSessionMode ? CheckIcon : PlusIcon}
              onClick={() => onNewSession?.()}
            >
              {t('conversation.sessions.newSession')}
            </DropdownMenuItem>
            {sessions.length > 0 && <DropdownMenuSeparator />}
            {sessions.length > 0 ? (
              <>
                <DropdownMenuLabel>
                  {t('conversation.sessions.label')}
                </DropdownMenuLabel>
                {sessions.map((s, index) => (
                  <DropdownMenuItem
                    key={s.id}
                    icon={
                      !isNewSessionMode && s.id === selectedSessionId
                        ? CheckIcon
                        : undefined
                    }
                    onClick={() => onSelectSession(s.id)}
                  >
                    <span className="flex items-center gap-1.5 max-w-[200px]">
                      {renderAgentIcon?.(
                        s.executor ?? null,
                        'size-icon shrink-0'
                      )}
                      <span className="truncate">
                        {s.name
                          ? s.name
                          : index === 0
                            ? t('conversation.sessions.latest')
                            : formatSessionDate(s.created_at)}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </>
            ) : (
              <DropdownMenuItem disabled>
                {t('conversation.sessions.noPreviousSessions')}
              </DropdownMenuItem>
            )}
            {onRenameSession && selectedSessionId && !isNewSessionMode && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon={PencilSimpleIcon}
                  onClick={() =>
                    onRenameSession(
                      selectedSessionId,
                      selectedSessionObj?.name ?? ''
                    )
                  }
                >
                  {t('conversation.sessions.rename')}
                </DropdownMenuItem>
              </>
            )}
          </ToolbarDropdown>
        </>
      }
      footerLeft={
        <>
          {showRunningAnimation && <PulsingDot className="self-center" />}
          <ChatSettingsPopover disabled={isComposerDisabled || isRunning}>
            {isNewSessionMode && renderAgentIcon?.(agent, 'size-icon-xl')}
            {isNewSessionMode && executor && (
              <ToolbarDropdown
                label={
                  executor.selected
                    ? formatExecutorLabel(executor.selected)
                    : emptyExecutorLabel
                }
                disabled={isComposerDisabled || isRunning}
              >
                <DropdownMenuLabel>
                  {t('conversation.executors')}
                </DropdownMenuLabel>
                {executor.options.map((exec) => (
                  <DropdownMenuItem
                    key={exec}
                    icon={executor.selected === exec ? CheckIcon : undefined}
                    onClick={() => executor.onChange(exec)}
                  >
                    {formatExecutorLabel(exec)}
                  </DropdownMenuItem>
                ))}
              </ToolbarDropdown>
            )}
            {modelSelector}
          </ChatSettingsPopover>
          <ToolbarIconButton
            icon={PaperclipIcon}
            aria-label={t('tasks:taskFormDialog.attachFile')}
            title={t('tasks:taskFormDialog.attachFile')}
            onClick={handleAttachClick}
            disabled={areContentInsertActionsDisabled}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
          {(onPrCommentClick || toolbarActions?.items.length) && (
            <DropdownMenu>
              <DropdownMenuTriggerButton
                size="sm"
                icon={DotsThreeIcon}
                aria-label={t('common:ui.moreActions')}
                title={t('common:ui.moreActions')}
                showCaret={false}
                className="size-8 justify-center px-0"
              />
              <DropdownMenuContent align="start">
                {onPrCommentClick && (
                  <DropdownMenuItem
                    icon={GithubLogoIcon}
                    disabled={areContentInsertActionsDisabled}
                    onClick={onPrCommentClick}
                  >
                    {t('common:ui.addPrComments')}
                  </DropdownMenuItem>
                )}
                {toolbarActions?.items.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    icon={item.icon}
                    disabled={
                      isComposerDisabled || isRunning || Boolean(item.disabled)
                    }
                    onClick={item.onClick}
                  >
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      }
      footerRight={renderActionButtons()}
      className="ship-composer focus-within:border-low"
    />
  );
}
