import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

const DELETE_ACCOUNT_URL = 'https://katkut.app/api/delete-account';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

/** Current signed-in user, or null if signed out. Name/avatar come from the Google profile. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? null,
    name: meta.full_name ?? meta.name ?? null,
    avatarUrl: meta.avatar_url ?? meta.picture ?? null,
  };
}

export async function signInWithGoogle() {
  const redirectTo = Linking.createURL('auth/callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    throw new Error('Google sign-in was cancelled or failed.');
  }

  const url = new URL(result.url.replace('#', '?'));
  const access_token = url.searchParams.get('access_token');
  const refresh_token = url.searchParams.get('refresh_token');
  if (!access_token || !refresh_token) {
    throw new Error('No session tokens returned from Supabase.');
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (sessionError) throw sessionError;
}

// Apple guideline 4.8: an app offering third-party sign-in (Google) must also offer Sign in with
// Apple. Uses the native ID-token flow, not a browser redirect — Supabase verifies the token
// directly (auth.signInWithIdToken), so there's no callback URL to configure.
//
// Deliberately omits the OpenID `nonce` param: expo-apple-authentication and Supabase both make it
// optional, and getting the raw-vs-SHA256-hashed nonce convention wrong between the two is a common
// source of a silent, hard-to-debug "nonce mismatch" auth failure that can't be caught by
// type-checking. This is a native (non-browser-redirect) flow, so the replay-attack surface a
// nonce defends against is already much smaller than the web-redirect case. Add nonce+hashing
// later if stronger replay protection is wanted, verified on a real device.
export async function signInWithApple() {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    // User dismissed the Apple sheet — not an error worth surfacing, same as closing any other
    // sign-in prompt.
    if (e instanceof Error && 'code' in e && e.code === 'ERR_REQUEST_CANCELED') return;
    throw e;
  }

  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token.');
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Permanently deletes the signed-in user's account (Apple guideline 5.1.1(v) / Google Play's
 * equivalent in-app account deletion requirement). The server verifies the caller's own access
 * token (never trusts a client-supplied id — see marketing/api/delete-account.js), cancels any
 * active Stripe subscription, then deletes the Supabase auth user (profiles row cascades away).
 * Signs out locally on success, since the account no longer exists either way. */
export async function deleteAccount(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('Not signed in.');

  const response = await fetch(DELETE_ACCOUNT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `Delete failed (${response.status})`);
  }
  await supabase.auth.signOut();
}
