import { useEffect, useReducer } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getThemeWithFallback, isSystemTheme, type ResolvedTheme, resolveTheme, setupSystemThemeListener } from "@/utils/theme";

/** The theme actually in effect: the user's setting, or the OS scheme while that setting is "system" or "aero-system". */
export const useResolvedTheme = (): ResolvedTheme => {
  const { userGeneralSetting } = useAuth();
  const theme = getThemeWithFallback(userGeneralSetting?.theme);
  // An OS scheme change re-renders; resolveTheme reads the scheme itself.
  const [, onSystemChange] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!isSystemTheme(theme)) return;
    return setupSystemThemeListener(onSystemChange);
  }, [theme]);
  return resolveTheme(theme);
};
