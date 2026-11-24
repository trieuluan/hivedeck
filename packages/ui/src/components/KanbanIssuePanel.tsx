import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalAttachmentMetadata } from './WorkspaceContext';
import { cn } from '../lib/cn';
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretUpIcon,
  XIcon,
  LinkIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
  PaperclipIcon,
  ImageIcon,
} from '@phosphor-icons/react';
import {
  IssueTagsRow,
  type IssueTagBase,
  type IssueTagsRowAddTagControlProps,
  type LinkedPullRequest as IssueTagsLinkedPullRequest,
} from './IssueTagsRow';
import { PrimaryButton } from './PrimaryButton';
import { Toggle } from './Toggle';
import {
  IssuePropertyRow,
  type IssuePropertyRowProps,
} from './IssuePropertyRow';
import { IconButton } from './IconButton';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './RadixTooltip';
import { ErrorAlert } from './ErrorAlert';

export type IssuePanelMode = 'create' | 'edit';
type IssuePriority = IssuePropertyRowProps['priority'];
type IssueStatus = IssuePropertyRowProps['statuses'][number];
export interface KanbanIssueTag extends IssueTagBase {
  project_id: string;
}

export interface IssueFormData {
  title: string;
  description: string | null;
  statusId: string;
  priority: IssuePriority | null;
  tagIds: string[];
  createDraftWorkspace: boolean;
}

export interface LinkedPullRequest extends IssueTagsLinkedPullRequest {}

export interface KanbanIssueDescriptionEditorProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onCmdEnter?: () => void;
  onPasteFiles?: (files: File[]) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  localAttachments?: LocalAttachmentMetadata[];
  showStaticToolbar?: boolean;
  saveStatus?: 'idle' | 'saved';
  staticToolbarActions?: ReactNode;
  onRequestEdit?: () => void;
  hideActions?: boolean;
}

export interface KanbanIssuePanelProps {
  initialTab?: 'details' | 'artifacts';
  mode: IssuePanelMode;
  displayId: string;

  // Form data
  formData: IssueFormData;
  onFormChange: <K extends keyof IssueFormData>(
    field: K,
    value: IssueFormData[K]
  ) => void;

  // Options for dropdowns
  statuses: IssueStatus[];
  tags: KanbanIssueTag[];

  // Edit mode data
  issueId?: string | null;
  parentIssue?: { id: string; simpleId: string } | null;
  onParentIssueClick?: () => void;
  onRemoveParentIssue?: () => void;
  linkedPrs?: LinkedPullRequest[];
  onLinkPr?: () => void;

  // Actions
  onClose: () => void;
  onSubmit: () => void;
  onCmdEnterSubmit?: () => void;
  onDeleteDraft?: () => void;

  // Tag create callback - returns the new tag ID
  onCreateTag?: (data: { name: string; color: string }) => string;
  renderAddTagControl?: (
    props: IssueTagsRowAddTagControlProps<KanbanIssueTag>
  ) => ReactNode;
  renderDescriptionEditor: (
    props: KanbanIssueDescriptionEditorProps
  ) => ReactNode;

  // Optional "Generate spec" intake controls, rendered in create mode only
  // (brief input + agent/repo selectors + Generate button). Logic lives in the
  // container; this is just a render slot.
  renderIntake?: () => ReactNode;

  // Optional per-card "Pipeline" control, rendered in create mode only
  // (stage checkboxes + editable prompt addon). Logic lives in the container;
  // this is just a render slot.
  renderPipeline?: () => ReactNode;

  // Loading states
  isSubmitting?: boolean;

  // Save status for description field
  descriptionSaveStatus?: 'idle' | 'saved' | 'error';
  onRetryDescriptionSave?: () => void;

  // Ref for title input (created in container)
  titleInputRef: RefObject<HTMLTextAreaElement>;

  // Copy link callback (edit mode only)
  onCopyLink?: () => void;

  // More actions callback (edit mode only) - opens command bar with issue actions
  onMoreActions?: () => void;

  // Image attachment upload
  onPasteFiles?: (files: File[]) => void;
  localAttachments?: LocalAttachmentMetadata[];
  dropzoneProps?: {
    getRootProps: () => Record<string, unknown>;
    getInputProps: () => Record<string, unknown>;
    isDragActive: boolean;
  };
  onBrowseAttachment?: () => void;
  isUploading?: boolean;
  attachmentError?: string | null;
  onDismissAttachmentError?: () => void;

