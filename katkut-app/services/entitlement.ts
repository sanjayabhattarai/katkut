import { supabase } from './supabase';

export interface Entitlement {
  isPro: boolean;
}

const NOT_PRO: Entitlement = { isPro: false };

/**
 * Reads the current user's Pro status from Supabase. `profiles.is_pro` is set exclusively by the
 * Stripe webhook (marketing/api/stripe-webhook.js) after a successful checkout — the app never
 * writes it (HARD RULE 5: no IAP, Pro is sold on the web). Signed-out users, and signed-in users
 * who've never purchased (no profile row yet), both resolve to isPro: false.
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

  if (error || !data) return NOT_PRO;
  return { isPro: data.is_pro === true };
}
