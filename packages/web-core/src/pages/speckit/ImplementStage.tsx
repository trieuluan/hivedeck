import { useTranslation } from 'react-i18next';
import { ArrowClockwiseIcon, ArrowSquareOutIcon } from '@phosphor-icons/react';
import type { SpecKitTasks } from 'shared/types';

interface ImplementStageProps {
  tasks: SpecKitTasks | null;
  /** Live agent-session URL — the workspace view streams the transcript +
   * diffs for the pipeline's implement run. */
  liveHref: string | null;
  onRefresh: () => void;
}

export function ImplementStage({
  tasks,
  liveHref,
  onRefresh,
}: ImplementStageProps) {
  const { t } = useTranslation();
  const total = tasks?.total ?? 0;
  const completed = tasks?.completed ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex h-full flex-col gap-base overflow-y-auto p-double">
      <header className="space-y-half">
        <h2 className="text-lg font-semibold text-high">
          {t('common:ui.implement')}
        </h2>
        <p className="text-sm text-low">
          {t('common:ui.runs')}{' '}
          <span className="font-mono">/speckit.implement</span>{' '}
          {t('common:ui.inTheFeatureWorktreeExecutingThe')}{' '}
          <span className="text-brand">[P]</span>{' '}
          {t('common:ui.withinALayerAreDoneTogether')}
        </p>
      </header>

      <section className="space-y-base rounded-sm border p-base">
        <div className="flex items-center gap-base">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-half rounded-sm border px-base py-half text-sm text-normal"
          >
            <ArrowClockwiseIcon className="size-icon-sm" />
            {t('common:ui.refreshProgress')}
          </button>
          {liveHref && (
            <a
              href={liveHref}
              className="inline-flex items-center gap-half text-sm text-brand underline"
              target="_blank"
              rel="noreferrer"
            >
              <ArrowSquareOutIcon className="size-icon-sm" />
              {t('common:ui.liveSessionTranscriptDiffs')}
            </a>
          )}
        </div>

        {/* Progress */}
        <div className="space-y-half">
          <div className="flex justify-between text-xs text-low">
            <span>{t('common:ui.taskProgress')}</span>
            <span>
              {completed} / {total} ({pct}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-panel">
            <div
              className="h-full bg-success transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </section>

      {total === 0 && (
        <p className="text-sm text-low">
          {t('common:ui.noTasksToImplementYetGenerate')}
        </p>
      )}
    </div>
  );
}
