import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BaseCodingAgent } from 'shared/types';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { nineRouterApi } from '@/shared/lib/api';

const ROUTED_EXECUTORS = new Set<BaseCodingAgent>([
  BaseCodingAgent.CLAUDE_CODE,
  BaseCodingAgent.CLAUDE_CODE_HEADED,
  BaseCodingAgent.CODEX,
  BaseCodingAgent.OPENCODE,
  BaseCodingAgent.GEMINI,
  BaseCodingAgent.QWEN_CODE,
  BaseCodingAgent.DROID,
]);

export function isRoutedExecutor(
  executor: BaseCodingAgent | null | undefined
): boolean {
  return Boolean(executor && ROUTED_EXECUTORS.has(executor));
}

export interface HiveRouterRoutingState {
  /** Whether this executor currently routes through HiveRouter. */
  isRouted: boolean;
  /** Whether this executor is capable of routing through HiveRouter. */
  supportsHiveRouter: boolean;
  /** Default combo name used for workspace/task runs when Model is left default. */
  defaultCoderCombo: string;
  /** Default combo name used for Captain runs. */
  defaultPlannerCombo: string;
  /** Available HiveRouter combo names (status combos + configured role combos). */
  combos: string[];
  routerRunning: boolean;
}

export function useHiveRouterRouting(
  executor: BaseCodingAgent | null | undefined
): HiveRouterRoutingState {
  const { config } = useUserSystem();
  const nineRouter = config?.nine_router;
  const supportsHiveRouter = isRoutedExecutor(executor);
  const routeAgents = Boolean(nineRouter?.route_agents);
  const isRouted = supportsHiveRouter && routeAgents;

  const { data: status } = useQuery({
    queryKey: ['router', 'status', 'for-selector'],
    queryFn: () => nineRouterApi.getStatus(false),
    enabled: isRouted,
    staleTime: 15_000,
  });

  const defaultCoderCombo = nineRouter?.roles?.coder?.trim() || 'coder';
  const defaultPlannerCombo = nineRouter?.roles?.planner?.trim() || 'planner';

  const combos = useMemo(() => {
    if (!isRouted) return [];
    const seen = new Set<string>();
    const add = (value?: string | null) => {
      const trimmed = value?.trim();
      if (trimmed) seen.add(trimmed);
    };
    add(nineRouter?.roles?.coder);
    add(nineRouter?.roles?.planner);
    add(nineRouter?.roles?.reviewer);
    add(nineRouter?.roles?.fast);
    for (const c of status?.combos ?? []) {
      add(c);
    }
    return Array.from(seen);
  }, [isRouted, nineRouter?.roles, status?.combos]);

  return {
    isRouted,
    supportsHiveRouter,
    defaultCoderCombo,
    defaultPlannerCombo,
    combos,
    routerRunning: status?.state === 'running',
  };
}
