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
 * How the journal Space lists its entries, kept apart from the view Home and other Spaces use.
 * The same values as the timeline's view menu.
 */
export interface JournalView {
  /** The journal Space keeps this view; off, it shares the view used everywhere else. */
  own: boolean;
  /** 1 = list, 2 or 3 = at most that many columns, 0 = as many as fit. */
  maxColumns: 0 | 1 | 2 | 3;
  orderByTimeAsc: boolean;
  compactMode: boolean;
  timeBasis: "create_time" | "update_time";
}

export const DEFAULT_JOURNAL_VIEW: JournalView = {
  own: true,
  maxColumns: 1,
  orderByTimeAsc: false,
  compactMode: false,
  timeBasis: "create_time",
};

/**
 * How the user's journal works. The server keeps it as one document per user and
 * reads only `space`; everything else is the web app's. Entries never depend on it:
 * they are ordinary memos with their mood and activities written as tags.
 */
export interface JournalSettings {
  /** The Space journal entries go to and that opens in journaling mode, like "spaces/abc"; empty for none. */
  space: string;
  openInJournalMode: boolean;
  moodTagPrefix: string;
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
  view: JournalView;
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
  view: DEFAULT_JOURNAL_VIEW,
});

/** Fills what a stored document lacks (an older one, or none) from the defaults. */
export const withDefaults = (stored: Partial<JournalSettings>, defaults: JournalSettings): JournalSettings => {
  const merged: JournalSettings = {
    ...defaults,
    ...Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined && value !== null)),
  };
  // A view saved by an older version may lack fields added since.
  return { ...merged, view: { ...defaults.view, ...(typeof stored.view === "object" ? stored.view : {}) } };
};

export const getJournalSettings = () => apiJSON<Partial<JournalSettings>>("/api/journal/settings");

export const saveJournalSettings = (settings: JournalSettings) =>
  apiJSON<Partial<JournalSettings>>("/api/journal/settings", { method: "PUT", body: JSON.stringify(settings) });
