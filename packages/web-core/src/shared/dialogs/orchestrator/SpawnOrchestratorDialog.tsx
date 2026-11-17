import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BaseCodingAgent } from 'shared/types';
import { RobotIcon } from '@phosphor-icons/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { Button } from '@vibe/ui/components/Button';
import { Checkbox } from '@vibe/ui/components/Checkbox';
import { Label } from '@vibe/ui/components/Label';
import { Input } from '@vibe/ui/components/Input';
import { create, useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/shared/lib/modals';
import { workspacesApi } from '@/shared/lib/api';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useWorkspaces } from '@/shared/hooks/useWorkspaces';
import { workspaceSummaryKeys } from '@/shared/hooks/workspaceSummaryKeys';
import {
  ORCHESTRATOR_DIRECTIVES,
  composeOrchestratorPrompt,
  loadDirectiveState,
  saveDirectiveState,
} from '@/shared/lib/orchestrator/orchestratorOptions';

export interface SpawnOrchestratorDialogProps {}

// ADR-031: agents that can be the captain. Claude Code runs headed with its
// own /loop; Codex runs headless and HiveDeck sends it each tick.
const CAPTAIN_AGENTS: { id: BaseCodingAgent; key: string }[] = [
  { id: BaseCodingAgent.CLAUDE_CODE_HEADED, key: 'claude' },
  { id: BaseCodingAgent.CODEX, key: 'codex' },
];
const CAPTAIN_AGENT_STORAGE = 'hivedeck.captainAgent';

function loadCaptainAgent(): BaseCodingAgent {
  try {
    const saved = localStorage.getItem(CAPTAIN_AGENT_STORAGE);
    if (CAPTAIN_AGENTS.some((a) => a.id === saved)) {
      return saved as BaseCodingAgent;
    }
  } catch {
    // storage unavailable: use the default
  }
  return BaseCodingAgent.CLAUDE_CODE_HEADED;
}

const ORCHESTRATOR_STATUS_KEY = ['orchestrator', 'status'] as const;

