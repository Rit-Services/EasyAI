import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePreferenceSync } from '@/hooks/usePreferenceSync';
import AppRoutes from '@/routes';
import ScrollRestoration from '@/components/ScrollRestoration';

export default function App() {
  const { loadSession } = useAuth();
  useEffect(() => { loadSession(); }, [loadSession]);
  usePreferenceSync();
  return (
    <>
      <ScrollRestoration />
      <AppRoutes />
    </>
  );
}
