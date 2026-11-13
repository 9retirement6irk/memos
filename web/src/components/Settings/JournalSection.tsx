import { Button, Checkbox, Field, Form, Input, Select, Switch } from "@usememos/ui";
import { PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ActivityIconView } from "@/components/Journal/ActivityIconView";
import { useAuth } from "@/contexts/AuthContext";
import { useJournalReminder, useJournalSettings, useSaveJournalSettings, useUpdateJournalReminder } from "@/hooks/useJournalQueries";
import { useSpaces } from "@/hooks/useSpaceQueries";
import { normalizePrefix, tagSegment } from "@/lib/journal/entry";
import { IMPACTS } from "@/lib/journal/mood";
import { listNotifiers, sendTestReminder } from "@/lib/journal/reminder";
import type { JournalSettings } from "@/lib/journal/settings";
import { showErrorToast, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import { SettingList, SettingListItem } from "./SettingList";
import SettingSection from "./SettingSection";

const NO_SPACE = "none";

type ToggleKey = "addLocation" | "addWeather" | "useMomentDate" | "addRouteImage" | "showPrompt" | "showSuggestions" | "dateHeading";
const TOGGLES: ToggleKey[] = [
  "addLocation",
  "addWeather",
  "useMomentDate",
  "addRouteImage",
  "showPrompt",
  "showSuggestions",
  "dateHeading",
];

/** A text field that saves when it loses focus or on Enter, not on every key. */
const SavedInput = ({
  value,
  onSave,
  ...props
}: { value: string; onSave: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onSave(draft);
  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && commit()}
    />
  );
};

/** One item per line with a remove button, and a field to add one. */
const EditableList = ({
  items,
  label,
  addLabel,
  onChange,
  render,
}: {
  items: string[];
  label: string;
  addLabel: string;
  onChange: (items: string[]) => void;
  render?: (item: string, index: number) => React.ReactNode;
}) => {
  const t = useTranslate();
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={label} className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className="mu-label flex items-center gap-1.5 rounded-mu-md border border-mu-line bg-mu-surface py-1 pr-1 pl-2.5"
          >
            {render ? render(item, index) : item}
            <Button
              variant="ghost"
              size="xs"
              icon={<XIcon />}
              aria-label={t("journal.settings.remove", { name: item })}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          aria-label={addLabel}
          placeholder={addLabel}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="neutral" icon={<PlusIcon />} onClick={add} disabled={!draft.trim()}>
          {t("common.add")}
        </Button>
      </div>
    </div>
  );
};

const DAYS = [0, 1, 2, 3, 4, 5, 6];

