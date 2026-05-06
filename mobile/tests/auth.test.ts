import { signUp, signIn, signOut, requestPasswordReset } from '../src/lib/auth';
import { supabase } from '../src/lib/supabase';

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      resetPasswordForEmail: jest.fn(),
    },
  },
}));

const mocked = supabase.auth as jest.Mocked<typeof supabase.auth>;

beforeEach(() => jest.clearAllMocks());

describe('signUp', () => {
  it('calls supabase.auth.signUp with the given credentials', async () => {
    mocked.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null } as any);
    await signUp('a@b.com', 'pw12345!');
    expect(mocked.signUp).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw12345!' });
  });

  it('throws when supabase returns an error', async () => {
    mocked.signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'bad' } } as any);
    await expect(signUp('a@b.com', 'pw')).rejects.toThrow('bad');
  });
});

describe('signIn', () => {
  it('calls signInWithPassword', async () => {
    mocked.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: null } as any);
    await signIn('a@b.com', 'pw');
    expect(mocked.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw' });
  });
});

describe('signOut', () => {
  it('calls supabase.auth.signOut', async () => {
    mocked.signOut.mockResolvedValue({ error: null } as any);
    await signOut();
    expect(mocked.signOut).toHaveBeenCalled();
  });
});

describe('requestPasswordReset', () => {
  it('calls resetPasswordForEmail with redirect URL', async () => {
    mocked.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null } as any);
    await requestPasswordReset('a@b.com');
    expect(mocked.resetPasswordForEmail).toHaveBeenCalledWith('a@b.com', expect.any(Object));
  });
});
