import { AstroidIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import SpaceIcon from "@/components/SpaceIcon";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { useSpaceContext } from "@/contexts/SpaceContext";
import { useDevicePreferences } from "@/hooks/useDevicePreferences";
import { extractSpaceUidFromName } from "@/lib/space-display";
import { getSpaceSwitchPath } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";
import SidebarRow from "./SidebarRow";
import SidebarSection from "./SidebarSection";

/**
 * Your Spaces as a list above Views: "All spaces" and one row per Space, with the one you are in
 * filled as the current place. A row moves the page you are on (timeline, calendar, …) to that
 * Space. Preferences → "Spaces in the sidebar" chooses which Spaces are listed, in this browser;
 * the Space you are in is listed even when it is switched off there, so the list always shows
 * where you are. With no Space to list, the section is not shown.
 */
const SpacesSection = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const location = useLocation();
  const { setMobileOpen } = useAppSidebar();
  const { spaces, selectedSpaceName } = useSpaceContext();
  const { hiddenSidebarSpaces } = useDevicePreferences();

  const listed = spaces.filter((space) => space.name === selectedSpaceName || !hiddenSidebarSpaces.includes(space.name));
  if (listed.length === 0) return null;

  const go = (space: string | undefined) => {
    if (space !== selectedSpaceName) navigate(getSpaceSwitchPath(location, space));
    setMobileOpen(false);
  };

  return (
    <SidebarSection label={t("space.spaces")}>
      <SidebarRow
        state={selectedSpaceName ? "idle" : "current"}
        icon={AstroidIcon}
        label={t("space.all-spaces")}
        onClick={() => go(undefined)}
      />
      {listed.map((space) => (
        <SidebarRow
          key={space.name}
          state={space.name === selectedSpaceName ? "current" : "idle"}
          leading={<SpaceIcon icon={space.icon} />}
          label={space.title || extractSpaceUidFromName(space.name)}
          onClick={() => go(space.name)}
        />
      ))}
    </SidebarSection>
  );
};

export default SpacesSection;
