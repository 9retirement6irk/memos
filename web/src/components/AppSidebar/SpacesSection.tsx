import { HouseIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import SpaceIcon from "@/components/SpaceIcon";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { useSpaceContext } from "@/contexts/SpaceContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useDevicePreferences } from "@/hooks/useDevicePreferences";
import { extractSpaceUidFromName } from "@/lib/space-display";
import { getPlaceSwitchPath, getSpaceSwitchPath } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";
import SidebarRow from "./SidebarRow";
import SidebarSection from "./SidebarSection";

/**
 * Your Spaces as a list above Views: Home and one row per Space, with the one you are in filled as
 * the current place. A row moves the page you are on (timeline, calendar, …) to that Space; Home
 * leaves the Space for your own memos, as the title's places menu does (upstream #6625 made a
 * Space's timeline everyone's, so leaving one returns to Home rather than to "all spaces"). Preferences → "Spaces in the sidebar" chooses which Spaces are listed, in this browser;
 * the Space you are in is listed even when it is switched off there, so the list always shows
 * where you are. With no Space to list, the section is not shown.
 */
const SpacesSection = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const location = useLocation();
  const { setMobileOpen } = useAppSidebar();
  const currentUser = useCurrentUser();
  const { spaces, selectedSpaceName, creatorUsername } = useSpaceContext();
  const { hiddenSidebarSpaces } = useDevicePreferences();

  const listed = spaces.filter((space) => space.name === selectedSpaceName || !hiddenSidebarSpaces.includes(space.name));
  if (listed.length === 0) return null;

  // Home is your own memos outside every Space, in any collection view (as in SpaceSwitcher).
  const atHome = Boolean(currentUser && creatorUsername === currentUser.username && !selectedSpaceName);
  const go = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <SidebarSection label={t("space.spaces")}>
      <SidebarRow
        state={atHome ? "current" : "idle"}
        icon={HouseIcon}
        label={t("common.home")}
        onClick={() => !atHome && go(getPlaceSwitchPath(location, currentUser?.username))}
      />
      {listed.map((space) => (
        <SidebarRow
          key={space.name}
          state={space.name === selectedSpaceName ? "current" : "idle"}
          leading={<SpaceIcon icon={space.icon} />}
          label={space.title || extractSpaceUidFromName(space.name)}
          onClick={() => space.name !== selectedSpaceName && go(getSpaceSwitchPath(location, space.name))}
        />
      ))}
    </SidebarSection>
  );
};

export default SpacesSection;
