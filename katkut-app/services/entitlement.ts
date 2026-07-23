import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getLocalProEntitlement } from './purchases';

export interface Entitlement {
  isPro: boolean;
}

const NOT_PRO: Entitlement = { isPro: false };

/**
 * Reads the current user's Pro status. `profiles.is_pro` is set exclusively by a webhook —
 * Stripe's (marketing/api/stripe-webhook.js) on Android/Web, RevenueCat's on iOS — the app never
 * writes it directly (HARD RULE 5). Signed-out users, and signed-in users who've never purchased
 * (no profile row yet), both resolve to isPro: false.
 *
 * On iOS, also falls back to the local RevenueCat receipt when the server says not-Pro: the
 * webhook can lag a few seconds behind a purchase, and without this a user could pay and still
 * see the watermark on their very next export.
 */
export async function getEntitlement(): Promise<Entitlement> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return NOT_PRO;

  const { data, error } = await supabase
    .from('profiles')
    .select('is_pro')
    .eq('id', userId)
    .maybeSingle();

  const serverIsPro = !error && data?.is_pro === true;
  if (serverIsPro) return { isPro: true };

  if (Platform.OS === 'ios') {
    return { isPro: await getLocalProEntitlement() };
  }

  return NOT_PRO;
}
