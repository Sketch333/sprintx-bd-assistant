import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: true, persistSession: true, storage: window.localStorage } },
);

export async function signInWithGoogle(): Promise<void> {
  const redirectTo = chrome.identity.getRedirectURL('supabase-auth');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase did not return an authentication URL.');

  const callbackUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true }, (redirectedUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!redirectedUrl) {
        reject(new Error('Google authentication did not return a callback.'));
        return;
      }
      resolve(redirectedUrl);
    });
  });

  const parsed = new URL(callbackUrl);
  const params = new URLSearchParams(parsed.hash.slice(1) || parsed.search.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) {
    throw new Error(params.get('error_description') ?? 'Authentication callback did not contain a session.');
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (sessionError) throw sessionError;
}
