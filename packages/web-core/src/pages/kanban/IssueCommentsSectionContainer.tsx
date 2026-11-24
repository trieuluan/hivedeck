import {
  useMemo,
  useCallback,
  useState,
  useRef,
  useEffect,
  type Ref,
} from 'react';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';
import { IssueProvider } from '@/integrations/remote/IssueProvider';
import { useIssueContext } from '@/shared/hooks/useIssueContext';
import { useScratch } from '@/shared/hooks/useScratch';
import { useDebouncedCallback } from '@/shared/hooks/useDebouncedCallback';
import { useIssueAttachments } from '@/shared/hooks/useIssueAttachments';
import { ApiError, attachmentsApi } from '@/shared/lib/api';
import {
  IssueCommentsSection,
  type IssueCommentsEditorProps,
  type IssueCommentData,
} from '@vibe/ui/components/IssueCommentsSection';
import WYSIWYGEditor, {
  type WYSIWYGEditorRef,
} from '@/shared/components/WYSIWYGEditor';
import { ScratchType } from 'shared/types';
import type { IssueComment } from 'shared/remote-types';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';

interface IssueCommentsSectionContainerProps {
  issueId: string;
}

const draftWrites = new Map<string, Promise<void>>();

function queueDraftWrite(issueId: string, write: () => Promise<void>) {
  const previous = draftWrites.get(issueId) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(write);
  draftWrites.set(issueId, pending);
  void pending.then(
    () => {
      if (draftWrites.get(issueId) === pending) draftWrites.delete(issueId);
    },
    () => {
      if (draftWrites.get(issueId) === pending) draftWrites.delete(issueId);
    }
  );
  return pending;
}

/**
 * Container that wraps IssueCommentsSection with IssueProvider.
 * Manages comment data transformation, mutations, and UI state.
 */
export function IssueCommentsSectionContainer({
  issueId,
}: IssueCommentsSectionContainerProps) {
  return (
    <IssueProvider issueId={issueId}>
      <IssueCommentsSectionContent />
    </IssueProvider>
  );
}

