import { BookHeartIcon, StickyNoteIcon } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { useSpaceContext } from "@/contexts/SpaceContext";
import { useJournalSettings } from "@/hooks/useJournalQueries";
import { getSpaceSwitchPath } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";
import SidebarRow from "./SidebarRow";

// The Space to go back to from the journal: the one you were in before, or all memos.
const RETURN_SPACE_KEY = "memos-journal-return-space";

const readReturnSpace = (): string | undefined => {
  try {
    return window.localStorage.getItem(RETURN_SPACE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

const writeReturnSpace = (space: string | undefined) => {
  try {
    if (space) window.localStorage.setItem(RETURN_SPACE_KEY, space);
    else window.localStorage.removeItem(RETURN_SPACE_KEY);
  } catch {
    // Private browsing: Notes goes back to all memos.
  }
};

/**
 * One row that moves between your notes and your journal Space (Settings → Journal). Outside the
 * journal it reads "Journal"; inside it reads "Notes" and goes back to the Space you came from.
 * The page stays the same kind (timeline, calendar, …); only the Space changes.
 */
const JournalSwitchRow = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const location = useLocation();
  const { setMobileOpen } = useAppSidebar();
  const { spaces, selectedSpaceName } = useSpaceContext();
  const { settings } = useJournalSettings();
  const journalSpace = settings.space;
  const inJournal = Boolean(journalSpace) && selectedSpaceName === journalSpace;

  // Remember where you are while outside the journal, so Notes can bring you back.
  useEffect(() => {
    if (journalSpace && !inJournal) writeReturnSpace(selectedSpaceName);
  }, [journalSpace, inJournal, selectedSpaceName]);

  if (!journalSpace || !spaces.some((space) => space.name === journalSpace)) return null;

  const go = () => {
    const remembered = readReturnSpace();
    const back = remembered && remembered !== journalSpace && spaces.some((space) => space.name === remembered) ? remembered : undefined;
    navigate(getSpaceSwitchPath(location, inJournal ? back : journalSpace));
    setMobileOpen(false);
  };

  return inJournal ? (
    <SidebarRow icon={StickyNoteIcon} label={t("journal.sidebar.notes")} onClick={go} />
  ) : (
    <SidebarRow icon={BookHeartIcon} label={t("journal.sidebar.journal")} onClick={go} />
  );
};

export default JournalSwitchRow;
