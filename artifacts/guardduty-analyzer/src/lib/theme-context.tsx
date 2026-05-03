import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_VARS: Record<string, string> = {
  "--cs-bg":         "#0c0e12",
  "--cs-surface":    "#161920",
  "--cs-surface2":   "#1e2130",
  "--cs-surface3":   "#252836",
  "--cs-border":     "#262a33",
  "--cs-border2":    "#333847",
  "--cs-text":       "#dde4ed",
  "--cs-text-dim":   "#7f8fa6",
  "--cs-text-muted": "#414d60",
  "--cs-orange":     "#ff9900",
  "--cs-green":      "#22c55e",
  "--cs-red":        "#f14c4c",
  "--cs-blue":       "#38bdf8",
  "--aws-nav":       "#131620",
  "--aws-surface":   "#0c0e12",
  "--aws-surface-2": "#161920",
  "--aws-surface-3": "#1e2130",
  "--aws-border":    "#262a33",
  "--aws-border-2":  "#333847",
  "--aws-text":      "#dde4ed",
  "--aws-text-dim":  "#7f8fa6",
  "--aws-text-muted":"#414d60",
  "--guardduty-orange": "#ff9900",
  "--background":    "228 18% 7%",
  "--foreground":    "210 20% 89%",
  "--card":          "228 16% 10%",
  "--card-foreground":"210 20% 89%",
  "--popover":       "228 16% 10%",
  "--popover-foreground":"210 20% 89%",
  "--primary":       "36 100% 50%",
  "--primary-foreground":"0 0% 0%",
  "--secondary":     "228 15% 15%",
  "--secondary-foreground":"210 20% 89%",
  "--muted":         "222 14% 32%",
  "--muted-foreground":"216 12% 54%",
  "--accent":        "36 100% 50%",
  "--accent-foreground":"0 0% 0%",
  "--destructive":   "0 88% 60%",
  "--destructive-foreground":"210 20% 89%",
  "--border":        "228 14% 17%",
  "--input":         "228 14% 17%",
  "--ring":          "36 100% 50%",
};

const LIGHT_VARS: Record<string, string> = {
  "--cs-bg":         "#f8fafc",
  "--cs-surface":    "#ffffff",
  "--cs-surface2":   "#f1f5f9",
  "--cs-surface3":   "#e8edf4",
  "--cs-border":     "#e2e8f0",
  "--cs-border2":    "#cbd5e1",
  "--cs-text":       "#0f172a",
  "--cs-text-dim":   "#475569",
  "--cs-text-muted": "#94a3b8",
  "--cs-orange":     "#e07800",
  "--cs-green":      "#16a34a",
  "--cs-red":        "#dc2626",
  "--cs-blue":       "#0284c7",
  "--aws-nav":       "#f1f5f9",
  "--aws-surface":   "#f8fafc",
  "--aws-surface-2": "#ffffff",
  "--aws-surface-3": "#f1f5f9",
  "--aws-border":    "#e2e8f0",
  "--aws-border-2":  "#cbd5e1",
  "--aws-text":      "#0f172a",
  "--aws-text-dim":  "#475569",
  "--aws-text-muted":"#94a3b8",
  "--guardduty-orange": "#e07800",
  "--background":    "210 40% 98%",
  "--foreground":    "222 47% 11%",
  "--card":          "0 0% 100%",
  "--card-foreground":"222 47% 11%",
  "--popover":       "0 0% 100%",
  "--popover-foreground":"222 47% 11%",
  "--primary":       "36 100% 50%",
  "--primary-foreground":"0 0% 0%",
  "--secondary":     "210 40% 96%",
  "--secondary-foreground":"222 47% 11%",
  "--muted":         "215 20% 65%",
  "--muted-foreground":"215 16% 47%",
  "--accent":        "36 100% 50%",
  "--accent-foreground":"0 0% 0%",
  "--destructive":   "0 84% 60%",
  "--destructive-foreground":"0 0% 100%",
  "--border":        "214 32% 91%",
  "--input":         "214 32% 91%",
  "--ring":          "36 100% 50%",
};

function applyThemeVars(theme: Theme) {
  const root = document.documentElement;
  const vars = theme === "light" ? LIGHT_VARS : DARK_VARS;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  if (theme === "light") {
    root.classList.add("light");
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  } else {
    root.classList.add("dark");
    root.classList.remove("light");
    root.style.colorScheme = "dark";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem("guardai-theme") as Theme) ?? "dark"; }
    catch { return "dark"; }
  });

  useEffect(() => {
    applyThemeVars(theme);
    try { localStorage.setItem("guardai-theme", theme); } catch {}
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(t => t === "dark" ? "light" : "dark") }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
