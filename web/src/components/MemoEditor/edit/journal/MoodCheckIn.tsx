import { Button, Dialog } from "@usememos/ui";
import { PencilIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { MoodFace } from "@/components/Journal/MoodFace";
import { StateOfMindPicker } from "@/components/Journal/StateOfMindPicker";
import { emptyMind, type StateOfMind } from "@/lib/journal/mood";
import { useTranslate } from "@/utils/i18n";
import type { JournalSession } from "./useJournalSession";

/**
 * A check-in of how the user feels, for any new memo that isn't a journal entry. It starts as
 * "right now"; saving the memo writes it as tags under the text.
 */
export const MoodCheckInDialog = ({
  journal,
  open,
  onOpenChange,
}: {
  journal: JournalSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useTranslate();
  const [mind, setMind] = useState<StateOfMind>(journal.draft.mind);

  useEffect(() => {
    if (open) setMind(journal.draft.mind.valence ? journal.draft.mind : { ...emptyMind(), kind: "now" });
  }, [open, journal.draft.mind]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup className="sm:max-w-lg" closeLabel={t("common.close")}>
        <Dialog.Title>{t("journal.checkin.title")}</Dialog.Title>
        <StateOfMindPicker value={mind} onChange={setMind} defaultKind="now" hiddenImpacts={journal.settings.hiddenImpacts} />
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
          <Button
            variant="primary"
            disabled={!mind.valence}
            onClick={() => {
              journal.update({ mind: { ...mind, kind: mind.kind ?? "now" } });
              onOpenChange(false);
            }}
          >
            {t("common.confirm")}
          </Button>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
};

/** The check-in on a plain memo, shown above the toolbar until the memo is saved. */
export const MoodCheckInChip = ({ journal, onEdit }: { journal: JournalSession; onEdit: () => void }) => {
  const t = useTranslate();
  const { mind } = journal.draft;
  if (!journal.hasCheckIn || !mind.valence) return null;
  const words = mind.feelings.map((id) => t(`journal.feeling.${id}` as never));
  const summary = [t(`journal.valence.${mind.valence}` as never), t(`journal.kind.${mind.kind ?? "now"}` as never), ...words].join(" · ");
  return (
    <div className="flex w-full items-center gap-2 rounded-mu-md border border-mu-line px-2 py-1" data-mood-check-in="">
      <MoodFace valence={mind.valence} size={22} />
      <span className="mu-body min-w-0 flex-1 truncate">{summary}</span>
      <Button variant="ghost" size="xs" icon={<PencilIcon />} onClick={onEdit}>
        {t("common.edit")}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        icon={<XIcon />}
        aria-label={t("journal.checkin.remove")}
        onClick={() => journal.update({ mind: emptyMind() })}
      />
    </div>
  );
};
