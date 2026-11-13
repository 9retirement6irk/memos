/**
 * How someone feels, after Apple Health's State of Mind: how pleasant it is on a seven-step scale,
 * whether it's the day overall or right now, words for the feeling and what's behind it. It is
 * written into a memo as plain tags, like `#mood/pleasant #mood/today #felt/grateful #impact/work`,
 * so stock Memos shows and searches it.
 */
import { normalizePrefix } from "./tags";

/** From very unpleasant to very pleasant; Apple's seven valence classes. */
export const VALENCES = [
  "very-unpleasant",
  "unpleasant",
  "slightly-unpleasant",
  "neutral",
  "slightly-pleasant",
  "pleasant",
  "very-pleasant",
] as const;
export type Valence = (typeof VALENCES)[number];

/** A valence as a number from -1 (very unpleasant) to 1 (very pleasant), as Apple measures it. */
export const valenceScore = (valence: Valence) => (VALENCES.indexOf(valence) - 3) / 3;

/** The nearest step to a score from -1 to 1. */
export const valenceFromScore = (score: number): Valence =>
  VALENCES[Math.max(0, Math.min(6, Math.round(Math.max(-1, Math.min(1, score)) * 3 + 3)))];

/** Moods saved by the five faces this replaced, read as the step nearest them. */
const LEGACY: Record<string, Valence> = {
  awful: "very-unpleasant",
  bad: "unpleasant",
  okay: "neutral",
  good: "pleasant",
  great: "very-pleasant",
};

/** A mood for the whole day, or an emotion felt right now. */
export const FEELING_KINDS = ["today", "now"] as const;
export type FeelingKind = (typeof FEELING_KINDS)[number];

/**
 * Apple's feeling words, each with where it usually sits on the scale (-1 to 1). The words nearest
 * the chosen step are offered first.
 */
export const FEELINGS: Record<string, number> = {
  amazed: 0.9,
  amused: 0.6,
  angry: -0.9,
  annoyed: -0.4,
  anxious: -0.7,
  ashamed: -0.8,
  brave: 0.6,
  calm: 0.3,
  confident: 0.7,
  content: 0.4,
  disappointed: -0.5,
  discouraged: -0.6,
  disgusted: -0.8,
  drained: -0.4,
  embarrassed: -0.5,
  excited: 0.9,
  frustrated: -0.6,
  grateful: 0.7,
  guilty: -0.6,
  happy: 0.8,
  hopeful: 0.5,
  hopeless: -1,
  indifferent: 0,
  irritated: -0.4,
  jealous: -0.5,
  joyful: 1,
  lonely: -0.6,
  overwhelmed: -0.7,
  passionate: 0.8,
  peaceful: 0.5,
  proud: 0.8,
  relieved: 0.4,
  sad: -0.7,
  satisfied: 0.5,
  scared: -0.8,
  stressed: -0.6,
  surprised: 0.1,
  worried: -0.5,
};
export const FEELING_IDS = Object.keys(FEELINGS);

/** What's behind a feeling; Apple's associations. */
export const IMPACTS = [
  "community",
  "current-events",
  "dating",
  "education",
  "family",
  "fitness",
  "friends",
  "health",
  "hobbies",
  "identity",
  "money",
  "partner",
  "self-care",
  "spirituality",
  "tasks",
  "travel",
  "weather",
  "work",
] as const;
export type Impact = (typeof IMPACTS)[number];

export interface StateOfMind {
  valence?: Valence;
  kind?: FeelingKind;
  feelings: string[];
  impacts: string[];
}

export const emptyMind = (): StateOfMind => ({ feelings: [], impacts: [] });

export interface MindTagPrefixes {
  moodTagPrefix: string;
  feelingTagPrefix: string;
  impactTagPrefix: string;
}

/** How many feeling words are offered before "Show all". */
export const SUGGESTED_FEELINGS = 10;

/** The feeling words nearest a step, nearest first; all of them, nearest first, without a step. */
export const feelingsNear = (valence: Valence | undefined): string[] => {
  const score = valence ? valenceScore(valence) : 0;
  return [...FEELING_IDS].sort((a, b) => Math.abs(FEELINGS[a] - score) - Math.abs(FEELINGS[b] - score) || a.localeCompare(b));
};

/** The tags that record a state of mind, in the order they're written. Nothing without a step. */
export const mindTags = (mind: StateOfMind, kind: FeelingKind, prefixes: MindTagPrefixes): string[] => {
  if (!mind.valence) return [];
  const mood = normalizePrefix(prefixes.moodTagPrefix);
  return [
    `#${mood}${mind.valence}`,
    `#${mood}${mind.kind ?? kind}`,
    ...mind.feelings.filter((id) => id in FEELINGS).map((id) => `#${normalizePrefix(prefixes.feelingTagPrefix)}${id}`),
    ...mind.impacts
      .filter((id) => (IMPACTS as readonly string[]).includes(id))
      .map((id) => `#${normalizePrefix(prefixes.impactTagPrefix)}${id}`),
  ];
};

const segmentsAfter = (tags: readonly string[], prefix: string): string[] => {
  const normalized = normalizePrefix(prefix).toLowerCase();
  if (!normalized) return [];
  return tags.filter((tag) => tag.toLowerCase().startsWith(normalized)).map((tag) => tag.slice(normalized.length).toLowerCase());
};

/** The step a memo's tags record, reading the five old faces too. */
export const moodFromTags = (tags: readonly string[], moodTagPrefix: string): Valence | undefined => {
  for (const value of segmentsAfter(tags, moodTagPrefix)) {
    if ((VALENCES as readonly string[]).includes(value)) return value as Valence;
    if (value in LEGACY) return LEGACY[value];
  }
  return undefined;
};

/** The state of mind a memo's tags record. A mood without a kind was a day's mood. */
export const mindFromTags = (tags: readonly string[], prefixes: MindTagPrefixes): StateOfMind => {
  const moodValues = segmentsAfter(tags, prefixes.moodTagPrefix);
  const valence = moodFromTags(tags, prefixes.moodTagPrefix);
  return {
    valence,
    kind: valence ? (moodValues.includes("now") ? "now" : "today") : undefined,
    feelings: segmentsAfter(tags, prefixes.feelingTagPrefix).filter((id) => id in FEELINGS),
    impacts: segmentsAfter(tags, prefixes.impactTagPrefix).filter((id) => (IMPACTS as readonly string[]).includes(id)),
  };
};
