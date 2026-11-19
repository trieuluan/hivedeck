import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from '@vibe/ui/components/Dialog';
import { CollapsibleSectionHeader } from '@vibe/ui/components/CollapsibleSectionHeader';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useTheme } from '@/shared/hooks/useTheme';
import { makeLocalApiRequest } from '@/shared/lib/localApiTransport';
import { getActualTheme } from '@/shared/lib/theme';

type Document = { repo: string; path: string; content: string };

export function IssueDocumentsSection({ issueId }: { issueId: string }) {
  const { t } = useTranslation('common');
  const { getWorkspacesForIssue } = useProjectContext();
  const { theme } = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const workspaces = getWorkspacesForIssue(issueId);
  const queries = useQueries({
    queries: workspaces
      .filter((workspace) => workspace.local_workspace_id)
      .map((workspace) => ({
        queryKey: ['workspace-documents', workspace.local_workspace_id],
        queryFn: async (): Promise<Document[]> => {
          const response = await makeLocalApiRequest(
            `/api/workspaces/${workspace.local_workspace_id}/files/documents`
          );
          if (!response.ok) throw new Error('Failed to load documents');
          const result = await response.json();
          return result.data ?? [];
        },
        refetchInterval: 10000,
      })),
  });
  const documents = queries.flatMap((query, index) =>
    (query.data ?? []).map((document) => ({
      ...document,
      key: `${index}:${document.repo}:${document.path}`,
    }))
  );
  const current = documents.find((document) => document.key === selected);
  if (!documents.length) return null;
  return (
    <div className="border-t">
      <CollapsibleSectionHeader
        title={t('documents.title')}
        persistKey="kanban-issue-documents"
        defaultExpanded
      >
        <div className="p-base flex flex-col gap-base border-t">
          {documents.map((document) => (
            <button
              key={document.key}
              type="button"
              className="text-left text-brand break-all"
              aria-haspopup="dialog"
              onClick={() => setSelected(document.key)}
            >
              {document.path}
            </button>
          ))}
        </div>
      </CollapsibleSectionHeader>
      <Dialog
        open={!!current}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent
          className="max-w-4xl max-h-[85vh] flex flex-col p-base gap-base"
          aria-describedby={undefined}
        >
          <DialogTitle className="pr-8 break-all">{current?.path}</DialogTitle>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {current && (
              <MarkdownPreview
                content={current.content}
                theme={getActualTheme(theme)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
