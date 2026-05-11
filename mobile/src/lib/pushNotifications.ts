import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

export async function registerForPushNotifications(): Promise<string | null> {
  let perm = await Notifications.getPermissionsAsync();
  if (perm.status === 'undetermined') {
    perm = await Notifications.requestPermissionsAsync();
  }
  if (perm.status !== 'granted') return null;
  const token = await Notifications.getExpoPushTokenAsync();
  return token.data;
}

export async function syncPushToken(): Promise<void> {
  const token = await registerForPushNotifications();
  if (token === null) return;
  const { error } = await supabase.rpc('set_push_token', { token });
  if (error) console.warn('set_push_token failed:', error.message);
}
