import { useCallback, useEffect } from "react";
import { useAppState } from "./useAppState";

export function useTheme() {
  const { preferences, patch } = useAppState();
  const { theme } = preferences;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = useCallback(() => {
    patch("preferences", { theme: theme === "dark" ? "light" : "dark" });
  }, [patch, theme]);

  return { theme, toggleTheme };
}
