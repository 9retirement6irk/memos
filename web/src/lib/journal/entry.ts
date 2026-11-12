/**
 * A journal entry is an ordinary memo. Its mood and activities are tags, its goals a
 * checklist and its weather a line of text, so stock Memos shows and searches it whole.
 */

export const MOODS = ["awful", "bad", "okay", "good", "great"] as const;
export type Mood = (typeof MOODS)[number];

export interface EntryGoal {
  label: string;
  done: boolean;
}

export interface EntryParts {
  /** Shown as a heading, like "Wednesday, November 11"; empty for none. */
  heading?: string;
  /** The prompt the user answered; empty for none. */
  prompt?: string;
  /** The text the user wrote, as Markdown. */
  body: string;
  goals: EntryGoal[];
  /** Like "51°F, sunny"; empty for none. */
  weather?: string;
  mood?: Mood;
  activities: string[];
  moodTagPrefix: string;
  activityTagPrefix: string;
}

/** A tag segment from a label: lowercase, words joined by "-", only characters tags allow. */
export const tagSegment = (label: string): string =>
  label
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s/]+/g, "-")
    .replace(/[^\p{L}\p{N}_\-+&]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

/** A tag prefix as the user typed it, ending in one "/" when it isn't empty. */
export const normalizePrefix = (prefix: string): string => {
  const segments = prefix.split("/").map(tagSegment).filter(Boolean);
  return segments.length ? `${segments.join("/")}/` : "";
};

/** Writes the entry as Markdown. */
export const composeEntry = (parts: EntryParts): string => {
  const blocks: string[] = [];
  if (parts.heading) blocks.push(`## ${parts.heading}`);
  if (parts.prompt && parts.body.trim()) blocks.push(`> ${parts.prompt}`);
  if (parts.body.trim()) blocks.push(parts.body.trim());
  if (parts.goals.length) blocks.push(parts.goals.map((goal) => `- [${goal.done ? "x" : " "}] ${goal.label}`).join("\n"));
  if (parts.weather) blocks.push(parts.weather);
  const tags = [
    ...(parts.mood ? [`#${normalizePrefix(parts.moodTagPrefix)}${parts.mood}`] : []),
    ...parts.activities.map((id) => `#${normalizePrefix(parts.activityTagPrefix)}${id}`),
  ];
  if (tags.length) blocks.push(tags.join(" "));
  return `${blocks.join("\n\n")}\n`;
};

/** The mood a memo's tags record, if any. */
export const moodFromTags = (tags: readonly string[], moodTagPrefix: string): Mood | undefined => {
  const prefix = normalizePrefix(moodTagPrefix);
  for (const tag of tags) {
    const value = tag.toLowerCase().startsWith(prefix) ? tag.slice(prefix.length).toLowerCase() : undefined;
    if (value && (MOODS as readonly string[]).includes(value)) return value as Mood;
  }
  return undefined;
};

/** The weather line written into an entry. */
export const weatherLine = (temperature: number, unit: "fahrenheit" | "celsius", description: string) =>
  `${temperature}°${unit === "fahrenheit" ? "F" : "C"}, ${description}`;
