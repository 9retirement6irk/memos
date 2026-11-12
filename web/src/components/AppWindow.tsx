import { type ReactNode, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { getSidebarRouteKind } from "@/components/AppSidebar/routes";
import { columnCountForWidth, GRID_GAP } from "@/components/ColumnGrid";
import { MAX_COLUMN_WIDTH } from "@/components/PagedMemoList/PagedMemoList";
import { useInstance } from "@/contexts/InstanceContext";
import { useView } from "@/contexts/ViewContext";
import { useIsAero } from "@/hooks/useAppearance";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useSignOut } from "@/hooks/useSignOut";
import { useTranslate } from "@/utils/i18n";

/** Space kept between the window and the edges of the page, in px. Matches themes/aero/aero.css. */
const WINDOW_MARGIN = 16;

/** The width the memo grid packs into within `available` px: the same rules ColumnGrid lays it out by. */
export const packedGridWidth = (available: number, maxColumns: number): number => {
  const fit = columnCountForWidth(available);
  const count = maxColumns > 0 ? Math.min(fit, maxColumns) : fit;
  const column = Math.min(count > 1 ? Math.floor((available - GRID_GAP * (count - 1)) / count) : available, MAX_COLUMN_WIDTH);
  return column * count + GRID_GAP * (count - 1);
};

/**
 * With the multi-column memo grid, sizes the window to the packed columns so no empty glass
 * shows beside them. The width comes from the room around the window, not from the window
 * itself, so it grows back when the page gets wider.
 */
const useHugGrid = (windowRef: React.RefObject<HTMLDivElement | null>, maxColumns: number) => {
  useLayoutEffect(() => {
    const win = windowRef.current;
    const room = win?.parentElement;
    if (!win || !room) return;

    let frame = 0;
    const fit = () => {
      frame = 0;
      const grid = win.querySelector<HTMLElement>("[data-column-grid]");
      if (!grid) {
        win.style.removeProperty("max-width");
        return;
      }
      // Everything around the grid inside the window: frame, padding and the page's own gutters.
      const chrome = win.offsetWidth - grid.clientWidth;
      const available = room.clientWidth - 2 * WINDOW_MARGIN - chrome;
      win.style.maxWidth = `${packedGridWidth(available, maxColumns) + chrome}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(room);
    // The grid appears and disappears as the layout setting or the page changes.
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(win, { childList: true, subtree: true });
    fit();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      win.style.removeProperty("max-width");
    };
  }, [windowRef, maxColumns]);
};

interface FrameProps {
  children: ReactNode;
  page: string;
}

/** The Aero window: a glass frame with a caption bar whose red close button signs out. */
const AeroWindowFrame = ({ children, page }: FrameProps) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const signOut = useSignOut();
  const { generalSetting } = useInstance();
  const { maxColumns } = useView();
  const windowRef = useRef<HTMLDivElement>(null);
  useHugGrid(windowRef, maxColumns);
  const title = generalSetting.customProfile?.title || "Memos";

  return (
    <div ref={windowRef} data-app-window data-page={page}>
      <div data-app-window-caption>
        <span data-app-window-title>{title}</span>
        {/* Minimize and maximize are drawn for the look only. */}
        <span data-app-window-buttons aria-hidden="true" />
        {currentUser && (
          <button
            type="button"
            data-app-window-close
            className="mu-focus"
            title={t("common.sign-out")}
            aria-label={t("common.sign-out")}
            onClick={() => void signOut()}
          />
        )}
      </div>
      {children}
    </div>
  );
};

/**
 * Frames the page in an Aero window while an Aero theme is on. Other themes get the page as
 * it is, with no extra element. The map fills the viewport and stays unframed.
 */
const AppWindow = ({ children }: { children: ReactNode }) => {
  const aero = useIsAero();
  const { pathname } = useLocation();
  const page = getSidebarRouteKind(pathname);

  if (!aero || page === "map") return <>{children}</>;
  return <AeroWindowFrame page={page}>{children}</AeroWindowFrame>;
};

export default AppWindow;
