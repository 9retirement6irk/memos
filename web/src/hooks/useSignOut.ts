import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { buildAuthRoute } from "@/utils/auth-redirect";

/** Local settings that outlive a session: this device's look, language and memo list layout. */
const KEYS_TO_PRESERVE = ["memos-theme", "memos-locale", "memos-view-setting", "tag-view-as-tree"];

/** Signs out, clears this device's session data except its preferences, and returns to sign-in. */
export const useSignOut = () => {
  const { logout } = useAuth();

  return useCallback(async () => {
    await logout();
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !KEYS_TO_PRESERVE.includes(key)) keysToRemove.push(key);
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Ignore errors from localStorage operations.
    }
    window.location.replace(buildAuthRoute({ autoSignIn: false }));
  }, [logout]);
};
