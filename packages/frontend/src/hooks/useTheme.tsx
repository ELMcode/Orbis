import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';
const THEME_KEY = 'orbis_theme';
const LEGACY_THEME_KEY = 'orbis_theme';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = (localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY)) as Theme | null;
    if (saved) return saved;
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const value: ThemeCtx = {
    theme,
    toggle: () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')),
    setTheme: setThemeState,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme doit être utilisé dans <ThemeProvider>');
  return ctx;
}
