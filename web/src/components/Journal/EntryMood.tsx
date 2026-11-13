import { useJournalSettings } from "@/hooks/useJournalQueries";
import { mindFromTags } from "@/lib/journal/mood";
import { useTranslate } from "@/utils/i18n";
import { MoodFace } from "./MoodFace";

/** The face for a memo's mood tags, beside the memo's time, in journal entries and check-ins alike. */
export const EntryMood = ({ tags }: { tags: readonly string[] }) => {
  const t = useTranslate();
  const { settings } = useJournalSettings();
  const mind = mindFromTags(tags, settings);
  if (!mind.valence) return null;
  const words = [
    t(`journal.valence.${mind.valence}` as never),
    t(`journal.kind.${mind.kind ?? "today"}` as never),
    ...mind.feelings.map((id) => t(`journal.feeling.${id}` as never)),
  ].join(" · ");
  return (
    <span data-entry-mood={mind.valence} className="flex shrink-0" title={words}>
      <MoodFace valence={mind.valence} size={20} label={t("journal.mood-label", { mood: words })} />
    </span>
  );
};
