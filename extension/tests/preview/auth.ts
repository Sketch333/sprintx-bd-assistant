const sample = { access_token: 'synthetic-token', user: { id: 'synthetic-admin' } };
let session: typeof sample | null = sample;
const listeners = new Set<(event: string, session: typeof sample | null) => void>();
export const supabase = { auth: {
  getSession: async () => ({ data: { session }, error: null }),
  onAuthStateChange: (listener: (event: string, session: typeof sample | null) => void) => { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }; },
  signOut: async () => { session = null; listeners.forEach((listener) => listener('SIGNED_OUT', null)); return { error: null }; },
} };
export async function signInWithGoogle() { session = sample; listeners.forEach((listener) => listener('SIGNED_IN', session)); }
