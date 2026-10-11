import { useLocale, t } from "@/lib/i18n";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";
type ThemeContextValue = {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
};
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  useLocale();
  const [theme, setThemeState] = useState<Theme>(() =>
    localStorage.getItem("veloray-theme") === "light" ? "light" : "dark",
  );
  const resolved = theme;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.classList.toggle("light", resolved === "light");
    document.documentElement.style.colorScheme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#000000" : "#f3f6f8");
  }, [resolved]);
  const setTheme = (value: Theme) => {
    localStorage.setItem("veloray-theme", value);
    setThemeState(value);
  };
  const value = useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error(t("useTheme must be used within ThemeProvider"));
  return value;
}
