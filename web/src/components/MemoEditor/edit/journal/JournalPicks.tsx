import { Button, Checkbox } from "@usememos/ui";
import { ShuffleIcon } from "lucide-react";
import { ActivityIconView } from "@/components/Journal/ActivityIconView";
import { MoodFace } from "@/components/Journal/MoodFace";
import { MOODS } from "@/lib/journal/entry";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { type JournalSession, PROMPT_COUNT } from "./useJournalSession";

/** The mood, the activities and the day's prompt, above the text. */
export const JournalPicks = ({ journal }: { journal: JournalSession }) => {
  const t = useTranslate();
  const { settings, draft, update } = journal;
  return (
    <div className="flex w-full flex-col gap-3" data-journal-picks="">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mu-label mb-1.5">{t("journal.mood-question")}</legend>
        <div className="flex flex-wrap gap-1">
          {MOODS.map((mood) => {
            const on = draft.mood === mood;
            return (
              <button
                key={mood}
                type="button"
                aria-pressed={on}
                data-mood={mood}
                onClick={() => update({ mood: on ? undefined : mood })}
                className={cn(
                  "mu-focus flex min-w-16 flex-col items-center gap-1 rounded-mu-md border px-2 pt-1.5 pb-1 transition-colors",
                  on ? "border-mu-edge bg-mu-hover font-medium" : "border-transparent hover:bg-mu-hover",
                )}
              >
                <MoodFace mood={mood} size={34} />
                <span className="mu-caption">{t(`journal.mood.${mood}` as never)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {settings.activities.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mu-label mb-1.5">{t("journal.activities-question")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {settings.activities.map((activity) => {
              const on = draft.activities.includes(activity.id);
              return (
                <Button
                  key={activity.id}
                  size="sm"
                  variant={on ? "primary" : "neutral"}
                  aria-pressed={on}
                  icon={<ActivityIconView icon={activity.icon} />}
                  onClick={() =>
                    update({ activities: on ? draft.activities.filter((id) => id !== activity.id) : [...draft.activities, activity.id] })
                  }
                >
                  {activity.label}
                </Button>
              );
            })}
          </div>
        </fieldset>
      )}

      {settings.showPrompt && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mu-label">{t("journal.prompt-label")}</span>
          <span className="mu-body min-w-0 flex-1 text-mu-ink-muted">{t(`journal.prompt.p${draft.prompt}` as never)}</span>
          <Button variant="ghost" size="xs" icon={<ShuffleIcon />} onClick={() => update({ prompt: (draft.prompt % PROMPT_COUNT) + 1 })}>
            {t("journal.prompt-another")}
          </Button>
        </div>
      )}
    </div>
  );
};

/** The day's goals, to tick off. Saved as a checklist. */
export const JournalGoals = ({ journal }: { journal: JournalSession }) => {
  const t = useTranslate();
  const { settings, draft, update } = journal;
  if (!settings.goals.length) return null;
  return (
    <fieldset className="flex w-full flex-col gap-1.5 rounded-mu-md border border-mu-line px-3 pt-1 pb-2.5" data-journal-goals="">
      <legend className="mu-label px-1">{t("journal.goals", { done: draft.goalsDone.length, total: settings.goals.length })}</legend>
      {settings.goals.map((goal) => {
        const done = draft.goalsDone.includes(goal);
        return (
          <label key={goal} className="mu-body flex min-h-8 cursor-pointer items-center gap-2.5">
            <Checkbox
              checked={done}
              onCheckedChange={(checked) =>
                update({ goalsDone: checked ? [...draft.goalsDone, goal] : draft.goalsDone.filter((label) => label !== goal) })
              }
            />
            <span className={cn(done && "text-mu-ink-muted line-through")}>{goal}</span>
          </label>
        );
      })}
    </fieldset>
  );
};