function IssueCommentsSectionContent() {
  const { t } = useTranslation('common');
  const issueContext = useIssueContext();

  // Ref to comment editor for programmatic focus
  const commentEditorRef = useRef<WYSIWYGEditorRef>(null);

  // UI state for comment input
  const [commentInput, setCommentInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingCommentId, setIsDeletingCommentId] = useState<string | null>(
    null
  );
  const sendingRef = useRef(false);
  const retryCommentRef = useRef<{ id: string; message: string } | null>(null);
  const commentDraftId = issueContext.issueId;
  const currentDraftRef = useRef({
    issueId: commentDraftId,
    value: commentInput,
  });
  currentDraftRef.current = { issueId: commentDraftId, value: commentInput };
  const {
    scratch: commentDraftScratch,
    updateScratch: updateCommentDraft,
    deleteScratch: deleteCommentDraft,
    isLoading: isCommentDraftLoading,
  } = useScratch(ScratchType.DRAFT_TASK, commentDraftId);
  const commentDraft =
    commentDraftScratch?.payload?.type === 'DRAFT_TASK'
      ? commentDraftScratch.payload.data
      : undefined;
  const hydratedCommentDraftIdRef = useRef<string | null>(null);
  const skipNextPersistRef = useRef(false);

  const persistCommentDraft = useCallback(
    async (value: string) => {
      try {
        if (!value.trim()) {
          await queueDraftWrite(commentDraftId, async () => {
            try {
              await deleteCommentDraft();
            } catch (error) {
              if (
                !(
                  error instanceof ApiError &&
                  (error.statusCode === 404 ||
                    (error.statusCode === 400 &&
                      error.message === 'Scratch not found'))
                )
              )
                throw error;
            }
          });
        } else {
          await queueDraftWrite(commentDraftId, () =>
            updateCommentDraft({
              payload: {
                type: 'DRAFT_TASK',
                data: value,
              },
            })
          );
        }
        if (
          currentDraftRef.current.issueId === commentDraftId &&
          currentDraftRef.current.value === value
        )
          setDraftSaveError(null);
      } catch (e) {
        console.error('[IssueCommentsSection] Failed to persist draft:', e);
        if (currentDraftRef.current.issueId === commentDraftId)
          setDraftSaveError(commentDraftId);
      }
    },
    [commentDraftId, updateCommentDraft, deleteCommentDraft]
  );

  const {
    debounced: debouncedPersistCommentDraft,
    cancel: cancelDebouncedPersistCommentDraft,
    flush: flushDebouncedPersistCommentDraft,
  } = useDebouncedCallback(persistCommentDraft, 500);

  useEffect(() => {
    flushDebouncedPersistCommentDraft();
    cancelDebouncedPersistCommentDraft();
    hydratedCommentDraftIdRef.current = null;
    skipNextPersistRef.current = false;
    retryCommentRef.current = null;
    setCommentInput('');
  }, [
    commentDraftId,
    flushDebouncedPersistCommentDraft,
    cancelDebouncedPersistCommentDraft,
  ]);

  useEffect(() => {
    return () => {
      flushDebouncedPersistCommentDraft();
    };
  }, [flushDebouncedPersistCommentDraft]);

  useEffect(() => {
    if (isCommentDraftLoading) return;
    if (hydratedCommentDraftIdRef.current === commentDraftId) return;

    const nextCommentInput = commentDraft ?? '';
    const shouldSkipNextPersist = nextCommentInput !== commentInput;

    hydratedCommentDraftIdRef.current = commentDraftId;
    skipNextPersistRef.current = shouldSkipNextPersist;
    setCommentInput(nextCommentInput);
  }, [isCommentDraftLoading, commentDraft, commentDraftId, commentInput]);

  const handleCommentMarkdownInsert = useCallback((markdown: string) => {
    setCommentInput((prev) =>
      prev.trim() ? `${prev}\n\n${markdown}` : markdown
    );
  }, []);

  const {
    uploadFiles,
    getAttachmentIds,
    clearAttachments,
    isUploading,
    uploadError,
    clearUploadError,
    localAttachments,
  } = useIssueAttachments(handleCommentMarkdownInsert);

  useEffect(() => {
    if (hydratedCommentDraftIdRef.current !== commentDraftId) return;
    if (isUploading) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    debouncedPersistCommentDraft(commentInput);
  }, [commentInput, commentDraftId, debouncedPersistCommentDraft, isUploading]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) uploadFiles(acceptedFiles);
    },
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

  const onPasteFiles = useCallback(
    (files: File[]) => {
      if (files.length > 0) uploadFiles(files);
    },
    [uploadFiles]
  );

  // UI state for editing
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Transform IssueComment to IssueCommentData. ADR-019: no author attribution
  // (single-developer fork — every comment is the owner's, no display needed).
  const commentsData = useMemo<IssueCommentData[]>(() => {
    return issueContext.comments
      .map((comment) => ({
        id: comment.id,
        message: comment.message,
        createdAt: comment.created_at,
        canModify: true,
      }))
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }, [issueContext.comments]);

  const handleSubmitComment = useCallback(async () => {
    if (!commentInput.trim() || isUploading || sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setSendError(false);
    setMutationError(null);
    const message = commentInput.trim();
    try {
      cancelDebouncedPersistCommentDraft();
      await queueDraftWrite(commentDraftId, () =>
        updateCommentDraft({
          payload: { type: 'DRAFT_TASK', data: commentInput },
        })
      );
      if (currentDraftRef.current.issueId === commentDraftId)
        setDraftSaveError(null);
      let confirmedComment: IssueComment;
      const retry = retryCommentRef.current;
      if (retry && retry.message === message) {
        confirmedComment = { id: retry.id } as IssueComment;
      } else {
        retryCommentRef.current = null;
        const { persisted } = issueContext.insertComment({
          issue_id: issueContext.issueId,
          message,
          parent_id: null,
        });
        confirmedComment = await persisted;
      }
      const allUploadedIds = getAttachmentIds();
      if (allUploadedIds.length > 0) {
        try {
          await attachmentsApi.linkCommentAttachments(
            confirmedComment.id,
            allUploadedIds
          );
        } catch (err) {
          console.error('Failed to link comment attachments:', err);
          retryCommentRef.current = {
            id: confirmedComment.id,
            message,
          };
          setSendError(true);
          return;
        }
      }
      retryCommentRef.current = null;
      cancelDebouncedPersistCommentDraft();
      skipNextPersistRef.current = true;
      setCommentInput('');
      clearAttachments();
      await persistCommentDraft('');
    } catch (err) {
      console.error('Failed to send comment:', err);
      setSendError(true);
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }, [
    commentInput,
    issueContext,
    getAttachmentIds,
    clearAttachments,
    cancelDebouncedPersistCommentDraft,
    updateCommentDraft,
    commentDraftId,
    isUploading,
    persistCommentDraft,
  ]);

  const handleStartEdit = useCallback(
    (commentId: string) => {
      const comment = commentsData.find((c) => c.id === commentId);
      if (comment) {
        setEditingCommentId(commentId);
        setEditingValue(comment.message);
      }
    },
    [commentsData]
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editingCommentId || !editingValue.trim()) return;
    setIsSavingEdit(true);
    setMutationError(null);
    try {
      const { persisted } = issueContext.updateComment(editingCommentId, {
        message: editingValue.trim(),
      });
      await persisted;
      setEditingCommentId(null);
      setEditingValue('');
    } catch (err) {
      console.error('Failed to update comment:', err);
      setMutationError(t('kanban.failedToUpdateComment'));
    } finally {
      setIsSavingEdit(false);
    }
  }, [editingCommentId, editingValue, issueContext, t]);

  const handleCancelEdit = useCallback(() => {
    setEditingCommentId(null);
    setEditingValue('');
  }, []);

  const handleDeleteComment = useCallback(
    async (id: string) => {
      const result = await ConfirmDialog.show({
        title: t('kanban.deleteCommentTitle'),
        message: t('kanban.deleteCommentConfirm'),
        confirmText: t('buttons.delete'),
        variant: 'destructive',
      });
      if (result !== 'confirmed') return;
      setIsDeletingCommentId(id);
      setMutationError(null);
      try {
        const { persisted } = issueContext.removeComment(id);
        await persisted;
      } catch (err) {
        console.error('Failed to delete comment:', err);
        setMutationError(t('kanban.failedToDeleteComment'));
      } finally {
        setIsDeletingCommentId(null);
      }
    },
    [issueContext, t]
  );

  const renderEditor = useCallback(
    ({
      value,
      onChange,
      placeholder,
      className,
      disabled,
      autoFocus,
      onCmdEnter,
      onPasteFiles,
      localAttachments,
      editorRef,
      showStaticToolbar,
    }: IssueCommentsEditorProps) => (
      <WYSIWYGEditor
        ref={editorRef as Ref<WYSIWYGEditorRef>}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoFocus={autoFocus}
        onCmdEnter={onCmdEnter}
        onPasteFiles={onPasteFiles}
        localAttachments={localAttachments}
        showStaticToolbar={showStaticToolbar}
      />
    ),
    []
  );

  return (
    <IssueCommentsSection
      comments={commentsData}
      commentInput={commentInput}
      onCommentInputChange={setCommentInput}
      onSubmitComment={handleSubmitComment}
      editingCommentId={editingCommentId}
      editingValue={editingValue}
      onEditingValueChange={setEditingValue}
      onStartEdit={handleStartEdit}
      onSaveEdit={handleSaveEdit}
      onCancelEdit={handleCancelEdit}
      onDeleteComment={handleDeleteComment}
      isLoading={issueContext.isLoading}
      commentEditorRef={commentEditorRef}
      onPasteFiles={onPasteFiles}
      localAttachments={localAttachments}
      dropzoneProps={{ getRootProps, getInputProps, isDragActive }}
      onBrowseAttachment={open}
      isUploading={isUploading}
      isSending={isSending}
      sendError={sendError}
      draftSaveError={draftSaveError === commentDraftId}
      onRetryDraftSave={() => {
        cancelDebouncedPersistCommentDraft();
        void persistCommentDraft(commentInput);
      }}
      mutationError={mutationError}
      onDismissMutationError={() => setMutationError(null)}
      isSavingEdit={isSavingEdit}
      isDeletingCommentId={isDeletingCommentId}
      attachmentError={uploadError}
      onDismissAttachmentError={clearUploadError}
      renderEditor={renderEditor}
    />
  );
}
