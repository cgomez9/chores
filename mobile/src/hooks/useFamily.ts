import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type FamilyState =
  | { status: 'loading' }
  | { status: 'no-family' }
  | { status: 'has-family'; familyId: string };

const refetchListeners = new Set<() => void>();

export function refetchFamily() {
  refetchListeners.forEach((fn) => fn());
}

export function useFamily(userId: string | undefined): FamilyState {
  const [state, setState] = useState<FamilyState>({ status: 'loading' });
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    const bump = () => setRefetchToken((t) => t + 1);
    refetchListeners.add(bump);
    return () => { refetchListeners.delete(bump); };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    supabase
      .from('profiles')
      .select('family_id')
      .eq('user_id', userId)
      .eq('type', 'parent')
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('useFamily error', error);
          setState({ status: 'no-family' });
          return;
        }
        setState(data ? { status: 'has-family', familyId: data.family_id } : { status: 'no-family' });
      });

    return () => { cancelled = true; };
  }, [userId, refetchToken]);

  return state;
}
