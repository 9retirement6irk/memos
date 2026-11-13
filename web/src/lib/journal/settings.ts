import { apiJSON } from "./api";

/** The icons an activity can show; each is a Lucide icon, which the Aero themes draw as a Vista picture. */
export const ACTIVITY_ICONS = [
  "briefcase",
  "dumbbell",
  "users",
  "book-open",
  "music",
  "coffee",
  "plane",
  "gamepad",
  "palette",
  "utensils",
  "tree",
  "heart",
  "star",
] as const;
export type ActivityIcon = (typeof ACTIVITY_ICONS)[number];

export interface JournalActivity {
  /** The tag's last segment, like "work" for #did/work. */
  id: string;
  label: string;
  icon: ActivityIcon;
}

/**
 * How the user's journal works. The server keeps it as one document per user and
 * reads only `space`; everything else is the web app's. Entries never depend on it:
 * they are ordinary memos with their state of mind and activities written as tags.
 */
export interface JournalSettings {
  /** The Space journal entries go to and that opens in journaling mode, like "spaces/abc"; empty for none. */
  space: string;
  openInJournalMode: boolean;
  moodTagPrefix: string;
  /** Written before feeling words, like "felt/" for #felt/grateful. */
  feelingTagPrefix: string;
  /** Written before what's behind a feeling, like "impact/" for #impact/work. */
  impactTagPrefix: string;
  /** Causes left out of "What's having the biggest impact?". */
  hiddenImpacts: string[];
  activityTagPrefix: string;
  activities: JournalActivity[];
  goals: string[];
  /** Where the weather is for when an entry has no location, like "Boston, MA". */
  defaultCity: string;
  temperatureUnit: "fahrenheit" | "celsius";
  addLocation: boolean;
  addWeather: boolean;
  useMomentDate: boolean;
  addRouteImage: boolean;
  showPrompt: boolean;
  showSuggestions: boolean;
  dateHeading: boolean;
}

/** Fahrenheit where people use it, Celsius elsewhere. */
const defaultUnit = (): JournalSettings["temperatureUnit"] => {
  const region = (typeof navigator !== "undefined" ? navigator.language : "en-US").split("-")[1]?.toUpperCase();
  return region && ["US", "LR", "MM", "BS", "BZ", "KY", "PW"].includes(region) ? "fahrenheit" : "celsius";
};

/** The settings a user starts with. Activity labels come from `label`, so they start in the user's language. */
export const defaultJournalSettings = (label: (id: string) => string): JournalSettings => ({
  space: "",
  openInJournalMode: true,
  moodTagPrefix: "mood/",
  feelingTagPrefix: "felt/",
  impactTagPrefix: "impact/",
  hiddenImpacts: [],
  activityTagPrefix: "did/",
  activities: (
    [
      ["work", "briefcase"],
      ["exercise", "dumbbell"],
      ["family", "users"],
      ["reading", "book-open"],
      ["music", "music"],
      ["friends", "coffee"],
      ["travel", "plane"],
      ["gaming", "gamepad"],
      ["drawing", "palette"],
    ] as const
  ).map(([id, icon]) => ({ id, icon, label: label(id) })),
  goals: [],
  defaultCity: "",
  temperatureUnit: defaultUnit(),
  addLocation: true,
  addWeather: true,
  useMomentDate: true,
  addRouteImage: true,
  showPrompt: true,
  showSuggestions: true,
  dateHeading: false,
});

/** Fills what a stored document lacks (an older one, or none) from the defaults. */
export const withDefaults = (stored: Partial<JournalSettings>, defaults: JournalSettings): JournalSettings => ({
  ...defaults,
  ...Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined && value !== null)),
});

export const getJournalSettings = () => apiJSON<Partial<JournalSettings>>("/api/journal/settings");

export const saveJournalSettings = (settings: JournalSettings) =>
  apiJSON<Partial<JournalSettings>>("/api/journal/settings", { method: "PUT", body: JSON.stringify(settings) });
