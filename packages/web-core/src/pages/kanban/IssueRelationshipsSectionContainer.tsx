import { useTranslation } from 'react-i18next';
import { useMemo, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  PlusIcon,
  ArrowBendUpRightIcon,
  ProhibitIcon,
  ArrowsLeftRightIcon,
  CopyIcon,
} from '@phosphor-icons/react';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useActions } from '@/shared/hooks/useActions';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { resolveRelationshipsForIssue } from '@/shared/lib/resolveRelationships';
import { IssueRelationshipsSection } from '@vibe/ui/components/IssueRelationshipsSection';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@vibe/ui/components/Dropdown';

interface IssueRelationshipsSectionContainerProps {
  issueId: string;
  /** Overrides the route projectId (for contexts without route params, e.g. the Create Issue modal). */
  projectId?: string;
}

export function IssueRelationshipsSectionContainer({
  issueId,
  projectId: projectIdProp,
}: IssueRelationshipsSectionContainerProps) {
  const { t } = useTranslation();
  const { projectId: routeProjectId } = useParams({ strict: false });
  const projectId = projectIdProp ?? routeProjectId;
  const appNavigation = useAppNavigation();
  const { openRelationshipSelection } = useActions();

  const {
    getRelationshipsForIssue,
    removeIssueRelationship,
    issuesById,
    statusesById,
    isLoading,
  } = useProjectContext();

  const relationships = useMemo(
    () =>
      resolveRelationshipsForIssue(
        issueId,
        getRelationshipsForIssue(issueId),
        issuesById
      ).map((relationship) => ({
        ...relationship,
        relatedIssueTitle: issuesById.get(relationship.relatedIssueId)?.title,
        relatedIssueStatus: statusesById.get(
          issuesById.get(relationship.relatedIssueId)?.status_id ?? ''
        )?.name,
      })),
    [issueId, getRelationshipsForIssue, issuesById, statusesById]
  );

  const handleRelationshipClick = useCallback(
    (relatedIssueId: string) => {
      if (!projectId) {
        return;
      }

      appNavigation.goToProjectIssue(projectId, relatedIssueId);
    },
    [projectId, appNavigation]
  );

  const handleRemoveRelationship = useCallback(
    (relationshipId: string) => {
      removeIssueRelationship(relationshipId);
    },
    [removeIssueRelationship]
  );

  const handleSelectType = useCallback(
    (
      relationshipType: 'blocking' | 'related' | 'has_duplicate',
      direction: 'forward' | 'reverse'
    ) => {
      if (projectId) {
        openRelationshipSelection(
          projectId,
          issueId,
          relationshipType,
          direction
        );
      }
    },
    [projectId, issueId, openRelationshipSelection]
  );

  const headerExtra = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="text-low hover:text-normal"
          onClick={(e) => e.stopPropagation()}
        >
          <PlusIcon className="size-icon-xs" weight="bold" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          icon={ArrowBendUpRightIcon}
          onSelect={() => handleSelectType('blocking', 'forward')}
        >
          Blocks...
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={ProhibitIcon}
          onSelect={() => handleSelectType('blocking', 'reverse')}
        >
          {t('common:ui.blockedBy')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={ArrowsLeftRightIcon}
          onSelect={() => handleSelectType('related', 'forward')}
        >
          {t('common:ui.relatedTo')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={CopyIcon}
          onSelect={() => handleSelectType('has_duplicate', 'forward')}
        >
          {t('common:ui.duplicateOf')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <IssueRelationshipsSection
      relationships={relationships}
      onRelationshipClick={handleRelationshipClick}
      onRemoveRelationship={handleRemoveRelationship}
      isLoading={isLoading}
      headerExtra={headerExtra}
    />
  );
}
