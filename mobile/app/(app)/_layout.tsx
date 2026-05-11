// mobile/app/(app)/_layout.tsx
import { Stack } from 'expo-router';
import { useEffect, useRef } from 'react';
import { syncPushToken } from '../../src/lib/pushNotifications';

export default function AppLayout() {
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    syncPushToken().catch(() => { /* silent — user denied or no Google Play Services */ });
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
