import { useState, type Ref, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalAttachmentMetadata } from './WorkspaceContext';
import { cn } from '../lib/cn';
import {
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
  PaperclipIcon,
} from '@phosphor-icons/react';
import { ErrorAlert } from './ErrorAlert';
import { CollapsibleSectionHeader } from './CollapsibleSectionHeader';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './Dropdown';

export interface IssueCommentData {
  id: string;
  message: string;
  createdAt: string;
  canModify: boolean;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 0) return `${diffDays}d`;
  if (diffHours > 0) return `${diffHours}h`;
  if (diffMinutes > 0) return `${diffMinutes}m`;
  return 'now';
}

interface DropzoneProps {
  getRootProps: () => Record<string, unknown>;
  getInputProps: () => Record<string, unknown>;
  isDragActive: boolean;
}

export interface IssueCommentsEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  localAttachments?: LocalAttachmentMetadata[];
  onCmdEnter?: () => void;
  onPasteFiles?: (files: File[]) => void;
  editorRef?: Ref<unknown>;
  showStaticToolbar?: boolean;
  staticToolbarActions?: ReactNode;
}

interface IssueCommentsSectionProps {
  comments: IssueCommentData[];
  commentInput: string;
  onCommentInputChange: (value: string) => void;
  onSubmitComment: () => void;
  editingCommentId: string | null;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  onStartEdit: (commentId: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDeleteComment: (id: string) => void;
  isLoading?: boolean;
  commentEditorRef?: Ref<unknown>;
  onPasteFiles?: (files: File[]) => void;
  localAttachments?: LocalAttachmentMetadata[];
  dropzoneProps?: DropzoneProps;
  onBrowseAttachment?: () => void;
  isUploading?: boolean;
  isSending?: boolean;
  sendError?: boolean;
  draftSaveError?: boolean;
  onRetryDraftSave?: () => void;
  mutationError?: string | null;
  onDismissMutationError?: () => void;
  isSavingEdit?: boolean;
  isDeletingCommentId?: string | null;
  attachmentError?: string | null;
  onDismissAttachmentError?: () => void;
  renderEditor: (props: IssueCommentsEditorProps) => ReactNode;
}

export function IssueCommentsSection({
  comments,
  commentInput,
  onCommentInputChange,
  onSubmitComment,
  editingCommentId,
  editingValue,
  onEditingValueChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDeleteComment,
  isLoading,
  commentEditorRef,
  onPasteFiles,
  localAttachments,
  dropzoneProps,
  onBrowseAttachment,
  isUploading,
  isSending,
  sendError,
  draftSaveError,
  onRetryDraftSave,
  mutationError,
  onDismissMutationError,
  isSavingEdit,
  isDeletingCommentId,
  attachmentError,
  onDismissAttachmentError,
  renderEditor,
}: IssueCommentsSectionProps) {
  const { t } = useTranslation('common');
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const showToolbar = isComposerFocused || commentInput.trim().length > 0;

  return (
    <CollapsibleSectionHeader
      title={t('kanban.comments')}
      persistKey="kanban-issue-comments"
      defaultExpanded={true}
      actions={[]}
    >
      <div className="p-base flex flex-col gap-double">
        {mutationError && (
          <ErrorAlert
            message={mutationError}
            onDismiss={onDismissMutationError}
            dismissLabel={t('buttons.close')}
          />
        )}
        {/* Comments list */}
        {isLoading ? (
          <div className="flex flex-col gap-double animate-pulse">
            <div className="h-4 bg-secondary rounded w-3/4" />
            <div className="h-4 bg-secondary rounded w-1/2" />
          </div>
        ) : comments.length === 0 ? null : (
          comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              isEditing={editingCommentId === comment.id}
              editValue={editingCommentId === comment.id ? editingValue : ''}
              onEditValueChange={onEditingValueChange}
              onStartEdit={() => onStartEdit(comment.id)}
              onSaveEdit={onSaveEdit}
              onCancelEdit={onCancelEdit}
              onDelete={() => onDeleteComment(comment.id)}
              isSavingEdit={isSavingEdit}
              isDeleting={isDeletingCommentId === comment.id}
              renderEditor={renderEditor}
            />
          ))
        )}

