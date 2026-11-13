/**
 * A journal entry is an ordinary memo. Its state of mind and activities are tags, its goals a
 * checklist and its weather a line of text, so stock Memos shows and searches it whole.
 */
import { type FeelingKind, type MindTagPrefixes, mindTags, type StateOfMind } from "./mood";
import { normalizePrefix } from "./tags";

export { moodFromTags } from "./mood";
export { normalizePrefix, tagSegment } from "./tags";

export interface EntryGoal {
  label: string;
  done: boolean;
}

export interface EntryParts extends MindTagPrefixes {
  /** Shown as a heading, like "Wednesday, November 11"; empty for none. */
  heading?: string;
  /** The prompt the user answered; empty for none. */
  prompt?: string;
  /** The text the user wrote, as Markdown. */
  body: string;
  goals: EntryGoal[];
  /** Like "51°F, sunny"; empty for none. */
  weather?: string;
  mind?: StateOfMind;
  /** The kind a state of mind without one is written as. */
  mindKind: FeelingKind;
  activities: string[];
  activityTagPrefix: string;
}

/** Writes the entry as Markdown. */
export const composeEntry = (parts: EntryParts): string => {
  const blocks: string[] = [];
  if (parts.heading) blocks.push(`## ${parts.heading}`);
  if (parts.prompt && parts.body.trim()) blocks.push(`> ${parts.prompt}`);
  if (parts.body.trim()) blocks.push(parts.body.trim());
  if (parts.goals.length) blocks.push(parts.goals.map((goal) => `- [${goal.done ? "x" : " "}] ${goal.label}`).join("\n"));
  if (parts.weather) blocks.push(parts.weather);
  const tags = [
    ...(parts.mind ? mindTags(parts.mind, parts.mindKind, parts) : []),
    ...parts.activities.map((id) => `#${normalizePrefix(parts.activityTagPrefix)}${id}`),
  ];
  if (tags.length) blocks.push(tags.join(" "));
  return `${blocks.join("\n\n")}\n`;
};

/** The weather line written into an entry. */
export const weatherLine = (temperature: number, unit: "fahrenheit" | "celsius", description: string) =>
  `${temperature}°${unit === "fahrenheit" ? "F" : "C"}, ${description}`;
