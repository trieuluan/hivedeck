import { useEffect, useRef } from 'react';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useTranslation } from 'react-i18next';
import { useTerminal, type AgentCli } from '@/shared/hooks/useTerminal';
import { TerminalPanel } from '@vibe/ui/components/TerminalPanel';
import { XTermInstance } from './XTermInstance';

// Agent tabs run each vendor's official CLI with the user's own login;
// HiveDeck only hosts the terminal.
const AGENT_TAB_OPTIONS: { id: AgentCli; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor Agent' },
  { id: 'gemini', label: 'Gemini CLI' },
];

export function TerminalPanelContainer() {
  const { t } = useTranslation('common');
  const { workspace } = useWorkspaceContext();
  const {
    getTabsForWorkspace,
    getActiveTab,
    createTab,
    closeTab,
    setActiveTab,
    clearWorkspaceTabs,
  } = useTerminal();

  const workspaceId = workspace?.id;
  const containerRef = workspace?.container_ref ?? null;
  const tabs = workspaceId ? getTabsForWorkspace(workspaceId) : [];
  const activeTab = workspaceId ? getActiveTab(workspaceId) : null;

  const creatingRef = useRef(false);
  const prevWorkspaceIdRef = useRef<string | null>(null);

  // Clean up terminals when workspace changes
  useEffect(() => {
    if (
      prevWorkspaceIdRef.current &&
      prevWorkspaceIdRef.current !== workspaceId
    ) {
      clearWorkspaceTabs(prevWorkspaceIdRef.current);
    }
    prevWorkspaceIdRef.current = workspaceId ?? null;
  }, [workspaceId, clearWorkspaceTabs]);

  // Auto-create first tab when workspace is selected and terminal mode is active
  useEffect(() => {
    if (
      workspaceId &&
      containerRef &&
      tabs.length === 0 &&
      !creatingRef.current
    ) {
      creatingRef.current = true;
      createTab(workspaceId, containerRef);
    }
    if (tabs.length > 0) {
      creatingRef.current = false;
    }
  }, [workspaceId, containerRef, tabs.length, createTab]);

  return (
    <TerminalPanel
      tabs={tabs.map((t) => ({ id: t.id, title: t.title }))}
      activeTabId={activeTab?.id ?? null}
      onSelectTab={(tabId) => workspaceId && setActiveTab(workspaceId, tabId)}
      onCloseTab={(tabId) => workspaceId && closeTab(workspaceId, tabId)}
      newTabOptions={[
        { id: 'shell', label: t('ui.newShellTab') },
        ...AGENT_TAB_OPTIONS,
      ]}
      onNewTab={(optionId) => {
        if (!workspaceId || !containerRef) return;
        const agent = AGENT_TAB_OPTIONS.find((o) => o.id === optionId)?.id;
        createTab(workspaceId, containerRef, undefined, agent);
      }}
      renderTab={(tabId, isActive) => (
        <XTermInstance
          key={tabId}
          tabId={tabId}
          workspaceId={workspaceId ?? ''}
          isActive={isActive}
          executionProcessId={
            tabs.find((tab) => tab.id === tabId)?.executionProcessId
          }
          agent={tabs.find((tab) => tab.id === tabId)?.agent}
          onClose={() => workspaceId && closeTab(workspaceId, tabId)}
        />
      )}
    />
  );
}