        {/* Comment Input with WYSIWYG + dropzone */}
        <div
          {...dropzoneProps?.getRootProps()}
          onFocus={() => setIsComposerFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setIsComposerFocused(false);
            }
          }}
          className="relative min-w-0 bg-secondary border border-border rounded-sm px-base pt-base pb-1.5 focus-within:border-brand [&_.static-editor-toolbar]:flex-nowrap [&_.static-editor-toolbar]:items-center [&_.static-editor-toolbar]:w-full [&_.static-editor-toolbar]:pt-1.5 [&_.static-editor-toolbar]:!pb-0 [&_.static-editor-toolbar]:px-0 [&_.static-editor-toolbar]:border-0 [&_.static-editor-toolbar>*]:shrink-0"
        >
          <input {...dropzoneProps?.getInputProps()} />
          {(() => {
            const actionButtons = (
              <div
                className={cn(
                  'flex items-center justify-end gap-1.5',
                  showToolbar
                    ? 'ml-auto'
                    : 'absolute right-2.5 top-1/2 -translate-y-1/2'
                )}
              >
                {onBrowseAttachment && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onBrowseAttachment}
                    title={t('kanban.attachFile')}
                    className={cn(
                      'size-7 rounded-sm',
                      'flex items-center justify-center',
                      'text-low hover:text-normal transition-colors'
                    )}
                    aria-label={t('kanban.attachFile')}
                  >
                    <PaperclipIcon size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={onSubmitComment}
                  disabled={!commentInput.trim() || isUploading || isSending}
                  className={cn(
                    'px-base py-half rounded-sm bg-brand text-on-brand font-medium',
                    'hover:bg-brand-hover transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {isSending ? '…' : t('buttons.send')}
                </button>
              </div>
            );

            return (
              <>
                {renderEditor({
                  value: commentInput,
                  onChange: onCommentInputChange,
                  placeholder: t('kanban.enterCommentPlaceholder'),
                  className: showToolbar
                    ? 'min-h-[32px] break-words'
                    : 'min-h-[28px] pr-[96px] break-words',
                  localAttachments,
                  onCmdEnter: onSubmitComment,
                  disabled: isSending,
                  showStaticToolbar: showToolbar,
                  staticToolbarActions: showToolbar ? actionButtons : undefined,
                  onPasteFiles,
                  autoFocus: false,
                  editorRef: commentEditorRef,
                })}
                {!showToolbar && actionButtons}
              </>
            );
          })()}
          {dropzoneProps?.isDragActive && (
            <div className="absolute inset-0 z-50 bg-primary/80 backdrop-blur-sm border-2 border-dashed border-brand rounded flex items-center justify-center">
              <p className="text-sm font-medium text-high">
                {t('kanban.dropFilesHere')}
              </p>
            </div>
          )}
        </div>
        {attachmentError && (
          <ErrorAlert
            message={attachmentError}
            onDismiss={onDismissAttachmentError}
            dismissLabel={t('buttons.close')}
          />
        )}
        {showToolbar && (
          <p className="text-xs text-low">Enter · ⌘/Ctrl + Enter</p>
        )}
        {draftSaveError && (
          <div role="alert" className="text-sm text-error">
            {t('kanban.failedToSaveCommentDraft')}{' '}
            <button
              type="button"
              onClick={onRetryDraftSave}
              disabled={isSending}
              className="underline"
            >
              {t('buttons.retry')}
            </button>
          </div>
        )}
        {sendError && (
          <div role="alert" className="text-sm text-low">
            {t('errors.generic')}{' '}
            <button
              type="button"
              onClick={onSubmitComment}
              className="underline"
            >
              {t('buttons.retry')}
            </button>
          </div>
        )}
      </div>
    </CollapsibleSectionHeader>
  );
}

interface CommentItemProps {
  comment: IssueCommentData;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  isSavingEdit?: boolean;
  isDeleting?: boolean;
  renderEditor: (props: IssueCommentsEditorProps) => ReactNode;
}

function CommentItem({
  comment,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  isSavingEdit,
  isDeleting,
  renderEditor,
}: CommentItemProps) {
  const { t } = useTranslation('common');
  const timeAgo = formatRelativeTime(comment.createdAt);

  return (
    <div className="flex flex-col gap-half">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-base">
          <span className="text-xs text-low">{timeAgo}</span>
        </div>
        {/* Menu dropdown - only shown if user can modify */}
        {comment.canModify && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('kanban.comments')}
                className="size-8 flex items-center justify-center text-low hover:text-normal"
              >
                <DotsThreeIcon size={16} weight="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={PencilSimpleIcon} onSelect={onStartEdit}>
                {t('buttons.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={TrashIcon}
                variant="destructive"
                disabled={isDeleting}
                onSelect={onDelete}
              >
                {isDeleting ? '…' : t('buttons.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Message - editable or read-only */}
      {isEditing ? (
        <div className="flex flex-col gap-half bg-primary border border-border rounded-sm p-double">
          {renderEditor({
            value: editValue,
            onChange: onEditValueChange,
            autoFocus: true,
            onCmdEnter: onSaveEdit,
            className: 'min-h-[40px]',
          })}
          <div className="flex gap-half justify-end">
            <button
              type="button"
              onClick={onCancelEdit}
              className="px-base py-half text-low hover:text-normal"
            >
              {t('buttons.cancel')}
            </button>
            <button
              type="button"
              onClick={onSaveEdit}
              disabled={!editValue.trim() || isSavingEdit}
              className={cn(
                'px-base py-half bg-brand text-on-brand rounded-sm',
                'hover:bg-brand-hover disabled:opacity-50'
              )}
            >
              {isSavingEdit ? '…' : t('buttons.save')}
            </button>
          </div>
        </div>
      ) : (
        renderEditor({
          value: comment.message,
          disabled: true,
          className: 'text-normal',
        })
      )}
    </div>
  );
}
