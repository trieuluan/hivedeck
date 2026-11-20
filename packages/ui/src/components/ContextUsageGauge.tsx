import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';

export interface ContextUsageInfo {
  total_tokens: number;
  model_context_window: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_creation_tokens?: number | null;
}

export interface ContextCategoryMetric {
  key: string;
  tokens: number;
  count?: number | null;
}

export interface ContextBreakdown {
  source: string;
  categories: ContextCategoryMetric[];
  payload_tokens: number;
  model?: string | null;
  upstream?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_creation_tokens?: number | null;
  model_context_window?: number | null;
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  messages: { label: 'Messages', color: 'bg-brand' },
  mcp_tools: { label: 'MCP tools', color: 'bg-orange-500' },
  system_tools: { label: 'System tools', color: 'bg-emerald-500' },
  system_prompt: { label: 'System prompt', color: 'bg-amber-500' },
  skills: { label: 'Skills', color: 'bg-sky-500' },
  memory_files: { label: 'Memory files', color: 'bg-violet-500' },
  mcp_instructions: { label: 'MCP instructions', color: 'bg-cyan-500' },
  custom_agents: { label: 'Custom agents', color: 'bg-pink-500' },
  deferred_tools: { label: 'MCP tools (deferred)', color: 'bg-low/50' },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const formatTokens = (n: number) => {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1).replace(/\.0$/, '')}K`;
  }
  return n.toString();
};

export interface ContextUsageGaugeProps {
  tokenUsageInfo?: ContextUsageInfo | null;
  sessionId?: string | null;
  className?: string;
  onCompact?: () => void;
}

export function ContextUsageGauge({
  tokenUsageInfo,
  sessionId,
  className,
  onCompact,
}: ContextUsageGaugeProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null
  );

  useEffect(() => {
    if (!sessionId) {
      setBreakdown(null);
      return;
    }
    let cancelled = false;
    const fetchBreakdown = async () => {
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/context-breakdown`
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          success?: boolean;
          data?: ContextBreakdown | null;
        };
        if (!cancelled && json?.success) {
          setBreakdown(json.data ?? null);
        }
      } catch {
        // Ignore transient network errors while backend restarts
      }
    };

    void fetchBreakdown();
    if (!open) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(() => {
      void fetchBreakdown();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId, open, tokenUsageInfo?.total_tokens]);

  const {
    percentage,
    formattedUsed,
    formattedTotal,
    formattedFree,
    status,
    cacheHitPct,
    sessionIn,
    sessionOut,
    cacheRead,
    cacheCreation,
    rawInput,
    calibratedCategories,
    contextWindow,
  } = useMemo(() => {
    const windowSize =
      tokenUsageInfo?.model_context_window ||
      breakdown?.model_context_window ||
      0;

    const rIn = tokenUsageInfo?.input_tokens ?? breakdown?.input_tokens ?? 0;
    const cRead =
      tokenUsageInfo?.cache_read_tokens ?? breakdown?.cache_read_tokens ?? 0;
    const cCreate =
      tokenUsageInfo?.cache_creation_tokens ??
      breakdown?.cache_creation_tokens ??
      0;
    const sOut = tokenUsageInfo?.output_tokens ?? breakdown?.output_tokens ?? 0;

    const usedTokens =
      tokenUsageInfo && tokenUsageInfo.total_tokens > 0
        ? tokenUsageInfo.total_tokens
        : breakdown && breakdown.payload_tokens > 0
          ? breakdown.payload_tokens
          : rIn + cRead + cCreate;

    if (windowSize === 0 && usedTokens === 0) {
      return {
        percentage: 0,
        formattedUsed: '0',
        formattedTotal: '0',
        formattedFree: '0',
        status: 'empty' as const,
        cacheHitPct: null as number | null,
        sessionIn: 0,
        sessionOut: 0,
        cacheRead: 0,
        cacheCreation: 0,
        rawInput: 0,
        calibratedCategories: [] as Array<
          ContextCategoryMetric & { label: string; color: string; pct: number }
        >,
        contextWindow: 0,
      };
    }

    const effectiveWindow = windowSize > 0 ? windowSize : 200_000;
    const pct = Math.min(100, (usedTokens / effectiveWindow) * 100);

    let statusValue: 'low' | 'medium' | 'high' | 'critical' | 'empty';
    if (pct < 50) statusValue = 'low';
    else if (pct < 75) statusValue = 'medium';
    else if (pct < 90) statusValue = 'high';
    else statusValue = 'critical';

    const totalIn = rIn + cRead + cCreate;
    const hitPct = totalIn > 0 ? Math.round((cRead / totalIn) * 100) : null;
    const freeTokens = Math.max(0, effectiveWindow - usedTokens);

    const rawCats = breakdown?.categories ?? [];
    const payloadSum = rawCats.reduce((acc, c) => acc + c.tokens, 0);
    const scale =
      payloadSum > 0 && usedTokens > 0 ? usedTokens / payloadSum : 1;

    const calibrated = rawCats.map((cat) => {
      const meta = CATEGORY_META[cat.key] ?? {
        label: cat.key,
        color: 'bg-normal',
      };
      const scaledTokens =
        cat.tokens > 0 ? Math.round(cat.tokens * scale) : 0;
      const catPct =
        effectiveWindow > 0 ? (scaledTokens / effectiveWindow) * 100 : 0;
      return {
        ...cat,
        tokens: scaledTokens,
        label: meta.label,
        color: meta.color,
        pct: catPct,
      };
    });

    return {
      percentage: pct,
      formattedUsed: formatTokens(usedTokens),
      formattedTotal: formatTokens(effectiveWindow),
      formattedFree: formatTokens(freeTokens),
      status: statusValue,
      cacheHitPct: hitPct,
      sessionIn: totalIn,
      sessionOut: sOut,
      cacheRead: cRead,
      cacheCreation: cCreate,
      rawInput: rIn,
      calibratedCategories: calibrated,
      contextWindow: effectiveWindow,
    };
  }, [tokenUsageInfo, breakdown]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 340;
      const left = Math.max(
        12,
        Math.min(window.innerWidth - width - 12, rect.right - width)
      );
      const top = Math.max(12, rect.top - 8);
      setCoords({ left, top });
    };
    updatePosition();
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  const progress = clamp(percentage / 100, 0, 1);

  const tooltip =
    status === 'empty'
      ? t('contextUsage.emptyTooltip')
      : t('contextUsage.tooltip', {
          percentage: Math.round(percentage),
          used: formattedUsed,
          total: formattedTotal,
        });

  const progressColor =
    status === 'empty'
      ? 'text-low/40'
      : status === 'critical'
        ? 'text-error'
        : status === 'high'
          ? 'text-brand-secondary'
          : status === 'medium'
            ? 'text-normal'
            : 'text-low';

  const radius = 8;
  const strokeWidth = 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  const roundedPct = Math.round(percentage);
  const usedRatio = clamp(percentage, 0, 100);
  const hasCategories = calibratedCategories.length > 0;

  return (
    <>
      <Tooltip content={tooltip} side="bottom">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            'inline-flex items-center gap-1 rounded border border-border/60 bg-secondary/60 px-1.5 py-0.5',
            'hover:bg-panel transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
            open && 'border-brand/50 bg-panel',
            className
          )}
          aria-expanded={open}
          aria-label={
            status === 'empty'
              ? t('contextUsage.label')
              : t('contextUsage.ariaLabel', {
                  percentage: roundedPct,
                })
          }
        >
          <svg
            viewBox="0 0 20 20"
            className="size-3.5 -rotate-90 shrink-0"
            aria-hidden="true"
          >
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              className="text-border/60"
            />
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={dashOffset}
              className={cn(
                progressColor,
                'transition-all duration-500 ease-out'
              )}
            />
          </svg>
          <span className="text-[11px] font-medium tabular-nums text-low">
            {roundedPct}%
          </span>
        </button>
      </Tooltip>

      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Token & Context"
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              transform: 'translateY(-100%)',
              width: 340,
            }}
            className="z-[10000] max-h-[80vh] overflow-y-auto space-y-3 rounded-xl border border-border bg-panel p-3.5 text-xs shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-high">
                    Token &amp; Cache
                  </span>
                  {breakdown?.upstream && (
                    <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                      via {breakdown.upstream}
                    </span>
                  )}
                </div>
                <div className="truncate text-2xs text-low">
                  {breakdown?.model || 'Phân bổ context và token phiên hiện tại'}
                </div>
              </div>
              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-2xs font-medium tabular-nums text-normal">
                {formattedUsed} / {formattedTotal}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border/80 bg-secondary/40 p-2.5">
                <div className="text-2xs text-low">Context</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-base font-semibold tabular-nums text-brand">
                    {roundedPct}%
                  </span>
                  <span className="truncate text-2xs text-normal">
                    {formattedUsed} / {formattedTotal}
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-border/80 bg-secondary/40 p-2.5">
                <div className="text-2xs text-low">Phiên hiện tại</div>
                <div className="mt-1 truncate text-xs font-semibold tabular-nums text-high">
                  {sessionIn > 0 || sessionOut > 0
                    ? `${formatTokens(sessionIn)} in · ${formatTokens(sessionOut)} out`
                    : 'Chưa có dữ liệu'}
                </div>
                <div className="text-2xs text-low">
                  Cache hit{' '}
                  <span className="font-medium text-brand">
                    {cacheHitPct !== null ? `${cacheHitPct}%` : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-2xs text-low">
                <span>
                  {hasCategories ? 'Chi tiết Context (Proxy)' : 'Bóc tách context'}
                </span>
                <span className="tabular-nums text-normal">
                  {formattedUsed} / {formattedTotal} ({roundedPct}%)
                </span>
              </div>

              <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
                {hasCategories ? (
                  calibratedCategories
                    .filter((c) => c.pct > 0)
                    .map((cat) => (
                      <div
                        key={cat.key}
                        className={cn(cat.color, 'h-full transition-all duration-300')}
                        style={{ width: `${clamp(cat.pct, 0.5, 100)}%` }}
                        title={`${cat.label}: ${formatTokens(cat.tokens)}`}
                      />
                    ))
                ) : (
                  <div
                    className="h-full bg-brand transition-all duration-300"
                    style={{ width: `${usedRatio}%` }}
                  />
                )}
              </div>

              <div className="space-y-1">
                {hasCategories ? (
                  calibratedCategories.map((cat) => (
                    <div
                      key={cat.key}
                      className="flex items-center justify-between rounded-md bg-secondary/35 px-2.5 py-1.5"
                    >
                      <span className="inline-flex items-center gap-2 text-normal">
                        <span className={cn('h-2 w-2 rounded-full', cat.color)} />
                        <span>{cat.label}</span>
                        {cat.count != null && cat.count > 0 && (
                          <span className="rounded bg-secondary px-1 py-0.2 text-[10px] tabular-nums text-low">
                            {cat.count}
                          </span>
                        )}
                      </span>
                      <span className="font-medium tabular-nums text-high">
                        {cat.tokens > 0 ? formatTokens(cat.tokens) : '—'}
                        {cat.tokens > 0 && contextWindow > 0 && (
                          <span className="ml-1.5 text-2xs font-normal text-low">
                            {cat.pct.toFixed(1)}%
                          </span>
                        )}
                      </span>
                    </div>
                  ))
                ) : (
                  <>
                    <div className="flex items-center justify-between rounded-md bg-secondary/35 px-2.5 py-1.5">
                      <span className="inline-flex items-center gap-2 text-normal">
                        <span className="h-2 w-2 rounded-full bg-brand" />
                        Đã dùng (Context)
                      </span>
                      <span className="font-medium tabular-nums text-high">
                        {formattedUsed}
                      </span>
                    </div>
                    {cacheRead > 0 && (
                      <div className="flex items-center justify-between rounded-md bg-secondary/35 px-2.5 py-1.5">
                        <span className="inline-flex items-center gap-2 text-normal">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          Đọc từ Cache
                        </span>
                        <span className="font-medium tabular-nums text-high">
                          {formatTokens(cacheRead)}
                        </span>
                      </div>
                    )}
                    {(rawInput > 0 || cacheCreation > 0) && (
                      <div className="flex items-center justify-between rounded-md bg-secondary/35 px-2.5 py-1.5">
                        <span className="inline-flex items-center gap-2 text-normal">
                          <span className="h-2 w-2 rounded-full bg-sky-500" />
                          Đầu vào mới &amp; tạo cache
                        </span>
                        <span className="font-medium tabular-nums text-high">
                          {formatTokens(rawInput + cacheCreation)}
                        </span>
                      </div>
                    )}
                    {sessionOut > 0 && (
                      <div className="flex items-center justify-between rounded-md bg-secondary/35 px-2.5 py-1.5">
                        <span className="inline-flex items-center gap-2 text-normal">
                          <span className="h-2 w-2 rounded-full bg-amber-500" />
                          Đầu ra (Output)
                        </span>
                        <span className="font-medium tabular-nums text-high">
                          {formatTokens(sessionOut)}
                        </span>
                      </div>
                    )}
                  </>
                )}

                <div className="flex items-center justify-between rounded-md bg-secondary/35 px-2.5 py-1.5">
                  <span className="inline-flex items-center gap-2 text-low">
                    <span className="h-2 w-2 rounded-full bg-border" />
                    Còn trống
                  </span>
                  <span className="font-medium tabular-nums text-normal">
                    {formattedFree}
                  </span>
                </div>
              </div>
            </div>

            {onCompact && (
              <div className="flex items-center justify-end border-t border-border/60 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onCompact();
                  }}
                  className="rounded-md border border-brand/60 bg-brand/10 px-2.5 py-1 text-2xs font-medium text-brand transition-colors hover:bg-brand/20"
                >
                  /compact
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
