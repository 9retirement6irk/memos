import { useCallback, useEffect, useMemo, useState } from "react";
import { useJournalSettings } from "@/hooks/useJournalQueries";
import { composeEntry, type Mood } from "@/lib/journal/entry";
import type { JournalSettings } from "@/lib/journal/settings";
import type { WeatherKind } from "@/lib/journal/weather";
import { useTranslate } from "@/utils/i18n";

/** How many prompts there are; their text is `journal.prompt.p1` and on. */
export const PROMPT_COUNT = 8;

/** Where the entry's location came from, so the location menu can show it. */
export type LocationSource = "dawarich" | "current" | "photos" | "search" | "none";

/** What the user has picked for the entry so far, kept with the draft. */
export interface JournalDraft {
  /** Set when the user turns journaling mode on or off for this draft; otherwise the Space decides. */
  override?: boolean;
  mood?: Mood;
  activities: string[];
  goalsDone: string[];
  prompt: number;
  /** Shown beside the time, like "from 14 photos", when the moment isn't now. */
  momentNote?: string;
  locationSource?: LocationSource;
  weather?: { temperature: number; unit: JournalSettings["temperatureUnit"]; kind: WeatherKind };
  /** The suggestion the entry was started from. */
  suggestion?: string;
}

const emptyDraft = (): JournalDraft => ({ activities: [], goalsDone: [], prompt: Math.floor(Math.random() * PROMPT_COUNT) + 1 });

const storageKey = (draftKey: string) => `memos-journal-draft:${draftKey}`;

const readDraft = (draftKey: string): JournalDraft => {
  try {
    const raw = window.localStorage.getItem(storageKey(draftKey));
    return raw ? { ...emptyDraft(), ...(JSON.parse(raw) as Partial<JournalDraft>) } : emptyDraft();
  } catch {
    return emptyDraft();
  }
};

export interface JournalSession {
  settings: JournalSettings;
  /** The draft is a new memo of its own, so journaling mode can apply. */
  available: boolean;
  active: boolean;
  /** The draft is in the journal Space, so the mode came on by itself. */
  inJournalSpace: boolean;
  draft: JournalDraft;
  update: (patch: Partial<JournalDraft>) => void;
  setActive: (active: boolean) => void;
  /** Something besides the text is picked, so the entry can be saved without text. */
  hasPicks: boolean;
  /** Writes the entry around the text the user wrote. */
  compose: (body: string, moment: Date) => string;
  /** Forgets the draft's picks after a save. */
  reset: () => void;
}

/** Journaling mode for one editing session: whether it is on, what is picked, and the entry it writes. */
export const useJournalSession = ({
  draftKey,
  available,
  space,
}: {
  draftKey: string;
  available: boolean;
  space?: string;
}): JournalSession => {
  const t = useTranslate();
  const { settings } = useJournalSettings();
  const [draft, setDraft] = useState<JournalDraft>(() => readDraft(draftKey));

  useEffect(() => {
    setDraft(readDraft(draftKey));
  }, [draftKey]);

  const update = useCallback(
    (patch: Partial<JournalDraft>) => {
      setDraft((current) => {
        const next = { ...current, ...patch };
        try {
          window.localStorage.setItem(storageKey(draftKey), JSON.stringify(next));
        } catch {
          // Storage full or off: the picks live until the page closes.
        }
        return next;
      });
    },
    [draftKey],
  );

  const inJournalSpace = Boolean(settings.space) && space === settings.space;
  const active = available && (draft.override ?? (inJournalSpace && settings.openInJournalMode));

  const compose = useCallback(
    (body: string, moment: Date) =>
      composeEntry({
        heading: settings.dateHeading
          ? moment.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
          : undefined,
        prompt: settings.showPrompt ? t(`journal.prompt.p${draft.prompt}` as never) : undefined,
        body,
        goals: settings.goals.map((label) => ({ label, done: draft.goalsDone.includes(label) })),
        weather: draft.weather
          ? `${draft.weather.temperature}°${draft.weather.unit === "fahrenheit" ? "F" : "C"}, ${t(`journal.weather.${draft.weather.kind}` as never)}`
          : undefined,
        mood: draft.mood,
        activities: draft.activities.filter((id) => settings.activities.some((activity) => activity.id === id)),
        moodTagPrefix: settings.moodTagPrefix,
        activityTagPrefix: settings.activityTagPrefix,
      }),
    [draft, settings, t],
  );

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey(draftKey));
    } catch {
      // Nothing stored.
    }
    setDraft((current) => ({ ...emptyDraft(), override: current.override }));
  }, [draftKey]);

  const hasPicks = Boolean(draft.mood) || draft.activities.length > 0 || draft.goalsDone.length > 0;

  return useMemo(
    () => ({
      settings,
      available,
      active,
      inJournalSpace,
      draft,
      update,
      setActive: (on: boolean) => update({ override: on }),
      hasPicks,
      compose,
      reset,
    }),
    [settings, available, active, inJournalSpace, draft, update, hasPicks, compose, reset],
  );
};
