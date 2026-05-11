import { registerForPushNotifications, syncPushToken } from '../src/lib/pushNotifications';
import * as Notifications from 'expo-notifications';
import { supabase } from '../src/lib/supabase';

jest.mock('expo-notifications');
jest.mock('../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn().mockResolvedValue({ error: null }) },
}));

describe('pushNotifications', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when permission is denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    const token = await registerForPushNotifications();
    expect(token).toBeNull();
  });

  it('returns the Expo push token when permission is granted', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    const token = await registerForPushNotifications();
    expect(token).toBe('ExponentPushToken[abc]');
  });

  it('syncPushToken calls set_push_token RPC with the returned token', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[xyz]' });
    await syncPushToken();
    expect(supabase.rpc).toHaveBeenCalledWith('set_push_token', { token: 'ExponentPushToken[xyz]' });
  });
});
