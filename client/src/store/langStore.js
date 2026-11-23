import { create } from 'zustand';

const KEY = 'aic_lang';

// The language chosen in this browser, if any. Reading can throw when the
// browser blocks site data.
export function savedLang() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

// Default to German (this is a German-market compliance app); a saved choice
// in localStorage still wins for returning users.
const initial = savedLang() || 'de';

export const useLangStore = create((set) => ({
  lang: initial,
  setLang: (lang) => {
    try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
    set({ lang });
  },
}));