const SpawnOrchestratorDialogImpl = create<SpawnOrchestratorDialogProps>(() => {
  const modal = useModal();
  const appNavigation = useAppNavigation();
  const { t } = useTranslation('tasks');
  const queryClient = useQueryClient();

  const [name, setName] = useState('Orchestrator');
  const [agent, setAgent] = useState<BaseCodingAgent>(loadCaptainAgent);
  const chooseAgent = (id: BaseCodingAgent) => {
    setAgent(id);
    try {
      localStorage.setItem(CAPTAIN_AGENT_STORAGE, id);
    } catch {
      // not persisted; fine
    }
  };
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    loadDirectiveState()
  );

  useEffect(() => {
    if (!modal.visible) {
      setConfirmRemove(false);
      setName('Orchestrator');
      setEnabled(loadDirectiveState());
    }
  }, [modal.visible]);

  // The orchestrator is a singleton; detect a live one so we can offer to open
  // it instead of spawning. The backend enforces the singleton regardless.
  // A Codex captain is idle between ticks but still on, so ask the backend.
  const { workspaces } = useWorkspaces();
  const { data: status } = useQuery({
    queryKey: ORCHESTRATOR_STATUS_KEY,
    queryFn: () => workspacesApi.orchestratorStatus(),
    enabled: modal.visible,
    refetchInterval: modal.visible ? 5000 : false,
  });
  const runningOrchestrator = useMemo(
    () =>
      workspaces.find(
        (ws) =>
          ws.kind === 'orchestrator' &&
          !ws.isArchived &&
          (status?.active ||
            ws.isRunning ||
            ws.latestProcessStatus === 'running')
      ) ?? null,
    [workspaces, status?.active]
  );
  const runningAgentKey =
    CAPTAIN_AGENTS.find((a) => a.id === status?.executor)?.key ?? null;

  // An idle (not running) orchestrator workspace: spawning reuses it with a
  // fresh session; it can also be removed to start over with no history.
  const idleOrchestrator = useMemo(
    () =>
      runningOrchestrator
        ? null
        : (workspaces.find(
            (ws) => ws.kind === 'orchestrator' && !ws.isArchived
          ) ?? null),
    [workspaces, runningOrchestrator]
  );
  const [confirmRemove, setConfirmRemove] = useState(false);

  const enabledIds = useMemo(
    () => new Set(Object.keys(enabled).filter((id) => enabled[id])),
    [enabled]
  );

  const toggleDirective = (id: string, checked: boolean) => {
    setEnabled((prev) => {
      const next = { ...prev, [id]: checked };
      saveDirectiveState(next);
      return next;
    });
  };

  const spawnMutation = useMutation({
    mutationFn: async () => {
      return workspacesApi.spawnOrchestrator({
        prompt: composeOrchestratorPrompt(enabledIds),
        name: name.trim() || 'Orchestrator',
        executor: agent,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: workspaceSummaryKeys.all });
      queryClient.invalidateQueries({ queryKey: ORCHESTRATOR_STATUS_KEY });
      modal.hide();
      if (data.workspace) appNavigation.goToWorkspace(data.workspace.id);
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => workspacesApi.closeOrchestrator(),
    onSuccess: () => {
      // Refetching flips the dialog back to the spawn form once the now-closed
      // orchestrator stops reporting as running.
      queryClient.invalidateQueries({ queryKey: workspaceSummaryKeys.all });
      queryClient.invalidateQueries({ queryKey: ORCHESTRATOR_STATUS_KEY });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (workspaceId: string) =>
      workspacesApi.delete(workspaceId),
    onSuccess: () => {
      setConfirmRemove(false);
      queryClient.invalidateQueries({ queryKey: workspaceSummaryKeys.all });
    },
  });

  const busy =
    spawnMutation.isPending ||
    closeMutation.isPending ||
    removeMutation.isPending;

  const handleOpenChange = (open: boolean) => {
    if (!open) modal.hide();
  };

  // Route "open" through the spawn endpoint so the backend decides reuse vs.
  // respawn: a genuinely live session is reused, a dead one (tmux gone) is
  // transparently replaced with a fresh session.
  const openRunning = () => spawnMutation.mutate();

  return (
    <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RobotIcon className="size-5" weight="fill" />
            {t('spawnOrchestrator.title')}
          </DialogTitle>
          <DialogDescription>
            {t('spawnOrchestrator.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {runningOrchestrator && (
            <div className="space-y-1 rounded-md border border-border bg-secondary/50 p-3 text-sm text-normal">
              <p>{t('spawnOrchestrator.existingRunning')}</p>
              {runningAgentKey && (
                <p className="text-xs text-low">
                  {status?.loop_interval_secs
                    ? t('spawnOrchestrator.runningOnLoop', {
                        agent: t(
                          `spawnOrchestrator.agents.${runningAgentKey}.label`
                        ),
                        minutes: Math.round(status.loop_interval_secs / 60),
                      })
                    : t('spawnOrchestrator.runningOn', {
                        agent: t(
                          `spawnOrchestrator.agents.${runningAgentKey}.label`
                        ),
                      })}
                </p>
              )}
            </div>
          )}

          {idleOrchestrator && (
            <div className="space-y-2 rounded-md border border-border bg-secondary/50 p-3 text-sm text-normal">
              <p>{t('spawnOrchestrator.existingIdle')}</p>
              {confirmRemove ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 text-xs text-low">
                    {t('spawnOrchestrator.removeConfirm')}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmRemove(false)}
                    disabled={busy}
                  >
                    {t('common:buttons.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => removeMutation.mutate(idleOrchestrator.id)}
                    disabled={busy}
                  >
                    {removeMutation.isPending
                      ? t('spawnOrchestrator.removing')
                      : t('spawnOrchestrator.remove')}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmRemove(true)}
                  disabled={busy}
                >
                  {t('spawnOrchestrator.removeStart')}
                </Button>
              )}
              {removeMutation.error && (
                <p className="text-xs text-destructive">
                  {removeMutation.error instanceof Error
                    ? removeMutation.error.message
                    : String(removeMutation.error)}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="orchestrator-name">
              {t('spawnOrchestrator.nameLabel')}
            </Label>
            <Input
              id="orchestrator-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!runningOrchestrator}
            />
          </div>

          {!runningOrchestrator && (
            <div className="space-y-2">
              <Label>{t('spawnOrchestrator.agentLabel')}</Label>
              <div
                role="radiogroup"
                aria-label={t('spawnOrchestrator.agentLabel')}
                className="grid grid-cols-2 gap-2"
              >
                {CAPTAIN_AGENTS.map((a) => {
                  const selected = agent === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => chooseAgent(a.id)}
                      disabled={busy}
                      className={`rounded-md border p-2 text-left transition-colors ${
                        selected
                          ? 'border-brand bg-brand/10'
                          : 'border-border hover:bg-secondary/50'
                      }`}
                    >
                      <span className="block text-sm font-medium text-high">
                        {t(`spawnOrchestrator.agents.${a.key}.label`)}
                      </span>
                      <span className="block text-xs text-low">
                        {t(`spawnOrchestrator.agents.${a.key}.description`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <Label>{t('spawnOrchestrator.directivesLabel')}</Label>
            {ORCHESTRATOR_DIRECTIVES.map((directive) => (
              <div key={directive.id} className="flex items-start gap-2">
                <Checkbox
                  id={`orchestrator-directive-${directive.id}`}
                  checked={!!enabled[directive.id]}
                  onCheckedChange={(checked) =>
                    toggleDirective(directive.id, checked === true)
                  }
                  disabled={!!runningOrchestrator}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <Label
                    htmlFor={`orchestrator-directive-${directive.id}`}
                    className="font-normal"
                  >
                    {t(directive.labelKey)}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t(directive.descriptionKey)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {spawnMutation.error && (
            <div className="text-sm text-destructive">
              {spawnMutation.error instanceof Error
                ? spawnMutation.error.message
                : String(spawnMutation.error)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => modal.hide()}
            disabled={busy}
          >
            {t('common:buttons.cancel')}
          </Button>
          {runningOrchestrator ? (
            <>
              <Button
                variant="destructive"
                onClick={() => closeMutation.mutate()}
                disabled={busy}
              >
                {closeMutation.isPending
                  ? t('spawnOrchestrator.closing')
                  : t('spawnOrchestrator.close')}
              </Button>
              <Button onClick={openRunning} disabled={busy}>
                {spawnMutation.isPending
                  ? t('spawnOrchestrator.spawning')
                  : t('spawnOrchestrator.openRunning')}
              </Button>
            </>
          ) : (
            <Button onClick={() => spawnMutation.mutate()} disabled={busy}>
              {spawnMutation.isPending
                ? t('spawnOrchestrator.spawning')
                : t('spawnOrchestrator.spawn')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export const SpawnOrchestratorDialog = defineModal<
  SpawnOrchestratorDialogProps,
  void
>(SpawnOrchestratorDialogImpl);
