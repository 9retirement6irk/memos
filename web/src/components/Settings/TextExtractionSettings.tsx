import { Button, Field, Input, Select } from "@usememos/ui";
import { useEffect, useMemo, useState } from "react";
import { useTextExtractionSettings, useUpdateTextExtraction } from "@/hooks/useTextExtractionQueries";
import { CLAUDE_PROVIDER, DEFAULT_CLAUDE_MODEL } from "@/lib/textExtraction";
import { showErrorToast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";

/** The model a Gemini provider uses for text extraction when none is set. */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const OFF = "__off__";

export interface ExtractionProvider {
  id: string;
  title: string;
}

/**
 * Which AI reads text out of images, drawings and scanned PDFs: Claude, once it is connected, or
 * one of the Gemini providers. The choice lives in a settings row of the fork's own
 * (server/textextraction), which stock Memos ignores. Claude itself is connected in the provider
 * list above (AISection, useClaudeProvider).
 */
const TextExtractionSettings = ({ geminiProviders }: { geminiProviders: ExtractionProvider[] }) => {
  const t = useTranslate();
  const { data: settings } = useTextExtractionSettings();
  const { saveChoice } = useUpdateTextExtraction();
  const configured = Boolean(settings?.claude.configured);

  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");

  useEffect(() => {
    if (!settings) return;
    setProviderId(settings.providerId);
    setModel(settings.model);
  }, [settings]);

  const choiceChanged = Boolean(settings) && (providerId !== settings?.providerId || model.trim() !== settings?.model);

  const providerOptions = useMemo(() => {
    const options = [
      { value: OFF, label: t("setting.text-extraction.off") },
      { value: CLAUDE_PROVIDER, label: "Claude", disabled: !configured },
      ...geminiProviders.map((provider) => ({ value: provider.id, label: provider.title || provider.id, disabled: false })),
    ];
    // A provider deleted since it was chosen still shows, so the choice can be changed away from it.
    if (providerId && providerId !== CLAUDE_PROVIDER && !geminiProviders.some((provider) => provider.id === providerId)) {
      options.push({ value: providerId, label: providerId, disabled: true });
    }
    return options;
  }, [configured, geminiProviders, providerId, t]);

  const defaultModel = providerId === CLAUDE_PROVIDER ? DEFAULT_CLAUDE_MODEL : providerId ? DEFAULT_GEMINI_MODEL : "";

  const handleSaveChoice = () => {
    saveChoice.mutate({ providerId, model: model.trim() }, { onError: (failure) => showErrorToast(failure.message) });
  };

  if (!settings) return null;

  return (
    <>
      <SettingGroup
        title={t("setting.text-extraction.title")}
        description={t("setting.text-extraction.description")}
        showSeparator
        actions={
          <Button variant="primary" disabled={!choiceChanged} loading={saveChoice.isPending} onClick={handleSaveChoice}>
            {t("common.save")}
          </Button>
        }
      >
        <div className="grid max-w-3xl grid-cols-1 gap-3">
          <Field.Root>
            <Field.Label>{t("setting.ai.transcription-provider")}</Field.Label>
            <Select.Root
              value={providerId || OFF}
              items={providerOptions}
              onValueChange={(value) => setProviderId(!value || value === OFF ? "" : String(value))}
            >
              <Select.Trigger className="w-full">
                <Select.Value />
              </Select.Trigger>
              <Select.Popup>
                {providerOptions.map((option) => (
                  <Select.Item key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Root>
            <Field.Description>{t("setting.text-extraction.provider-help")}</Field.Description>
          </Field.Root>
          <Field.Root>
            <Field.Label>{t("setting.ai.transcription-model")}</Field.Label>
            <Input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={defaultModel}
              disabled={!providerId}
              maxLength={256}
            />
            {defaultModel && <Field.Description>{t("setting.text-extraction.model-help", { model: defaultModel })}</Field.Description>}
          </Field.Root>
        </div>
      </SettingGroup>
    </>
  );
};

export default TextExtractionSettings;
