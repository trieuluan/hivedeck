import { useMemo, useEffect, useState, useCallback } from 'react';
import Form from '@rjsf/core';
import type { IChangeEvent } from '@rjsf/core';
import { RJSFValidationError } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import { useTranslation } from 'react-i18next';
import { BaseCodingAgent } from 'shared/types';
import { useHiveRouterRouting } from '@/shared/lib/hiveRouterRouting';
import { settingsRjsfTheme } from './rjsf/theme';
import { SettingsSaveBar } from './SettingsComponents';

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
    if (hiveRouter.isRouted) {
      if ('model' in props) {
        ui.model = {
          'ui:placeholder': `Mặc định · Theo HiveRouter (${hiveRouter.defaultCoderCombo})`,
          'ui:help': `Để trống = tự dùng combo ${hiveRouter.defaultCoderCombo} (task) / ${hiveRouter.defaultPlannerCombo} (Thuyền trưởng). Nhập tên combo hoặc model ID để ghi đè.`,
        };
      }
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

  // Pass the env update handler via formContext
  const formContext = useMemo(
    () => ({
      onEnvChange: handleEnvChange,
    }),
    [handleEnvChange]
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
          <div className="flex items-center gap-1.5 font-medium text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
            HiveRouter đang bật cho agent này
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
        widgets={settingsRjsfTheme.widgets}
        templates={settingsRjsfTheme.templates}
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
