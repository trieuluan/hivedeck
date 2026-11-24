'use client';

import { useTranslation } from 'react-i18next';
import {
  ArrowBendUpRightIcon,
  ArrowsLeftRightIcon,
  CopyIcon,
  ProhibitIcon,
  XIcon,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { CollapsibleSectionHeader } from './CollapsibleSectionHeader';
import type { RelationshipDisplayType } from './RelationshipBadge';

const RELATIONSHIP_META: Record<
  RelationshipDisplayType,
  {
    label: string;
    icon: typeof ProhibitIcon;
    badgeClass: string;
  }
> = {
  blocked_by: {
    label: 'blocked by',
    icon: ProhibitIcon,
    badgeClass: 'border-error/35 bg-error/15 text-error',
  },
  blocks: {
    label: 'blocks',
    icon: ArrowBendUpRightIcon,
    badgeClass: 'border-brand/35 bg-brand/15 text-brand',
  },
  related: {
    label: 'related',
    icon: ArrowsLeftRightIcon,
    badgeClass: 'border-sky-500/35 bg-sky-500/15 text-sky-400',
  },
  duplicate_of: {
    label: 'dup of',
    icon: CopyIcon,
    badgeClass: 'border-violet-500/35 bg-violet-500/15 text-violet-400',
  },
  duplicated_by: {
    label: 'dup',
    icon: CopyIcon,
    badgeClass: 'border-violet-500/35 bg-violet-500/15 text-violet-400',
  },
};

function statusBadgeClass(status?: string): string {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'done' || s === 'completed') {
    return 'border-emerald-500/35 bg-emerald-500/15 text-emerald-400';
  }
  if (s === 'in progress' || s === 'in review') {
    return 'border-sky-500/35 bg-sky-500/15 text-sky-400';
  }
  return 'border-border bg-secondary text-low';
}

export interface IssueRelationshipsSectionRelationship {
  relationshipId: string;
  relatedIssueId: string;
  relatedIssueDisplayId: string;
  relatedIssueTitle?: string;
  relatedIssueStatus?: string;
  displayType: RelationshipDisplayType;
}

export interface IssueRelationshipsSectionProps {
  relationships: IssueRelationshipsSectionRelationship[];
  onRelationshipClick: (relatedIssueId: string) => void;
  onRemoveRelationship?: (relationshipId: string) => void;
  isLoading?: boolean;
  headerExtra?: React.ReactNode;
}

export function IssueRelationshipsSection({
  relationships,
  onRelationshipClick,
  onRemoveRelationship,
  isLoading,
  headerExtra,
}: IssueRelationshipsSectionProps) {
  const { t } = useTranslation('common');
  const isEmpty = !isLoading && relationships.length === 0;

  return (
    <CollapsibleSectionHeader
      title={`${t('kanban.relationships', 'Relationships')} (${relationships.length})`}
      persistKey="kanban-issue-relationships"
      defaultExpanded={!isEmpty}
      headerExtra={headerExtra}
    >
      <div
        className={
          isEmpty
            ? 'px-base py-1 flex flex-col'
            : 'divide-y divide-border/70 flex flex-col'
        }
      >
        {isLoading ? (
          <p className="px-base py-2 text-xs text-low">{t('states.loading')}</p>
        ) : relationships.length === 0 ? (
          <p className="py-1 text-xs text-low">
            {t('kanban.noRelationships', 'No relationships')}
          </p>
        ) : (
          relationships.map((rel) => {
            const meta = RELATIONSHIP_META[rel.displayType];
            const Icon = meta.icon;
            return (
              <div
                key={rel.relationshipId}
                className="group flex items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-secondary/40"
              >
                <button
                  type="button"
                  onClick={() => onRelationshipClick(rel.relatedIssueId)}
                  title={
                    rel.relatedIssueTitle
                      ? `${rel.relatedIssueDisplayId} · ${rel.relatedIssueTitle}`
                      : rel.relatedIssueDisplayId
                  }
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                      meta.badgeClass
                    )}
                  >
                    <Icon className="size-3" aria-hidden />
                    {meta.label}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-high">
                    {rel.relatedIssueDisplayId}
                  </span>
                  {rel.relatedIssueTitle && (
                    <span className="min-w-0 truncate text-xs text-normal">
                      {rel.relatedIssueTitle}
                    </span>
                  )}
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  {rel.relatedIssueStatus && (
                    <span
                      className={cn(
                        'rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap',
                        statusBadgeClass(rel.relatedIssueStatus)
                      )}
                    >
                      {rel.relatedIssueStatus}
                    </span>
                  )}
                  {onRemoveRelationship && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveRelationship(rel.relationshipId);
                      }}
                      className="rounded p-1 text-low opacity-0 transition-all hover:bg-error/15 hover:text-error group-hover:opacity-100"
                      aria-label={t('common:ui.removeRelationship')}
                    >
                      <XIcon className="size-3" weight="bold" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </CollapsibleSectionHeader>
  );
}
