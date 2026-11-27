import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import Form from '@rjsf/core';
import type { IChangeEvent } from '@rjsf/core';
import {
  RJSFValidationError,
  type ObjectFieldTemplateProps,
  type WidgetProps,
} from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretUpIcon,
  SpinnerIcon,
} from '@phosphor-icons/react';
import { BaseCodingAgent } from 'shared/types';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useExecutorDiscovery } from '@/shared/hooks/useExecutorDiscovery';
import { useHiveRouterRouting } from '@/shared/lib/hiveRouterRouting';
import { nineRouterApi } from '@/shared/lib/api';
import { getAgentName } from '@/shared/components/AgentIcon';
import { cn } from '@/shared/lib/utils';
import { settingsRjsfTheme } from './rjsf/theme';
import { SettingsSaveBar } from './SettingsComponents';

interface ModelOptionItem {
  id: string;
  badge?: string;
  group: 'combos' | 'models' | 'direct';
}

interface ModelComboboxContext {
  modelOptions?: ModelOptionItem[];
  isRouted?: boolean;
  loadingModels?: boolean;
  onRefreshModels?: () => void;
  agentLabel?: string;
}

function ModelComboboxWidget(props: WidgetProps) {
  const {
    id,
    value,
    disabled,
    readonly,
    onChange,
    onBlur,
    placeholder,
    options,
    formContext,
  } = props;
  const ctx = (formContext ?? {}) as ModelComboboxContext;
  const items = useMemo(() => ctx.modelOptions ?? [], [ctx.modelOptions]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const query = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const filtered = useMemo(() => {
    if (!query) return items;
    return items.filter(
      (item) =>
        item.id.toLowerCase().includes(query) ||
        (item.badge && item.badge.toLowerCase().includes(query))
    );
  }, [items, query]);

  const combos = useMemo(
    () => filtered.filter((i) => i.group === 'combos'),
    [filtered]
  );
  const models = useMemo(
    () => filtered.filter((i) => i.group !== 'combos'),
    [filtered]
  );

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const selectValue = (next: string) => {
    onChange(next === '' ? options.emptyValue : next);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="text"
          value={value ?? ''}
          placeholder={placeholder || 'Để trống = mặc định của CLI'}
          disabled={disabled || readonly}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? options.emptyValue : v);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          onBlur={(e) => onBlur?.(id, e.target.value)}
          className={cn(
            'w-full rounded-sm border border-border bg-secondary px-base py-half text-base text-high',
            'placeholder:text-low focus:border-brand focus:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        />
        {ctx.onRefreshModels && (
          <button
            type="button"
            onClick={ctx.onRefreshModels}
            disabled={disabled || readonly || ctx.loadingModels}
            title="Làm mới danh sách model"
            className="shrink-0 rounded-sm border border-border bg-secondary p-1.5 text-low hover:text-high disabled:opacity-50"
          >
            {ctx.loadingModels ? (
              <SpinnerIcon className="size-3.5 animate-spin" />
            ) : (
              <ArrowsClockwiseIcon className="size-3.5" />
            )}
          </button>
        )}
      </div>

      {open && !disabled && !readonly && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-auto rounded-sm border border-border bg-panel shadow-lg">
          {ctx.loadingModels && filtered.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-low">
              <SpinnerIcon className="size-3.5 animate-spin" />
              <span>Đang tải danh sách model...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-low">
              Không tìm thấy model khớp. Bạn vẫn có thể nhập trực tiếp tên
              model.
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {combos.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-low">
                    HiveRouter Combos
                  </div>
                  {combos.map((item) => (
                    <button
                      key={`combo-${item.id}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectValue(item.id);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-secondary/70',
                        value === item.id && 'bg-brand/10 text-brand'
                      )}
                    >
                      <span className="truncate font-mono font-medium text-high">
                        {item.id}
                      </span>
                      {item.badge && (
                        <span className="shrink-0 rounded border border-brand/40 bg-brand/15 px-1.5 py-0.5 text-[10px] text-brand">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {models.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-low">
                    {ctx.isRouted
                      ? 'HiveRouter Models'
                      : `${ctx.agentLabel ?? 'CLI'} Models`}
                  </div>
                  {models.map((item) => (
                    <button
                      key={`model-${item.id}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectValue(item.id);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-secondary/70',
                        value === item.id && 'bg-brand/10 text-brand'
                      )}
                    >
                      <span className="truncate font-mono text-high">
                        {item.id}
                      </span>
                      {item.badge && (
                        <span className="shrink-0 truncate text-[11px] text-low">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="border-t border-border/60 bg-secondary/30 px-3 py-1.5 text-[11px] text-low">
            Để trống để dùng mặc định, hoặc nhập bất kỳ model ID nào.
          </div>
        </div>
      )}
    </div>
  );
}

const ADVANCED_FIELDS = new Set([
  'claude_code_router',
  'oss',
  'model_provider',
  'disable_api_key',
  'base_command_override',
  'additional_params',
  'env',
]);

const ROUTER_CONFLICT_FIELDS = new Set([
  'claude_code_router',
  'oss',
  'model_provider',
]);

function AgentObjectFieldTemplate(
  props: ObjectFieldTemplateProps & { isRouted?: boolean }
) {
  const { properties, isRouted } = props;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const coreProps = properties.filter((p) => !ADVANCED_FIELDS.has(p.name));
  const advancedProps = properties.filter((p) => ADVANCED_FIELDS.has(p.name));
  const hasConflictField =
    Boolean(isRouted) &&
    advancedProps.some((p) => ROUTER_CONFLICT_FIELDS.has(p.name));

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border">
        {coreProps.map((element) => (
          <div key={element.name}>{element.content}</div>
        ))}
      </div>

      {advancedProps.length > 0 && (
        <div className="overflow-hidden rounded-sm border border-border bg-secondary/25">
          <button
            type="button"
            onClick={() => setAdvancedOpen((prev) => !prev)}
            aria-expanded={advancedOpen}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-high">
                <span>Nâng cao & Tương thích</span>
                {hasConflictField && (
                  <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                    Tránh xung đột HiveRouter
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-low">
                {isRouted
                  ? 'Gồm tuỳ chọn router/provider ngoài, lệnh chạy gốc và biến môi trường (không cần chỉnh khi đã dùng HiveRouter).'
                  : 'Gồm tuỳ chọn nâng cao, lệnh chạy gốc và biến môi trường.'}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-low">
              {advancedOpen ? (
                <>
                  Thu gọn
                  <CaretUpIcon className="size-3.5" weight="bold" />
                </>
              ) : (
                <>
                  Mở
                  <CaretDownIcon className="size-3.5" weight="bold" />
                </>
              )}
            </span>
          </button>

          {advancedOpen && (
            <div className="divide-y divide-border border-t border-border px-3">
              {advancedProps.map((element) => (
                <div key={element.name}>{element.content}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ExecutorConfigFormProps {
  executor: BaseCodingAgent;
  value: unknown;
  onChange?: (formData: unknown) => void;
  onSave?: (formData: unknown) => Promise<void>;
  onDiscard?: () => void;
  disabled?: boolean;
  saving?: boolean;
  isDirty?: boolean;
}

import schemas from 'virtual:executor-schemas';

export function ExecutorConfigForm({
  executor,
  value,
  onChange,
  onSave,
  onDiscard,
  disabled = false,
  saving = false,
  isDirty = false,
}: ExecutorConfigFormProps) {
  const { t } = useTranslation('settings');
  const [formData, setFormData] = useState<unknown>(value || {});
  const [validationErrors, setValidationErrors] = useState<
    RJSFValidationError[]
  >([]);

  const schema = useMemo(() => {
    return schemas[executor];
  }, [executor]);

  const hiveRouter = useHiveRouterRouting(executor);
  const appNavigation = useAppNavigation();
  const [discoveryNonce, setDiscoveryNonce] = useState(0);
  const discovery = useExecutorDiscovery(
    hiveRouter.isRouted ? null : executor,
    discoveryNonce ? { sessionId: `settings-${discoveryNonce}` } : undefined
  );
  const {
    data: routerSuggestions,
    isFetching: suggestionsFetching,
    refetch: refetchSuggestions,
  } = useQuery({
    queryKey: ['router', 'suggestions', 'for-model-combobox'],
    queryFn: nineRouterApi.getSuggestions,
    enabled: hiveRouter.isRouted,
    staleTime: 30_000,
  });

  const modelOptions = useMemo<ModelOptionItem[]>(() => {
    if (hiveRouter.isRouted) {
      const items: ModelOptionItem[] = [];
      const seenModels = new Set<string>();
      for (const c of hiveRouter.combos) {
        items.push({ id: c, badge: 'Role Combo', group: 'combos' });
      }
      for (const role of routerSuggestions?.roles ?? []) {
        for (const id of role.existing_models ?? []) {
          if (!seenModels.has(id)) {
            seenModels.add(id);
            items.push({ id, group: 'models' });
          }
        }
        for (const m of role.models ?? []) {
          if (!seenModels.has(m.id)) {
            seenModels.add(m.id);
            items.push({ id: m.id, badge: m.provider, group: 'models' });
          }
        }
      }
      return items;
    }
    return (discovery.options?.model_selector.models ?? []).map((m) => ({
      id: m.id,
      badge: m.name && m.name !== m.id ? m.name : undefined,
      group: 'direct',
    }));
  }, [
    hiveRouter.isRouted,
    hiveRouter.combos,
    routerSuggestions,
    discovery.options?.model_selector.models,
  ]);

  const customWidgets = useMemo(
    () => ({
      ...settingsRjsfTheme.widgets,
      ModelComboboxWidget,
    }),
    []
  );

  const customTemplates = useMemo(
    () => ({
      ...settingsRjsfTheme.templates,
      ObjectFieldTemplate: (objProps: ObjectFieldTemplateProps) => (
        <AgentObjectFieldTemplate
          {...objProps}
          isRouted={hiveRouter.isRouted}
        />
      ),
    }),
    [hiveRouter.isRouted]
  );

  // Custom handler for env field updates
  const handleEnvChange = useCallback(
    (envData: Record<string, string> | undefined) => {
      const newFormData = {
        ...(formData as Record<string, unknown>),
        env: envData,
      };
      setFormData(newFormData);
      if (onChange) {
        onChange(newFormData);
      }
    },
    [formData, onChange]
  );

  const uiSchema = useMemo(() => {
    const props =
      (schema as { properties?: Record<string, unknown> } | undefined)
        ?.properties ?? {};
    const ui: Record<string, Record<string, unknown>> = {
      env: {
        'ui:field': 'KeyValueField',
      },
    };
    if ('model' in props) {
      ui.model = hiveRouter.isRouted
        ? {
            'ui:widget': 'ModelComboboxWidget',
            'ui:placeholder': `Mặc định · Theo HiveRouter (${hiveRouter.defaultCoderCombo})`,
            'ui:help': `Để trống = tự dùng combo ${hiveRouter.defaultCoderCombo} (task) / ${hiveRouter.defaultPlannerCombo} (Thuyền trưởng). Nhập tên combo hoặc model ID để ghi đè.`,
          }
        : {
            'ui:widget': 'ModelComboboxWidget',
          };
    }
    if (hiveRouter.isRouted) {
      if ('claude_code_router' in props) {
        ui.claude_code_router = {
          'ui:help':
            'Chạy công cụ ccr bên ngoài — không cần bật khi đang dùng HiveRouter.',
        };
      }
      if ('oss' in props) {
        ui.oss = {
          'ui:help':
            'Chạy model local (Ollama/LMStudio) — có thể xung đột khi HiveRouter đang bật.',
        };
      }
      if ('model_provider' in props) {
        ui.model_provider = {
          'ui:help':
            'Đổi provider ngoài — có thể xung đột đường dẫn khi HiveRouter đang bật.',
        };
      }
      if ('base_command_override' in props) {
        ui.base_command_override = {
          'ui:help':
            'Ghi đè lệnh chạy gốc (nếu đặt có thể bỏ qua cấu hình mặc định).',
        };
      }
    }
    return ui;
  }, [
    schema,
    hiveRouter.isRouted,
    hiveRouter.defaultCoderCombo,
    hiveRouter.defaultPlannerCombo,
  ]);

  // Pass the env update handler and model combobox options via formContext
  const formContext = useMemo(
    () => ({
      onEnvChange: handleEnvChange,
      modelOptions,
      isRouted: hiveRouter.isRouted,
      loadingModels: hiveRouter.isRouted
        ? suggestionsFetching
        : Boolean(discovery.options?.loading_models),
      onRefreshModels: hiveRouter.isRouted
        ? () => void refetchSuggestions()
        : () => setDiscoveryNonce((n) => n + 1),
      agentLabel: getAgentName(executor),
    }),
    [
      handleEnvChange,
      modelOptions,
      hiveRouter.isRouted,
      suggestionsFetching,
      discovery.options?.loading_models,
      refetchSuggestions,
      executor,
    ]
  );

  useEffect(() => {
    setFormData(value || {});
    setValidationErrors([]);
  }, [value, executor]);

  const handleChange = (event: IChangeEvent<unknown>) => {
    const newFormData = event.formData;
    setFormData(newFormData);
    if (onChange) {
      onChange(newFormData);
    }
  };

  const handleSave = async () => {
    if (onSave) {
      await onSave(formData);
    }
  };

  const handleError = (errors: RJSFValidationError[]) => {
    setValidationErrors(errors);
  };

  if (!schema) {
    return (
      <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error">
        {t('settings.agents.errors.schemaNotFound', { executor })}
      </div>
    );
  }

  const hasValidationErrors = validationErrors.length > 0;
  const propsMap =
    (schema as { properties?: Record<string, unknown> } | undefined)
      ?.properties ?? {};
  const hasModelField = 'model' in propsMap;
  const currentModelValue =
    typeof (formData as Record<string, unknown> | null)?.model === 'string'
      ? ((formData as Record<string, unknown>).model as string)
      : '';

  const setModelField = (nextModel: string | undefined) => {
    const next = { ...(formData as Record<string, unknown>) };
    if (nextModel) {
      next.model = nextModel;
    } else {
      delete next.model;
    }
    setFormData(next);
    if (onChange) {
      onChange(next);
    }
  };

  return (
    <div className="space-y-4">
      {hiveRouter.isRouted ? (
        <div className="rounded-sm border border-emerald-500/35 bg-emerald-500/10 px-3 py-2.5 text-xs text-normal">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-medium text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
              HiveRouter đang bật cho agent này
            </div>
            <button
              type="button"
              onClick={() => appNavigation.goToRouter()}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25"
            >
              Mở Router
              <ArrowSquareOutIcon className="size-3" aria-hidden />
            </button>
          </div>
          <p className="mt-1 text-low">
            Nếu để trống <strong>Model</strong>, lượt chạy tự dùng combo{' '}
            <code className="rounded bg-secondary px-1 py-0.5 text-high">
              {hiveRouter.defaultCoderCombo}
            </code>{' '}
            (workspace/task) hoặc{' '}
            <code className="rounded bg-secondary px-1 py-0.5 text-high">
              {hiveRouter.defaultPlannerCombo}
            </code>{' '}
            (Thuyền trưởng).
          </p>
          {hasModelField && hiveRouter.combos.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-low">Chọn nhanh Model:</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setModelField(undefined)}
                className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                  !currentModelValue
                    ? 'border-brand/60 bg-brand/15 font-medium text-brand'
                    : 'border-border bg-secondary/60 text-normal hover:bg-secondary'
                }`}
              >
                Mặc định (theo vai trò)
              </button>
              {hiveRouter.combos.map((combo) => (
                <button
                  key={combo}
                  type="button"
                  disabled={disabled}
                  onClick={() => setModelField(combo)}
                  className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                    currentModelValue === combo
                      ? 'border-brand/60 bg-brand/15 font-medium text-brand'
                      : 'border-border bg-secondary/60 text-normal hover:bg-secondary'
                  }`}
                >
                  {combo}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-sm border border-border bg-secondary/40 px-3 py-2 text-xs text-low">
          <span className="font-medium text-normal">
            ○ Chạy trực tiếp qua CLI gốc:
          </span>{' '}
          {hiveRouter.supportsHiveRouter
            ? 'HiveRouter đang tắt ở trang Router → Định tuyến. Agent dùng trực tiếp model và key của CLI.'
            : 'Agent này không đi qua HiveRouter. Model và key dùng trực tiếp từ cấu hình của CLI.'}
        </div>
      )}

      <Form
        schema={schema}
        uiSchema={uiSchema}
        formData={formData}
        formContext={formContext}
        onChange={handleChange}
        onError={handleError}
        validator={validator}
        disabled={disabled}
        liveValidate
        showErrorList={false}
        widgets={customWidgets}
        templates={customTemplates}
        fields={settingsRjsfTheme.fields}
      >
        {/* No submit button - SettingsSaveBar handles saving */}
        <></>
      </Form>

      {hasValidationErrors && (
        <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error">
          <ul className="list-disc list-inside space-y-1">
            {validationErrors.map((error, index) => (
              <li key={index}>
                {error.property}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {onSave && (
        <SettingsSaveBar
          show={isDirty}
          saving={saving}
          saveDisabled={hasValidationErrors}
          unsavedMessage={t('settings.agents.save.unsavedChanges')}
          onSave={handleSave}
          onDiscard={onDiscard}
        />
      )}
    </div>
  );
}
