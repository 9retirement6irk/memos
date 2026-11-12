import { useSyncExternalStore } from "react";
import type { Appearance } from "@/utils/theme";

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};

const read = () => (document.documentElement.getAttribute("data-theme") ?? "light") as Appearance;

/**
 * The theme on the page right now: <html data-theme>, as loadTheme set it. Unlike
 * useResolvedTheme it needs no signed-in user and changes the moment a theme is picked.
 */
export const useAppearance = (): Appearance => useSyncExternalStore(subscribe, read, () => "light");

/** Whether one of the Aero themes is on the page. */
export const useIsAero = (): boolean => useAppearance().startsWith("aero-");