/** The streak reminder, sent by the user's own Home Assistant. */
const ReminderForm = ({ space }: { space: string }) => {
  const t = useTranslate();
  const { data: reminder } = useJournalReminder();
  const { save, remove } = useUpdateJournalReminder();
  const configured = Boolean(reminder?.configured);
  const defaultOpenUrl = `${window.location.origin}/${space || ""}`;
  const [form, setForm] = useState({
    enabled: true,
    url: "",
    token: "",
    notifier: "",
    time: "20:30",
    days: DAYS,
    openUrl: defaultOpenUrl,
    onlyIfNotWritten: true,
    streakWarning: true,
  });
  const [notifiers, setNotifiers] = useState<string[]>([]);
  const [loadingNotifiers, setLoadingNotifiers] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!reminder?.configured) return;
    setForm((current) => ({ ...current, ...reminder, token: "" }));
    setNotifiers((current) => (current.includes(reminder.notifier) ? current : [reminder.notifier, ...current]));
  }, [reminder]);

  const update = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError("");
  };

  const loadNotifiers = async () => {
    setLoadingNotifiers(true);
    setError("");
    try {
      const list = await listNotifiers(form.url.trim(), form.token.trim());
      setNotifiers(list);
      if (!list.includes(form.notifier)) update({ notifier: list[0] ?? "" });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoadingNotifiers(false);
    }
  };

  const dayNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(navigator.language, { weekday: "short" });
    // 2026-11-01 is a Sunday.
    return DAYS.map((day) => format.format(new Date(2026, 10, 1 + day)));
  }, []);

  return (
    <SettingGroup title={t("journal.settings.reminder-title")} description={t("journal.settings.reminder-description")} showSeparator>
      <Form.Root
        bordered
        aria-label={t("journal.settings.reminder-title")}
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            { ...form, url: form.url.trim(), token: form.token.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
            {
              onSuccess: () => {
                update({ token: "" });
                toast.add({ title: t("journal.settings.reminder-saved"), type: "success" });
              },
              onError: (failure) => setError(failure.message),
            },
          );
        }}
      >
        <Field.Root name="ha-enabled">
          <div className="flex items-center justify-between gap-3">
            <Field.Label>{t("journal.settings.reminder-enabled")}</Field.Label>
            <Switch
              aria-label={t("journal.settings.reminder-enabled")}
              checked={form.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
            />
          </div>
        </Field.Root>
        <Field.Root name="ha-url" invalid={Boolean(error)}>
          <Field.Label>{t("journal.settings.ha-url")}</Field.Label>
          <Input
            type="url"
            required
            autoComplete="off"
            placeholder="http://192.168.1.20:8123"
            value={form.url}
            onChange={(event) => update({ url: event.target.value })}
          />
          <Field.Error match>{error}</Field.Error>
        </Field.Root>
        <Field.Root name="ha-token">
          <Field.Label>{t("journal.settings.ha-token")}</Field.Label>
          <Input
            type="password"
            required={!configured}
            autoComplete="off"
            placeholder={configured ? t("setting.immich.api-key-keep") : undefined}
            value={form.token}
            onChange={(event) => update({ token: event.target.value })}
          />
          <Field.Description>{t("journal.settings.ha-token-help")}</Field.Description>
        </Field.Root>
        <Field.Root name="ha-notifier">
          <Field.Label>{t("journal.settings.notifier")}</Field.Label>
          <div className="flex gap-2">
            <Select.Root
              value={form.notifier || null}
              items={notifiers.map((value) => ({ value, label: value }))}
              onValueChange={(value) => value && update({ notifier: value })}
            >
              <Select.Trigger className="min-w-0 flex-1" aria-label={t("journal.settings.notifier")}>
                <Select.Value placeholder={t("journal.settings.notifier-load")} />
              </Select.Trigger>
              <Select.Popup>
                {notifiers.map((value) => (
                  <Select.Item key={value} value={value}>
                    {value}
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Root>
            <Button
              variant="neutral"
              aria-label={t("journal.settings.notifier-load")}
              loading={loadingNotifiers}
              disabled={!form.url.trim() || (!form.token.trim() && !configured)}
              icon={<RefreshCwIcon />}
              onClick={loadNotifiers}
            />
          </div>
          <Field.Description>{t("journal.settings.notifier-help")}</Field.Description>
        </Field.Root>
        <Field.Root name="ha-time">
          <Field.Label>{t("journal.settings.reminder-time")}</Field.Label>
          <Input type="time" required value={form.time} onChange={(event) => update({ time: event.target.value })} className="w-fit" />
        </Field.Root>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mu-label mb-1.5">{t("journal.settings.reminder-days")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((day) => {
              const on = form.days.includes(day);
              return (
                <Button
                  key={day}
                  variant={on ? "primary" : "neutral"}
                  size="sm"
                  aria-pressed={on}
                  onClick={() => update({ days: on ? form.days.filter((d) => d !== day) : [...form.days, day].sort() })}
                >
                  {dayNames[day]}
                </Button>
              );
            })}
          </div>
        </fieldset>
        <Field.Root name="ha-open">
          <Field.Label>{t("journal.settings.open-url")}</Field.Label>
          <Input type="url" required value={form.openUrl} onChange={(event) => update({ openUrl: event.target.value })} />
          <Field.Description>{t("journal.settings.open-url-help")}</Field.Description>
        </Field.Root>
        <Field.Root name="ha-only">
          <div className="flex items-center justify-between gap-3">
            <Field.Label>{t("journal.settings.only-if-not-written")}</Field.Label>
            <Switch
              aria-label={t("journal.settings.only-if-not-written")}
              checked={form.onlyIfNotWritten}
              onCheckedChange={(onlyIfNotWritten) => update({ onlyIfNotWritten })}
            />
          </div>
        </Field.Root>
        <Field.Root name="ha-streak">
          <div className="flex items-center justify-between gap-3">
            <Field.Label>{t("journal.settings.streak-warning")}</Field.Label>
            <Switch
              aria-label={t("journal.settings.streak-warning")}
              checked={form.streakWarning}
              onCheckedChange={(streakWarning) => update({ streakWarning })}
            />
          </div>
        </Field.Root>
        <Form.Footer>
          {configured && (
            <>
              <Button
                variant="neutral"
                loading={remove.isPending}
                onClick={() => remove.mutate(undefined, { onError: (failure) => showErrorToast(failure.message) })}
              >
                {t("common.delete")}
              </Button>
              <Button
                variant="neutral"
                loading={testing}
                onClick={async () => {
                  setTesting(true);
                  try {
                    await sendTestReminder();
                    toast.add({ title: t("journal.settings.test-sent"), type: "success" });
                  } catch (failure) {
                    showErrorToast((failure as Error).message);
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                {t("journal.settings.test")}
              </Button>
            </>
          )}
          <Button variant="primary" type="submit" loading={save.isPending} disabled={!form.notifier || form.days.length === 0}>
            {t("common.save")}
          </Button>
        </Form.Footer>
      </Form.Root>
    </SettingGroup>
  );
};

/**
 * How the user's journal works: which Space holds it, what a new entry fills in, the tags it
 * writes, the activities and goals to pick from, and the servers it reads places and routes
 * from and reminds through. Entries never depend on these settings.
 */
const JournalSection = () => {
  const t = useTranslate();
  const { currentUser } = useAuth();
  const { data: spaces = [] } = useSpaces(currentUser?.name);
  const { settings, isLoaded } = useJournalSettings();
  const saveSettings = useSaveJournalSettings();

  const save = (patch: Partial<JournalSettings>) => {
    saveSettings.mutate({ ...settings, ...patch }, { onError: (failure) => showErrorToast(failure.message) });
  };

  const spaceItems = useMemo(
    () => [
      { value: NO_SPACE, label: t("journal.settings.no-space") },
      ...spaces.map((space) => ({ value: space.name, label: space.title || space.name })),
    ],
    [spaces, t],
  );

  return (
    <SettingSection title={t("setting.journal.label")} description={t("journal.settings.description")}>
      <SettingGroup title={t("journal.settings.space-title")} description={t("journal.settings.space-description")}>
        <SettingList>
          <SettingListItem label={t("journal.settings.space")}>
            <Select.Root
              value={settings.space || NO_SPACE}
              items={spaceItems}
              disabled={!isLoaded}
              onValueChange={(value) => value && save({ space: value === NO_SPACE ? "" : value })}
            >
              <Select.Trigger className="min-w-40" aria-label={t("journal.settings.space")}>
                <Select.Value />
              </Select.Trigger>
              <Select.Popup>
                {spaceItems.map((item) => (
                  <Select.Item key={item.value} value={item.value}>
                    {item.label}
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Root>
          </SettingListItem>
          <SettingListItem
            label={t("journal.settings.open-in-journal-mode")}
            description={t("journal.settings.open-in-journal-mode-description")}
          >
            <Switch
              aria-label={t("journal.settings.open-in-journal-mode")}
              checked={settings.openInJournalMode}
              disabled={!isLoaded || !settings.space}
              onCheckedChange={(openInJournalMode) => save({ openInJournalMode })}
            />
          </SettingListItem>
        </SettingList>
      </SettingGroup>

      <SettingGroup title={t("journal.settings.entries-title")} description={t("journal.settings.entries-description")} showSeparator>
        <SettingList>
          {TOGGLES.map((key) => (
            <SettingListItem
              key={key}
              label={t(`journal.settings.${key}` as never)}
              description={t(`journal.settings.${key}-description` as never)}
            >
              <Switch
                aria-label={t(`journal.settings.${key}` as never)}
                checked={settings[key]}
                disabled={!isLoaded}
                onCheckedChange={(on) => save({ [key]: on })}
              />
            </SettingListItem>
          ))}
          <SettingListItem label={t("journal.settings.default-city")} description={t("journal.settings.default-city-description")}>
            <SavedInput
              aria-label={t("journal.settings.default-city")}
              placeholder="Boston, MA"
              value={settings.defaultCity}
              disabled={!isLoaded}
              onSave={(defaultCity) => save({ defaultCity: defaultCity.trim() })}
              className="w-48"
            />
          </SettingListItem>
          <SettingListItem label={t("journal.settings.unit")}>
            <Select.Root
              value={settings.temperatureUnit}
              items={[
                { value: "fahrenheit", label: "°F" },
                { value: "celsius", label: "°C" },
              ]}
              onValueChange={(value) => value && save({ temperatureUnit: value as JournalSettings["temperatureUnit"] })}
            >
              <Select.Trigger className="min-w-20" aria-label={t("journal.settings.unit")}>
                <Select.Value />
              </Select.Trigger>
              <Select.Popup>
                <Select.Item value="fahrenheit">°F</Select.Item>
                <Select.Item value="celsius">°C</Select.Item>
              </Select.Popup>
            </Select.Root>
          </SettingListItem>
        </SettingList>
      </SettingGroup>

      <SettingGroup title={t("journal.settings.tags-title")} description={t("journal.settings.tags-description")} showSeparator>
        <SettingList>
          <SettingListItem label={t("journal.settings.mood-prefix")} description={`#${normalizePrefix(settings.moodTagPrefix)}pleasant`}>
            <SavedInput
              aria-label={t("journal.settings.mood-prefix")}
              value={settings.moodTagPrefix}
              onSave={(value) => save({ moodTagPrefix: normalizePrefix(value) })}
              className="w-36"
            />
          </SettingListItem>
          <SettingListItem
            label={t("journal.settings.feeling-prefix")}
            description={`#${normalizePrefix(settings.feelingTagPrefix)}grateful`}
          >
            <SavedInput
              aria-label={t("journal.settings.feeling-prefix")}
              value={settings.feelingTagPrefix}
              onSave={(value) => save({ feelingTagPrefix: normalizePrefix(value) })}
              className="w-36"
            />
          </SettingListItem>
          <SettingListItem label={t("journal.settings.impact-prefix")} description={`#${normalizePrefix(settings.impactTagPrefix)}work`}>
            <SavedInput
              aria-label={t("journal.settings.impact-prefix")}
              value={settings.impactTagPrefix}
              onSave={(value) => save({ impactTagPrefix: normalizePrefix(value) })}
              className="w-36"
            />
          </SettingListItem>
          <SettingListItem
            label={t("journal.settings.activity-prefix")}
            description={`#${normalizePrefix(settings.activityTagPrefix)}work`}
          >
            <SavedInput
              aria-label={t("journal.settings.activity-prefix")}
              value={settings.activityTagPrefix}
              onSave={(value) => save({ activityTagPrefix: normalizePrefix(value) })}
              className="w-36"
            />
          </SettingListItem>
        </SettingList>
      </SettingGroup>

      <SettingGroup title={t("journal.settings.impacts-title")} description={t("journal.settings.impacts-description")} showSeparator>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3" data-journal-impacts="">
          {IMPACTS.map((id) => (
            <label key={id} className="mu-body flex min-h-8 cursor-pointer items-center gap-2.5">
              <Checkbox
                checked={!settings.hiddenImpacts.includes(id)}
                onCheckedChange={(offered) =>
                  save({
                    hiddenImpacts: offered ? settings.hiddenImpacts.filter((hidden) => hidden !== id) : [...settings.hiddenImpacts, id],
                  })
                }
              />
              {t(`journal.impact.${id}` as never)}
            </label>
          ))}
        </div>
      </SettingGroup>

      <SettingGroup title={t("journal.settings.activities-title")} description={t("journal.settings.activities-description")} showSeparator>
        <EditableList
          items={settings.activities.map((activity) => activity.label)}
          label={t("journal.settings.activities-title")}
          addLabel={t("journal.settings.add-activity")}
          render={(label, index) => (
            <span className="flex items-center gap-1.5">
              <ActivityIconView icon={settings.activities[index]?.icon ?? "star"} className="mu-icon-sm" />
              {label}
              <span className={cn("mu-caption text-mu-ink-muted")}>
                #{normalizePrefix(settings.activityTagPrefix)}
                {settings.activities[index]?.id}
              </span>
            </span>
          )}
          onChange={(labels) =>
            save({
              activities: labels
                .map(
                  (label) =>
                    settings.activities.find((activity) => activity.label === label) ?? {
                      id: tagSegment(label),
                      label,
                      icon: "star" as const,
                    },
                )
                .filter((activity) => activity.id),
            })
          }
        />
      </SettingGroup>

      <SettingGroup title={t("journal.settings.goals-title")} description={t("journal.settings.goals-description")} showSeparator>
        <EditableList
          items={settings.goals}
          label={t("journal.settings.goals-title")}
          addLabel={t("journal.settings.add-goal")}
          onChange={(goals) => save({ goals })}
        />
      </SettingGroup>

      <ReminderForm space={settings.space} />
    </SettingSection>
  );
};

export default JournalSection;
