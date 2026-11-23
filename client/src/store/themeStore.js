import { create } from 'zustand';

const KEY = 'aic_theme';

// The theme chosen in this browser, if any. Reading can throw when the browser
// blocks site data.
export function savedTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

function initial() {
  const saved = savedTheme();
  if (saved) return saved;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

// Reflect the theme onto <html data-theme> so the CSS variables switch.
function apply(theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

const start = initial();
apply(start);

export const useThemeStore = create((set, get) => ({
  theme: start,
  setTheme: (theme) => {
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
    apply(theme);
    set({ theme });
  },
  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },
}));
