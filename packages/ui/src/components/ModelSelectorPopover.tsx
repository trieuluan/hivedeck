import type { ReactElement, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSearchInput,
  DropdownMenuTrigger,
} from './Dropdown';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './Accordion';
import { ModelProviderIcon } from './ModelProviderIcon';
import { ModelList, type ModelListModel } from './ModelList';

interface ModelSelectorProvider {
  id: string;
  name: string;
}

interface ModelSelectorConfigLike {
  models: ModelListModel[];
  providers: ModelSelectorProvider[];
}

export interface ModelSelectorPopoverProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  config: ModelSelectorConfigLike;
  error?: string | null;
  selectedProviderId: string | null;
  selectedModelId: string | null;
  selectedReasoningId: string | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onModelSelect: (id: string, providerId?: string) => void;
  onReasoningSelect: (reasoningId: string | null) => void;
  recentModelEntries?: string[];
  showDefaultOption?: boolean;
  hiveRouterRoleCombo?: string | null;
  hiveRouterCombos?: string[];
  onSelectHiveRouterCombo?: (combo: string) => void;
  onSelectDefault?: () => void;
  scrollRef?: Ref<HTMLDivElement>;
  expandedProviderId?: string;
  onExpandedProviderIdChange?: (id: string) => void;
  resolvedTheme?: 'light' | 'dark';
}

const MODEL_LIST_PAGE_SIZE = 8;

function getModelKey(model: ModelListModel): string {
  return model.provider_id ? `${model.provider_id}/${model.id}` : model.id;
}

function getModelSortLabel(model: ModelListModel): string {
  return model.name || model.id;
}