  // Edit-mode section renderers
  // Read-only "stage N of M" pipeline progress, rendered above the
  // workspaces section. Logic (parsing stages, picking the active
  // workspace) lives in the container; this is just a render slot.
  renderPipelineProgress?: (issueId: string) => ReactNode;
  renderWorkspacesSection?: (issueId: string) => ReactNode;
  renderRelationshipsSection?: (issueId: string) => ReactNode;
  renderSubIssuesSection?: (issueId: string) => ReactNode;
  renderCommentsSection?: (issueId: string) => ReactNode;
  renderArtifactsSection?: (issueId: string) => ReactNode;
  artifactCount?: number;
}

export function KanbanIssuePanel({
  mode,
  displayId,
  formData,
  onFormChange,
  statuses,
  tags,
  issueId,
  parentIssue,
  onParentIssueClick,
  onRemoveParentIssue,
  linkedPrs = [],
  onLinkPr,
  onClose,
  onSubmit,
  onCmdEnterSubmit,
  onDeleteDraft,
  onCreateTag,
  renderAddTagControl,
  renderDescriptionEditor,
  renderIntake,
  renderPipeline,
  isSubmitting,
  descriptionSaveStatus,
  onRetryDescriptionSave,
  titleInputRef,
  onCopyLink,
  onMoreActions,
  onPasteFiles,
  localAttachments,
  dropzoneProps,
  onBrowseAttachment,
  isUploading,
  attachmentError,
  onDismissAttachmentError,
  renderPipelineProgress,
  renderWorkspacesSection,
  renderRelationshipsSection,
  renderSubIssuesSection,
  renderCommentsSection,
  renderArtifactsSection,
  artifactCount,
  initialTab = 'details',
}: KanbanIssuePanelProps) {
  const { t } = useTranslation('common');
  const isCreateMode = mode === 'create';
  const breadcrumbTextClass =
    'min-w-0 text-sm text-normal truncate rounded-sm px-1 py-0.5 hover:bg-panel hover:text-high transition-colors';

  // Description edit state: in view mode, show compact preview by default; in create mode, always editable
  const [isDescriptionEditing, setIsDescriptionEditing] = useState(
    mode === 'create'
  );
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const descriptionContainerRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'details' | 'artifacts'>(initialTab);

  // Reset description editing & expansion state when switching between create/edit mode or when issue changes
  useEffect(() => {
    setIsDescriptionEditing(isCreateMode);
    setIsDescriptionExpanded(false);
    setTab(isCreateMode ? 'details' : initialTab);
  }, [isCreateMode, issueId, initialTab]);

  const specInfo = useMemo(() => {
    const desc = formData.description ?? '';
    const agentMatch = desc.match(/^\s*Execution agent:\s*([A-Za-z0-9_-]+)/im);
    const tierMatch = desc.match(/^\s*Tier:\s*([A-Za-z0-9_-]+)/im);
    const previewMatch = desc.match(
      /(?:Preview URL:\s*)?(https?:\/\/(?:localhost|127\.0\.0\.1)[^\s)<>"']+)/i
    );
    return {
      agent: agentMatch?.[1] ?? null,
      tier: tierMatch?.[1] ?? null,
      previewUrl: previewMatch?.[1] ?? null,
    };
  }, [formData.description]);

  const isLongDescription = useMemo(() => {
    const desc = formData.description ?? '';
    return desc.length > 360 || desc.split('\n').length > 6;
  }, [formData.description]);

  // Click outside the description area to exit editing
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
      if (isEditable) {
        target.blur();
        (e.currentTarget as HTMLElement).focus();
        e.stopPropagation();
      } else {
        onClose();
      }
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onCmdEnterSubmit?.();
    }
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-base py-half border-b shrink-0">
        <div className="flex items-center gap-half min-w-0 font-ibm-plex-mono">
          <span className={`${breadcrumbTextClass} shrink-0`}>{displayId}</span>
          {!isCreateMode && onCopyLink && (
            <button
              type="button"
              onClick={onCopyLink}
              className="p-half rounded-sm text-low hover:text-normal hover:bg-panel transition-colors"
              aria-label={t('kanban.copyLink')}
            >
              <LinkIcon className="size-icon-sm" weight="bold" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-half">
          {!isCreateMode && onMoreActions && (
            <button
              type="button"
              onClick={onMoreActions}
              className="p-half rounded-sm text-low hover:text-normal hover:bg-panel transition-colors"
              aria-label={t('kanban.moreActions')}
            >
              <DotsThreeIcon className="size-icon-sm" weight="bold" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-half rounded-sm text-low hover:text-normal hover:bg-panel transition-colors"
            aria-label={t('kanban.closePanel')}
          >
            <XIcon className="size-icon-sm" weight="bold" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="w-full mt-double">
          <AutoResizeTextarea
            ref={titleInputRef}
            value={formData.title}
            onChange={(value) => onFormChange('title', value)}
            onKeyDown={handleTitleKeyDown}
            placeholder={t('common:ui.issueTitle')}
            autoFocus={isCreateMode}
            aria-label={t('common:ui.issueTitle2')}
            disabled={isSubmitting}
            className={cn(
              'px-4 text-2xl font-semibold tracking-tight text-high',
              'placeholder:text-high/50',
              isSubmitting && 'opacity-50 pointer-events-none'
            )}
          />
        </div>
        {/* Unified Properties & Tags Row */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 pb-base pt-half">
          <IssuePropertyRow
            statusId={formData.statusId}
            priority={formData.priority}
            statuses={statuses}
            parentIssue={parentIssue}
            onParentIssueClick={onParentIssueClick}
            onRemoveParentIssue={onRemoveParentIssue}
            onStatusClick={() => onFormChange('statusId', formData.statusId)}
            onPriorityClick={() => onFormChange('priority', formData.priority)}
            disabled={isSubmitting}
          />
          <IssueTagsRow
            selectedTagIds={formData.tagIds}
            availableTags={tags}
            linkedPrs={isCreateMode ? [] : linkedPrs}
            onTagsChange={(tagIds) => onFormChange('tagIds', tagIds)}
            onCreateTag={onCreateTag}
            renderAddTagControl={renderAddTagControl}
            onLinkPr={!isCreateMode ? onLinkPr : undefined}
            disabled={isSubmitting}
          />
        </div>

        {!isCreateMode && issueId && renderArtifactsSection && (
          <div aria-label="Issue sections" className="flex gap-6 px-4 border-b">
            {(['details', 'artifacts'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'py-half border-b-2 capitalize',
                  tab === value
                    ? 'border-brand text-brand'
                    : 'border-transparent text-low hover:text-high'
                )}
              >
                {value === 'details'
                  ? 'Details'
                  : `Artifacts (${artifactCount ?? 0})`}
              </button>
            ))}
          </div>
        )}
        {!isCreateMode &&
          issueId &&
          tab === 'artifacts' &&
          renderArtifactsSection &&
          renderArtifactsSection(issueId)}
        <div hidden={tab === 'artifacts'}>
          {!isCreateMode &&
            (specInfo.agent || specInfo.tier || specInfo.previewUrl) && (
              <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
                {specInfo.agent && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-panel px-2 py-0.5 text-[11px] text-normal">
                    <span className="font-semibold text-high">Agent:</span>
                    {specInfo.agent}
                  </span>
                )}
                {specInfo.tier && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-panel px-2 py-0.5 text-[11px] text-normal">
                    <span className="font-semibold text-high">Tier:</span>
                    {specInfo.tier}
                  </span>
                )}
                {specInfo.previewUrl && (
                  <a
                    href={specInfo.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-sky-500/35 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300 transition-colors hover:bg-sky-500/20"
                  >
                    Preview URL
                    <ArrowSquareOutIcon className="size-3" aria-hidden />
                  </a>
                )}
              </div>
            )}

          {/* Description Card */}
          <div
            className={cn(
              !isCreateMode &&
                'mx-4 mt-3 overflow-hidden rounded-lg border border-border bg-panel/40'
            )}
          >
            {!isCreateMode && (
              <div className="flex items-center justify-between border-b border-border/70 bg-panel/70 px-3 py-1.5">
                <span className="text-xs font-semibold text-high">Mô tả</span>
                <div className="flex items-center gap-1.5">
                  {!isDescriptionEditing ? (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setIsDescriptionEditing(true)}
                      className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-normal transition-colors hover:bg-panel hover:text-high disabled:opacity-50"
                    >
                      <PencilSimpleIcon className="size-3" aria-hidden />
                      Sửa
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsDescriptionEditing(false)}
                      className="inline-flex items-center gap-1 rounded border border-brand/40 bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand transition-colors hover:bg-brand/25"
                    >
                      Xong
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Description WYSIWYG Editor with image dropzone */}
            <div
              ref={descriptionContainerRef}
              {...(isDescriptionEditing ? dropzoneProps?.getRootProps() : {})}
              className={cn(
                'relative',
                isCreateMode && 'mt-base',
                !isDescriptionEditing && !isCreateMode && 'cursor-text',
                !isDescriptionEditing &&
                  !isCreateMode &&
                  !isDescriptionExpanded &&
                  isLongDescription &&
                  'max-h-[220px] overflow-hidden'
              )}
              onClick={() => {
                if (!isDescriptionEditing && !isCreateMode && !isSubmitting) {
                  // Don't enter edit mode if the user was selecting text
                  const selection = window.getSelection();
                  if (selection && selection.toString().length > 0) return;
                  setIsDescriptionEditing(true);
                }
              }}
            >
              {isDescriptionEditing && (
                <input
                  {...(dropzoneProps?.getInputProps() as React.InputHTMLAttributes<HTMLInputElement>)}
                  data-dropzone-input
                />
              )}
              {renderDescriptionEditor({
                placeholder: isDescriptionEditing
                  ? t('kanban.issueDescriptionPlaceholder')
                  : formData.description
                    ? ''
                    : t('kanban.issueDescriptionPlaceholder'),
                value: formData.description ?? '',
                onChange: (value) => onFormChange('description', value || null),
                onCmdEnter: onCmdEnterSubmit,
                onPasteFiles: isDescriptionEditing ? onPasteFiles : undefined,
                disabled: !isDescriptionEditing || isSubmitting,
                autoFocus: false,
                className: cn(
                  isCreateMode ? 'px-4' : 'px-3 py-2',
                  isDescriptionEditing ? 'min-h-[120px]' : 'min-h-[2rem]',
                  !isDescriptionEditing && !formData.description && 'text-low'
                ),
                localAttachments,
                showStaticToolbar: !isCreateMode || isDescriptionEditing,
                hideActions: true,
                saveStatus:
                  descriptionSaveStatus === 'error'
                    ? 'idle'
                    : descriptionSaveStatus,
                onRequestEdit: !isCreateMode
                  ? () => setIsDescriptionEditing(true)
                  : undefined,
                staticToolbarActions: (
                  <>
                    {isDescriptionEditing && onBrowseAttachment && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                if (!isSubmitting && !isUploading) {
                                  onBrowseAttachment();
                                }
                              }}
                              disabled={isSubmitting || isUploading}
                              className={cn(
                                'p-half rounded-sm transition-colors',
                                'text-low hover:text-normal hover:bg-panel/50',
                                'disabled:opacity-50 disabled:cursor-not-allowed'
                              )}
                              title={t('kanban.attachFile')}
                              aria-label={t('kanban.attachFile')}
                            >
                              <PaperclipIcon className="size-icon-sm" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t('kanban.attachFileHint')}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </>
                ),
              })}
              {descriptionSaveStatus === 'error' && (
                <div role="alert" className="px-base text-error">
                  {t('errors.generic')}{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={onRetryDescriptionSave}
                  >
                    {t('buttons.retry')}
                  </button>
                </div>
              )}
              {attachmentError && (
                <div className="px-base">
                  <ErrorAlert
                    message={attachmentError}
                    className="mt-half mb-half"
                    onDismiss={onDismissAttachmentError}
                    dismissLabel={t('buttons.close')}
                  />
                </div>
              )}
              {dropzoneProps?.isDragActive && (
                <div className="absolute inset-0 z-50 bg-primary/80 backdrop-blur-sm border-2 border-dashed border-brand rounded flex items-center justify-center pointer-events-none animate-in fade-in-0 duration-150">
                  <div className="text-center">
                    <div className="mx-auto mb-2 w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
                      <ImageIcon className="h-5 w-5 text-brand" />
                    </div>
                    <p className="text-sm font-medium text-high">
                      {t('kanban.dropFilesHere')}
                    </p>
                    <p className="text-xs text-low mt-0.5">
                      {t('kanban.fileDropHint')}
                    </p>
                  </div>
                </div>
              )}
              {!isDescriptionEditing &&
                !isCreateMode &&
                !isDescriptionExpanded &&
                isLongDescription && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-panel to-transparent" />
                )}
            </div>
            {!isDescriptionEditing && !isCreateMode && isLongDescription && (
              <button
                type="button"
                onClick={() => setIsDescriptionExpanded((prev) => !prev)}
                className="flex w-full items-center justify-center gap-1 border-t border-border/70 bg-brand/5 py-1.5 text-[11px] font-medium text-brand transition-colors hover:bg-brand/10"
              >
                {isDescriptionExpanded ? (
                  <>
                    Thu gọn mô tả
                    <CaretUpIcon className="size-3" aria-hidden />
                  </>
                ) : (
                  <>
                    Xem toàn bộ mô tả
                    <CaretDownIcon className="size-3" aria-hidden />
                  </>
                )}
              </button>
            )}
          </div>

          {/* "Generate spec" intake controls (Create mode only) */}
          {isCreateMode && renderIntake && renderIntake()}

          {/* Per-card Pipeline control (Create mode only) */}
          {isCreateMode && renderPipeline && renderPipeline()}

          {/* Per-card Pipeline control (Edit mode only). PipelineSection
            renders its own border-t/padding (same as the create-mode
            instance above), so it isn't wrapped in another border-t div. */}
          {!isCreateMode && issueId && renderPipeline && renderPipeline()}

          {/* Create Draft Workspace Toggle (Create mode only) */}
          {isCreateMode && (
            <div className="p-base border-t">
              <Toggle
                checked={formData.createDraftWorkspace}
                onCheckedChange={(checked) =>
                  onFormChange('createDraftWorkspace', checked)
                }
                label={t('kanban.createDraftWorkspaceImmediately')}
                description={t('kanban.createDraftWorkspaceDescription')}
                disabled={isSubmitting}
              />
            </div>
          )}

          {/* Create Issue Button (Create mode only) */}
          {isCreateMode && (
            <div className="sticky bottom-0 z-10 bg-primary border-t p-base flex items-center gap-half">
              <PrimaryButton
                value={t('kanban.createIssue')}
                onClick={onSubmit}
                disabled={isSubmitting || isUploading || !formData.title.trim()}
                actionIcon={isSubmitting ? 'spinner' : undefined}
                variant="default"
              />
              {onDeleteDraft && (
                <IconButton
                  icon={TrashIcon}
                  onClick={onDeleteDraft}
                  disabled={isSubmitting}
                  aria-label={t('common:ui.deleteDraft')}
                  title={t('common:ui.deleteDraft')}
                  className="hover:text-error hover:bg-error/10"
                />
              )}
            </div>
          )}

          {/* Pipeline Progress (Edit mode only; renders nothing if the card has no parsed pipeline) */}
          {!isCreateMode && issueId && renderPipelineProgress && (
            <div className="border-t">{renderPipelineProgress(issueId)}</div>
          )}

          {/* Workspaces Section (Edit mode only) */}
          {!isCreateMode && issueId && renderWorkspacesSection && (
            <div className="mx-4 mt-3 overflow-hidden rounded-lg border border-border bg-panel/40">
              {renderWorkspacesSection(issueId)}
            </div>
          )}

          {/* Relationships Section (Edit mode only) */}
          {!isCreateMode && issueId && renderRelationshipsSection && (
            <div className="mx-4 mt-3 overflow-hidden rounded-lg border border-border bg-panel/40">
              {renderRelationshipsSection(issueId)}
            </div>
          )}

          {/* Sub-Issues Section (Edit mode only) */}
          {!isCreateMode && issueId && renderSubIssuesSection && (
            <div className="mx-4 mt-3 overflow-hidden rounded-lg border border-border bg-panel/40">
              {renderSubIssuesSection(issueId)}
            </div>
          )}

          {/* Comments Section (Edit mode only) */}
          {!isCreateMode && issueId && renderCommentsSection && (
            <div className="mx-4 mt-3 mb-6 overflow-hidden rounded-lg border border-border bg-panel/40">
              {renderCommentsSection(issueId)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
