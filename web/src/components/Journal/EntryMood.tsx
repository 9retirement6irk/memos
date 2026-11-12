import { useJournalSettings } from "@/hooks/useJournalQueries";
import { moodFromTags } from "@/lib/journal/entry";
import { useTranslate } from "@/utils/i18n";
import { MoodFace } from "./MoodFace";

/** The face for a journal entry's mood tag, beside the memo's time. */
export const EntryMood = ({ tags }: { tags: readonly string[] }) => {
  const t = useTranslate();
  const { settings } = useJournalSettings();
  const mood = moodFromTags(tags, settings.moodTagPrefix);
  if (!mood) return null;
  return (
    <span data-entry-mood={mood} className="flex shrink-0">
      <MoodFace mood={mood} size={20} label={t("journal.mood-label", { mood: t(`journal.mood.${mood}` as never) })} />
    </span>
  );
};