function sortModelsAlphabetically(models: ModelListModel[]): ModelListModel[] {
  return [...models].sort((a, b) => {
    const labelComparison = getModelSortLabel(a).localeCompare(
      getModelSortLabel(b),
      undefined,
      {
        numeric: true,
        sensitivity: 'base',
      }
    );
    if (labelComparison !== 0) return labelComparison;

    return getModelKey(a).localeCompare(getModelKey(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

function getSelectedModel(
  models: ModelListModel[],
  selectedProviderId: string | null,
  selectedModelId: string | null
): ModelListModel | null {
  if (!selectedModelId) return null;
  const selectedId = selectedModelId.toLowerCase();
  if (selectedProviderId) {
    const providerId = selectedProviderId.toLowerCase();
    return (
      models.find(
        (model) =>
          model.id.toLowerCase() === selectedId &&
          model.provider_id?.toLowerCase() === providerId
      ) ?? null
    );
  }
  return models.find((model) => model.id.toLowerCase() === selectedId) ?? null;
}

function getPopoverWidth(
  hasProviders: boolean,
  hasReasoning: boolean,
  hasHiveRouter: boolean
): string {
  if (hasProviders) return 'w-[280px]';
  if (hasReasoning && hasHiveRouter) return 'w-[280px]';
  if (hasReasoning || hasHiveRouter) return 'w-[250px]';
  return 'w-[200px]';
}

function matchesSearch(model: ModelListModel, query: string): boolean {
  const name = model.name?.toLowerCase() ?? '';
  const id = model.id?.toLowerCase() ?? '';
  return name.includes(query) || id.includes(query);
}

interface ProviderAccordionProps {
  config: ModelSelectorConfigLike;
  selectedProviderId: string | null;
  selectedModelId: string | null;
  selectedReasoningId: string | null;
  searchQuery: string;
  onModelSelect: (id: string, providerId?: string) => void;
  onReasoningSelect: (reasoningId: string | null) => void;
  showDefaultOption?: boolean;
  defaultSuffix?: string | null;
  onSelectDefault?: () => void;
  scrollRef?: Ref<HTMLDivElement>;
  expandedProviderId: string;
  onExpandedProviderIdChange: (id: string) => void;
  resolvedTheme: 'light' | 'dark';
}

function ProviderAccordion({
  config,
  selectedProviderId,
  selectedModelId,
  selectedReasoningId,
  searchQuery,
  onModelSelect,
  onReasoningSelect,
  showDefaultOption = false,
  defaultSuffix,
  onSelectDefault,
  scrollRef,
  expandedProviderId,
  onExpandedProviderIdChange,
  resolvedTheme,
}: ProviderAccordionProps) {
  const { t } = useTranslation('common');
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const selectedModel = getSelectedModel(
    config.models,
    selectedProviderId,
    selectedModelId
  );

  const modelsByProvider = new Map<string, ModelListModel[]>();
  for (const model of config.models) {
    if (!model.provider_id) continue;
    const list = modelsByProvider.get(model.provider_id) ?? [];
    list.push(model);
    modelsByProvider.set(model.provider_id, list);
  }

  const isDefaultSelected = selectedModelId === null;
  const providers = config.providers;

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
    >
      <div className="flex flex-col py-half">
        <Accordion
          type="single"
          collapsible
          value={expandedProviderId}
          onValueChange={onExpandedProviderIdChange}
        >
          {providers.map((provider) => {
            const providerModels = sortModelsAlphabetically(
              modelsByProvider.get(provider.id) ?? []
            );
            const isSelectedProvider =
              Boolean(selectedModelId) &&
              selectedModel?.provider_id?.toLowerCase() ===
                provider.id.toLowerCase();

            if (
              normalizedSearch &&
              !providerModels.some((model) =>
                matchesSearch(model, normalizedSearch)
              )
            ) {
              return null;
            }

            return (
              <AccordionItem key={provider.id} value={provider.id}>
                <AccordionTrigger
                  sticky={provider.id === expandedProviderId}
                  className={cn(
                    'group gap-2 px-base py-half rounded-sm',
                    'text-sm font-medium text-low',
                    'hover:bg-secondary/60 transition-colors',
                    'focus:outline-none focus-visible:ring-1 focus-visible:ring-brand'
                  )}
                >
                  <ModelProviderIcon
                    providerId={provider.id}
                    theme={resolvedTheme}
                  />
                  <span className="flex-1 text-left truncate">
                    {provider.name}
                  </span>
                  <CaretDownIcon
                    className={cn(
                      'size-icon-2xs text-low transition-transform',
                      'group-data-[state=open]:rotate-180'
                    )}
                    weight="bold"
                  />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="pl-1">
                    <ModelList
                      models={providerModels}
                      selectedModelId={
                        isSelectedProvider ? selectedModelId : null
                      }
                      searchQuery={searchQuery}
                      onSelect={onModelSelect}
                      reasoningOptions={
                        isSelectedProvider
                          ? (selectedModel?.reasoning_options ?? [])
                          : []
                      }
                      selectedReasoningId={
                        isSelectedProvider ? selectedReasoningId : null
                      }
                      onReasoningSelect={onReasoningSelect}
                      justifyEnd={false}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
        {showDefaultOption && (
          <div
            className={cn(
              'group flex items-center rounded-sm mx-half',
              'transition-colors duration-100',
              'focus-within:bg-secondary',
              isDefaultSelected
                ? 'bg-secondary text-high'
                : cn('text-normal', 'hover:bg-secondary/60')
            )}
          >
            <button
              type="button"
              onClick={() => onSelectDefault?.()}
              className={cn(
                'flex-1 min-w-0 py-half pl-base pr-half text-left',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-brand'
              )}
            >
              <span
                className={cn(
                  'block text-sm truncate',
                  isDefaultSelected && 'font-semibold'
                )}
              >
                {t('modelSelector.default')}
                {defaultSuffix && (
                  <span className="ml-1.5 text-xs font-normal text-brand">
                    {defaultSuffix}
                  </span>
                )}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ModelSelectorPopover({
  isOpen,
  onOpenChange,
  trigger,
  config,
  error,
  selectedProviderId,
  selectedModelId,
  selectedReasoningId,
  searchQuery,
  onSearchChange,
  onModelSelect,
  onReasoningSelect,
  showDefaultOption = false,
  hiveRouterRoleCombo,
  hiveRouterCombos,
  onSelectHiveRouterCombo,
  onSelectDefault,
  scrollRef,
  expandedProviderId = '',
  onExpandedProviderIdChange,
  resolvedTheme = 'light',
}: ModelSelectorPopoverProps) {
  const { t } = useTranslation('common');
  const models = config.models;
  const hasProviders = config.providers.length > 1;
  const defaultSuffix = hiveRouterRoleCombo ? `→ ${hiveRouterRoleCombo}` : null;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const matchingCombos = (hiveRouterCombos ?? []).filter(
    (combo) =>
      !normalizedSearch || combo.toLowerCase().includes(normalizedSearch)
  );
  const hasReasoning = models.some(
    (model) => model.reasoning_options.length > 0
  );
  const popoverWidth = getPopoverWidth(
    hasProviders,
    hasReasoning,
    Boolean(hiveRouterRoleCombo)
  );
  const popoverHeightClass = hasProviders ? 'h-[280px]' : '';

  let showSearch = true;
  let content: ReactElement;

  if (hasProviders) {
    content = (
      <ProviderAccordion
        config={config}
        selectedProviderId={selectedProviderId}
        selectedModelId={selectedModelId}
        selectedReasoningId={selectedReasoningId}
        searchQuery={searchQuery}
        onModelSelect={onModelSelect}
        onReasoningSelect={onReasoningSelect}
        showDefaultOption={showDefaultOption}
        defaultSuffix={defaultSuffix}
        onSelectDefault={onSelectDefault}
        scrollRef={scrollRef}
        expandedProviderId={expandedProviderId}
        onExpandedProviderIdChange={onExpandedProviderIdChange ?? (() => {})}
        resolvedTheme={resolvedTheme}
      />
    );
  } else {
    const sortedModels = sortModelsAlphabetically(models);
    const selectedModel = getSelectedModel(
      models,
      selectedProviderId,
      selectedModelId
    );
    showSearch = models.length > MODEL_LIST_PAGE_SIZE;

    content = (
      <ModelList
        models={sortedModels}
        selectedModelId={selectedModelId}
        searchQuery={searchQuery}
        onSelect={onModelSelect}
        reasoningOptions={selectedModel?.reasoning_options ?? []}
        selectedReasoningId={selectedReasoningId}
        onReasoningSelect={onReasoningSelect}
        justifyEnd
        className="max-h-[233px]"
        showDefaultOption={showDefaultOption}
        defaultSuffix={defaultSuffix}
        onSelectDefault={onSelectDefault}
        scrollRef={scrollRef}
      />
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        data-model-selector-popover
        className={cn(
          'p-0 overflow-hidden flex flex-col',
          popoverWidth,
          popoverHeightClass
        )}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-model-selector-dropdown]')) {
            event.preventDefault();
          }
        }}
      >
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {error && (
            <div className="px-base py-half bg-red-500/10 border-b border-red-500/20">
              <span className="text-sm text-red-600">{error}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pr-base">
            <DropdownMenuLabel>{t('modelSelector.model')}</DropdownMenuLabel>
            {hiveRouterRoleCombo && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
                HiveRouter
              </span>
            )}
          </div>
          {matchingCombos.length > 0 && onSelectHiveRouterCombo && (
            <div className="border-b border-border/70 px-half py-half">
              <div className="px-base pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-low">
                Combo HiveRouter
              </div>
              <div className="flex flex-col">
                {matchingCombos.map((combo) => {
                  const isSelected =
                    selectedModelId === combo && !selectedProviderId;
                  return (
                    <button
                      key={combo}
                      type="button"
                      onClick={() => onSelectHiveRouterCombo(combo)}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-sm px-base py-1 text-left text-sm transition-colors',
                        isSelected
                          ? 'bg-secondary font-semibold text-high'
                          : 'text-normal hover:bg-secondary/60'
                      )}
                    >
                      <span className="truncate">{combo}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="rounded bg-secondary px-1 py-0.5 text-[10px] text-low">
                          combo
                        </span>
                        {isSelected && (
                          <CheckIcon className="size-3.5 text-brand" weight="bold" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            {content}
            {showSearch && (
              <div className="border-t border-border">
                <DropdownMenuSearchInput
                  placeholder={t('common:ui.filterByNameOrId')}
                  value={searchQuery}
                  onValueChange={onSearchChange}
                />
              </div>
            )}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
