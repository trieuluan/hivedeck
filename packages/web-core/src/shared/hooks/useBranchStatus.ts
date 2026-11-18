import { useQuery } from '@tanstack/react-query';
import { workspacesApi } from '@/shared/lib/api';
import { useWorkspaces } from '@/shared/hooks/useWorkspaces';

export function useBranchStatus(workspaceId?: string) {
  // A captain works in its own folder, not a repo: there is no branch to
  // poll (it was asking `git/status` every 5 s for nothing).
  const { workspaces } = useWorkspaces();
  const isCaptain =
    workspaces.find((ws) => ws.id === workspaceId)?.kind === 'orchestrator';
  return useQuery({
    queryKey: ['branchStatus', workspaceId],
    queryFn: () => workspacesApi.getBranchStatus(workspaceId!),
    enabled: !!workspaceId && !isCaptain,
    refetchInterval: 5000,
  });
}
