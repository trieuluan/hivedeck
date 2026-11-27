import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, LockIcon, PlugsIcon } from '@phosphor-icons/react';
import type { McpInjectionMode } from 'shared/types';
import { handleApiResponse } from '@/shared/lib/api';

interface WorkspaceMcpItem {
  name: string;
  summary: string;
  injection_mode: McpInjectionMode;
  selected: boolean;
}

interface WorkspaceSkillItem {
  name: string;
  plugin_name: string;
  injection_mode: McpInjectionMode;
  selected: boolean;
}

interface WorkspaceMcpResponse {
  items: WorkspaceMcpItem[];
}

interface WorkspaceSkillResponse {
  items: WorkspaceSkillItem[];
}

export function WorkspaceMcpSelector({
  workspaceId,
  isRunning,
}: {
  workspaceId: string;
  isRunning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WorkspaceMcpItem[]>([]);
  const [skillItems, setSkillItems] = useState<WorkspaceSkillItem[]>([]);
  const [saving, setSaving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });

  const load = useCallback(async () => {
    try {
      const [mcpResp, skillResp] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/mcp`),
        fetch(`/api/workspaces/${workspaceId}/skills`),
      ]);
      const mcpData = await handleApiResponse<WorkspaceMcpResponse>(mcpResp);
      setItems(mcpData.items ?? []);
      if (skillResp.ok) {
        const skillData =
          await handleApiResponse<WorkspaceSkillResponse>(skillResp);
        setSkillItems(skillData.items ?? []);
      }
    } catch {
      // Non-fatal: keep existing state if workspace MCP endpoint fails
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({
        top: rect.top - 8,
        right: window.innerWidth - rect.right,
      });
    };
    updatePosition();
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, load]);

  const alwaysItems = items.filter((i) => i.injection_mode === 'always');
  const onDemandItems = items.filter((i) => i.injection_mode === 'on_demand');
  const onDemandSkills = skillItems.filter(
    (s) => s.injection_mode === 'on_demand'
  );
  const activeOnDemandCount =
    onDemandItems.filter((i) => i.selected).length +
    onDemandSkills.filter((s) => s.selected).length;

  if (items.length === 0 && onDemandSkills.length === 0) return null;

  const toggleOnDemandSkill = async (name: string) => {
    if (saving) return;
    const nextSelected = onDemandSkills
      .filter((s) => (s.name === name ? !s.selected : s.selected))
      .map((s) => s.name);

    setSkillItems((prev) =>
      prev.map((s) => (s.name === name ? { ...s, selected: !s.selected } : s))
    );
    setSaving(true);
    try {
      const resp = await fetch(`/api/workspaces/${workspaceId}/skills`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected: nextSelected }),
      });
      await handleApiResponse<string[]>(resp);
    } catch {
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleOnDemand = async (name: string) => {
    if (saving) return;
    const nextSelected = onDemandItems
      .filter((i) => (i.name === name ? !i.selected : i.selected))
      .map((i) => i.name);

    setItems((prev) =>
      prev.map((i) => (i.name === name ? { ...i, selected: !i.selected } : i))
    );
    setSaving(true);
    try {
      const resp = await fetch(`/api/workspaces/${workspaceId}/mcp`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected: nextSelected }),
      });
      await handleApiResponse<string[]>(resp);
    } catch {
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="Chọn MCP cho workspace này"
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border transition-colors ${
          activeOnDemandCount > 0
            ? 'border-brand/40 bg-brand/10 text-brand hover:bg-brand/20'
            : 'border-border bg-secondary/60 text-low hover:text-normal'
        }`}
      >
        <PlugsIcon className="h-3.5 w-3.5" />
        <span>MCP</span>
        {activeOnDemandCount > 0 && (
          <span className="rounded-full bg-brand/20 px-1 text-[10px] leading-tight">
            +{activeOnDemandCount}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              top: coords.top,
              right: coords.right,
              maxHeight: Math.max(200, coords.top - 16),
            }}
            className="fixed z-50 w-72 -translate-y-full overflow-y-auto rounded-md border border-border bg-panel p-3 shadow-xl space-y-3 text-xs"
          >
            {alwaysItems.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-low">
                  Always active
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {alwaysItems.map((item) => (
                    <span
                      key={item.name}
                      className="inline-flex items-center gap-1 rounded border border-border bg-secondary/60 px-2 py-0.5 text-low"
                    >
                      <LockIcon className="h-3 w-3" />
                      {item.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-low">
                On-demand cho card này
              </div>
              {onDemandItems.length === 0 ? (
                <p className="text-low">
                  Chưa có MCP nào ở chế độ On-demand. Chỉnh trong Settings →
                  Plugins.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {onDemandItems.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      disabled={saving}
                      onClick={() => void toggleOnDemand(item.name)}
                      className={`w-full flex items-start gap-2 rounded border px-2.5 py-2 text-left transition-colors ${
                        item.selected
                          ? 'border-brand/60 bg-brand/10 text-normal'
                          : 'border-border bg-secondary/20 text-low hover:border-border/80 hover:text-normal'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                          item.selected
                            ? 'border-brand bg-brand text-black'
                            : 'border-border bg-panel'
                        }`}
                      >
                        {item.selected && (
                          <CheckIcon weight="bold" className="h-2.5 w-2.5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-normal">
                          {item.name}
                        </div>
                        {item.summary && (
                          <div className="truncate text-[11px] text-low">
                            {item.summary}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {onDemandSkills.length > 0 && (
              <div className="space-y-1.5 border-t border-border/60 pt-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-low">
                  On-demand Skills cho card này
                </div>
                <div className="space-y-1.5">
                  {onDemandSkills.map((skill) => (
                    <button
                      key={skill.name}
                      type="button"
                      disabled={saving}
                      onClick={() => void toggleOnDemandSkill(skill.name)}
                      className={`w-full flex items-start gap-2 rounded border px-2.5 py-2 text-left transition-colors ${
                        skill.selected
                          ? 'border-brand/60 bg-brand/10 text-normal'
                          : 'border-border bg-secondary/20 text-low hover:border-border/80 hover:text-normal'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                          skill.selected
                            ? 'border-brand bg-brand text-black'
                            : 'border-border bg-panel'
                        }`}
                      >
                        {skill.selected && (
                          <CheckIcon weight="bold" className="h-2.5 w-2.5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-normal">
                          {skill.name}
                        </div>
                        <div className="truncate text-[11px] text-low">
                          {skill.plugin_name}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isRunning && (onDemandItems.length > 0 || onDemandSkills.length > 0) && (
              <p className="border-t border-border/60 pt-2 text-[11px] text-low">
                Thay đổi MCP/Skill sẽ áp dụng ở lượt chạy tiếp theo.
              </p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
