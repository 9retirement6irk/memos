/**
 * What a memo's journal tags say, gathered for the state of mind panel at the foot of a journal
 * entry (components/Journal/JournalStatePanel). The tags stay in the memo as written, so stock
 * Memos still shows and searches them; the panel only draws them differently.
 */
import { FEELINGS, IMPACTS, type MindTagPrefixes, mindFromTags, moodFromTags, type StateOfMind } from "./mood";
import type { ActivityIcon, JournalActivity } from "./settings";
import { normalizePrefix } from "./tags";

export interface JournalTagSettings extends MindTagPrefixes {
  activityTagPrefix: string;
  activities: readonly JournalActivity[];
}

/** One tag the panel draws: its value, and the tag as the memo wrote it, without "#", to filter by. */
export interface JournalTagItem {
  id: string;
  tag: string;
}

export interface JournalActivityItem extends JournalTagItem {
  label: string;
  icon: ActivityIcon;
}

export interface JournalState {
  mind: StateOfMind;
  /** The tag that records the mood's step, to filter by. */
  moodTag?: string;
  feelings: JournalTagItem[];
  impacts: JournalTagItem[];
  activities: JournalActivityItem[];
  /** Every tag the panel stands for, lowercased, so the memo's line of them can be hidden. */
  shownTags: string[];
}

const after = (tag: string, prefix: string): string | undefined => {
  const normalized = normalizePrefix(prefix).toLowerCase();
  if (!normalized || !tag.toLowerCase().startsWith(normalized)) return undefined;
  const rest = tag.slice(normalized.length).toLowerCase();
  return rest && !rest.includes("/") ? rest : undefined;
};

/** The memo's journal tags as the panel shows them, or null when it has none the panel can draw. */
export const journalState = (tags: readonly string[], settings: JournalTagSettings): JournalState | null => {
  const mind = mindFromTags(tags, settings);
  const shown = new Set<string>();
  const items = (prefix: string, accept: (id: string) => boolean): JournalTagItem[] => {
    const found: JournalTagItem[] = [];
    for (const tag of tags) {
      const id = after(tag, prefix);
      if (!id || !accept(id) || found.some((item) => item.id === id)) continue;
      found.push({ id, tag });
      shown.add(tag.toLowerCase());
    }
    return found;
  };

  let moodTag: string | undefined;
  if (mind.valence) {
    for (const tag of tags) {
      const value = after(tag, settings.moodTagPrefix);
      if (!value) continue;
      // The step itself, an old face (#mood/good) or the kind (#mood/today, #mood/now).
      if (moodFromTags([tag], settings.moodTagPrefix)) {
        moodTag ??= tag;
        shown.add(tag.toLowerCase());
      } else if (value === "today" || value === "now") {
        shown.add(tag.toLowerCase());
      }
    }
  }
  const feelings = items(settings.feelingTagPrefix, (id) => id in FEELINGS);
  const impacts = items(settings.impactTagPrefix, (id) => (IMPACTS as readonly string[]).includes(id));
  const activities = items(settings.activityTagPrefix, () => true).map((item) => {
    const known = settings.activities.find((activity) => activity.id.toLowerCase() === item.id);
    return { ...item, label: known?.label ?? item.id, icon: known?.icon ?? ("star" as ActivityIcon) };
  });

  if (!mind.valence && feelings.length === 0 && impacts.length === 0 && activities.length === 0) return null;
  return { mind, moodTag, feelings, impacts, activities, shownTags: [...shown] };
};
