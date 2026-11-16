import { Button, Field, Input, Select } from "@usememos/ui";
import { useEffect, useMemo, useState } from "react";
import { useTextExtractionSettings, useUpdateTextExtraction } from "@/hooks/useTextExtractionQueries";
import { CLAUDE_PROVIDER, DEFAULT_CLAUDE_MODEL } from "@/lib/textExtraction";
import { showErrorToast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import { SettingList, SettingListItem } from "./SettingList";

/** The model a Gemini provider uses for text extraction when none is set. */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const OFF = "__off__";

export interface ExtractionProvider {
  id: string;
  title: string;
}

/**
 * Claude, and which AI reads text out of images, drawings and scanned PDFs. Both live in a
 * settings row of the fork's own (server/textextraction), which stock Memos ignores, not in the
 * AI provider list above. The Claude key goes to this server only: it checks the key with
 * Anthropic before saving and never sends it back.
 */
const TextExtractionSettings = ({ geminiProviders }: { geminiProviders: ExtractionProvider[] }) => {
  const t = useTranslate();
  const { data: settings } = useTextExtractionSettings();
  const { saveClaude, removeClaude, saveChoice } = useUpdateTextExtraction();
  const configured = Boolean(settings?.claude.configured);

  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [claudeError, setClaudeError] = useState("");
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");

  useEffect(() => {
    if (!settings) return;
    setEndpoint(settings.claude.configured ? settings.claude.endpoint : "");
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

  const handleSaveClaude = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setClaudeError("");
    saveClaude.mutate(
      { endpoint: endpoint.trim(), apiKey: apiKey.trim() },
      { onSuccess: () => setApiKey(""), onError: (failure) => setClaudeError(failure.message) },
    );
  };

  const handleRemoveClaude = () => {
    removeClaude.mutate(undefined, {
      onSuccess: () => setApiKey(""),
      onError: (failure) => showErrorToast(failure.message),
    });
  };

  const handleSaveChoice = () => {
    saveChoice.mutate({ providerId, model: model.trim() }, { onError: (failure) => showErrorToast(failure.message) });
  };

  if (!settings) return null;

  return (
    <>
      <SettingGroup
        title={t("setting.text-extraction.claude-title")}
        description={t("setting.text-extraction.claude-description")}
        showSeparator
      >
        <SettingList aria-label={t("setting.text-extraction.claude-title")}>
          <SettingListItem
            label={
              configured
                ? t("setting.immich.status-connected", { url: settings.claude.endpoint })
                : t("setting.immich.status-not-connected")
            }
          >
            {configured && (
              <Button variant="neutral" onClick={handleRemoveClaude} loading={removeClaude.isPending}>
                {t("setting.immich.disconnect")}
              </Button>
            )}
          </SettingListItem>
        </SettingList>

        <form
          className="grid max-w-3xl gap-4 rounded-mu-lg border border-mu-line p-4"
          onSubmit={handleSaveClaude}
          aria-label={t("setting.text-extraction.claude-title")}
        >
          <Field.Root name="apiKey" invalid={Boolean(claudeError)}>
            <Field.Label>{t("setting.ai.api-key")}</Field.Label>
            <Input
              type="password"
              required={!configured}
              autoComplete="off"
              placeholder={configured ? t("setting.immich.api-key-keep") : undefined}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setClaudeError("");
              }}
            />
            {configured && settings.claude.apiKeyHint && (
              <Field.Description>{t("setting.ai.current-key", { key: settings.claude.apiKeyHint })}</Field.Description>
            )}
            <Field.Error match>{claudeError}</Field.Error>
          </Field.Root>
          <Field.Root name="endpoint">
            <Field.Label>{t("setting.ai.endpoint")}</Field.Label>
            <Input
              type="url"
              autoComplete="off"
              placeholder="https://api.anthropic.com"
              value={endpoint}
              onChange={(event) => {
                setEndpoint(event.target.value);
                setClaudeError("");
              }}
            />
            <Field.Description>{t("setting.ai.endpoint-hint")}</Field.Description>
          </Field.Root>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="primary" type="submit" loading={saveClaude.isPending}>
              {configured ? t("common.save") : t("setting.immich.connect")}
            </Button>
          </div>
        </form>
      </SettingGroup>

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
