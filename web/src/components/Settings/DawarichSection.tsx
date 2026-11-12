import { Button, Field, Form, Input } from "@usememos/ui";
import { useEffect, useState } from "react";
import { useDawarichConnection, useUpdateDawarichConnection } from "@/hooks/useDawarichQueries";
import { showErrorToast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import { SettingList, SettingListItem } from "./SettingList";
import SettingSection from "./SettingSection";

/**
 * The signed-in user's own Dawarich server, for journal places and route images in any memo.
 * The API key goes to this server only: it checks the key against Dawarich before saving and
 * never sends it back.
 */
const DawarichSection = () => {
  const t = useTranslate();
  const { data: connection } = useDawarichConnection();
  const { save, remove } = useUpdateDawarichConnection();
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const configured = Boolean(connection?.configured);

  useEffect(() => {
    if (connection?.url) setUrl(connection.url);
  }, [connection?.url]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    save.mutate(
      { url: url.trim(), apiKey: apiKey.trim() },
      {
        onSuccess: () => setApiKey(""),
        onError: (failure) => setError(failure.message),
      },
    );
  };

  const handleDisconnect = () => {
    remove.mutate(undefined, {
      onSuccess: () => {
        setUrl("");
        setApiKey("");
      },
      onError: (failure) => showErrorToast(failure.message),
    });
  };

  return (
    <SettingSection title={t("setting.dawarich.label")} description={t("setting.dawarich.description")}>
      <SettingList aria-label={t("setting.dawarich.label")}>
        <SettingListItem
          label={
            configured ? t("setting.immich.status-connected", { url: connection?.url ?? "" }) : t("setting.immich.status-not-connected")
          }
        >
          {configured && (
            <Button variant="neutral" onClick={handleDisconnect} loading={remove.isPending}>
              {t("setting.immich.disconnect")}
            </Button>
          )}
        </SettingListItem>
      </SettingList>

      <Form.Root bordered onSubmit={handleSubmit} aria-label={t("setting.dawarich.label")}>
        <Field.Root name="url" invalid={Boolean(error)}>
          <Field.Label>{t("setting.immich.server-url")}</Field.Label>
          <Input
            type="url"
            required
            autoComplete="off"
            placeholder="http://dawarich.local:3000"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError("");
            }}
          />
          <Field.Error match>{error}</Field.Error>
        </Field.Root>
        <Field.Root name="apiKey">
          <Field.Label>{t("setting.immich.api-key")}</Field.Label>
          <Input
            type="password"
            required={!configured}
            autoComplete="off"
            placeholder={configured ? t("setting.immich.api-key-keep") : undefined}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <Field.Description>{t("setting.dawarich.api-key-help")}</Field.Description>
        </Field.Root>
        <Form.Footer>
          <Button variant="primary" type="submit" loading={save.isPending}>
            {configured ? t("common.save") : t("setting.immich.connect")}
          </Button>
        </Form.Footer>
      </Form.Root>
    </SettingSection>
  );
};

export default DawarichSection;
