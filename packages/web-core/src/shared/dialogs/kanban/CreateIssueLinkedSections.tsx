import { useTranslation } from 'react-i18next';
import { ProjectProvider } from '@/shared/providers/remote/ProjectProvider';
import { IssueWorkspacesSectionContainer } from '@/pages/kanban/IssueWorkspacesSectionContainer';
import { IssueRelationshipsSectionContainer } from '@/pages/kanban/IssueRelationshipsSectionContainer';
import { IssueSubIssuesSectionContainer } from '@/pages/kanban/IssueSubIssuesSectionContainer';

interface CreateIssueLinkedSectionsProps {
  projectId: string;
  issueId: string | null;
}

/**
 * Workspaces + Relationships + Sub-issues for the Create Issue dialog.
 * Before the issue is saved these render as a one-line hint; after save they
 * render the EXACT same containers the right-side edit pane uses (wrapped in
 * a ProjectProvider, since the dialog lives above the route's provider), so
 * the two surfaces are behaviourally identical.
 */
export function CreateIssueLinkedSections({
  projectId,
  issueId,
}: CreateIssueLinkedSectionsProps) {
  const { t } = useTranslation('common');

  if (!issueId) {
    return (
      <p className="text-low text-sm">
        {t(
          'createIssueDialog.saveToAddLinked',
          'Save the issue, then add workspaces, relationships, sub-issues.'
        )}
      </p>
    );
  }

  return (
    <ProjectProvider projectId={projectId}>
      <div className="flex flex-col gap-base">
        <IssueWorkspacesSectionContainer
          projectId={projectId}
          issueId={issueId}
        />
        <IssueRelationshipsSectionContainer
          projectId={projectId}
          issueId={issueId}
        />
        <IssueSubIssuesSectionContainer
          projectId={projectId}
          issueId={issueId}
        />
      </div>
    </ProjectProvider>
  );
}
