import { useEffect } from 'react';
import { userApi } from '@/apis/userApi';
import { useAuthStore } from '@/store/authStore';
import { savedLang, useLangStore } from '@/store/langStore';
import { savedTheme, useThemeStore } from '@/store/themeStore';

// A failed save is not worth interrupting anyone for: the browser copy still
// holds the choice for this device.
const save = (data) => userApi.updatePreferences(data).catch(() => {});

// Language and theme are saved on the account so they follow the person to any
// browser or device. The browser keeps its own copy for signed-out pages and so
// the first paint is right. Mounted once, in App.
export function usePreferenceSync() {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!userId) return undefined;
    const { language, theme } = useAuthStore.getState().user;

    // On sign-in the account wins. An account with no choice yet takes the one
    // made in this browser. With neither, nothing is saved, so a default never
    // becomes a choice and the theme keeps following the device.
    const fromBrowser = {};
    if (language) useLangStore.getState().setLang(language);
    else if (savedLang()) fromBrowser.language = savedLang();
    if (theme) useThemeStore.getState().setTheme(theme);
    else if (savedTheme()) fromBrowser.theme = savedTheme();
    if (Object.keys(fromBrowser).length) save(fromBrowser);

    // Subscribed after applying the account's values, so only real changes save.
    const stopLang = useLangStore.subscribe((s, prev) => {
      if (s.lang !== prev.lang) save({ language: s.lang });
    });
    const stopTheme = useThemeStore.subscribe((s, prev) => {
      if (s.theme !== prev.theme) save({ theme: s.theme });
    });
    return () => { stopLang(); stopTheme(); };
  }, [userId]);
}
