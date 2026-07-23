// RevenueCat → Supabase bridge, the iOS counterpart to stripe-webhook.js. Together they are the
// ONLY two places that ever write profiles.is_pro — the app itself never sets it directly (see
// supabase/migrations/001_profiles_pro_status.sql, RLS denies client writes).
//
// app_user_id in every RevenueCat event IS the Supabase user id, because the app always calls
// Purchases.logIn(supabaseUserId) before any purchase (services/purchases.ts / services/auth.ts —
// see doc/KatKut_5_RevenueCat_IAP_Plan.md Phase D3). No separate user lookup is needed.
//
// Requires these env vars set in the Vercel project (marketing):
//   REVENUECAT_WEBHOOK_AUTH_HEADER - shared secret string, exact match with the "Authorization
//                                     header" value configured in RevenueCat > Integrations >
//                                     Webhooks (Phase E6). RevenueCat has no request-signing
//                                     scheme like Stripe's — this shared string is the only check.
//   SUPABASE_URL                   - same project as the app (EXPO_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY      - service_role key, bypasses RLS. Same var stripe-webhook.js
//                                     already uses.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Events that grant/extend access.
const GRANT_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE']);
// Events that end access. CANCELLATION is deliberately excluded — it means "will not renew", not
// "access ends now"; the user keeps Pro until the period actually expires (EXPIRATION fires then).
const REVOKE_TYPES = new Set(['EXPIRATION', 'REFUND', 'SUBSCRIPTION_PAUSED']);

async function setIsPro(userId, isPro) {
  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    is_pro: isPro,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end('Method not allowed');
    return;
  }

  const authHeader = req.headers['authorization'] || '';
  if (!process.env.REVENUECAT_WEBHOOK_AUTH_HEADER || authHeader !== process.env.REVENUECAT_WEBHOOK_AUTH_HEADER) {
    res.status(401).json({ error: 'Invalid authorization header' });
    return;
  }

  const event = req.body?.event;
  if (!event) {
    res.status(400).json({ error: 'Missing event payload' });
    return;
  }

  const { type, app_user_id: userId } = event;

  // A purchase made before Purchases.logIn() ran would carry RevenueCat's own anonymous id
  // instead of a Supabase uuid — can't write that to profiles.id (FK to auth.users). Should not
  // happen given the app always logs in first (D3), but this is the one place to catch it if it
  // ever does, rather than throwing on a bad FK write.
  if (!userId || userId.startsWith('$RCAnonymousID:')) {
    console.warn(`RevenueCat webhook: ${type} with no linked Supabase user id (${userId}) — skipping`, event.id);
    res.status(200).json({ received: true, skipped: true });
    return;
  }

  try {
    if (GRANT_TYPES.has(type)) {
      await setIsPro(userId, true);
    } else if (REVOKE_TYPES.has(type)) {
      await setIsPro(userId, false);
    }
    // CANCELLATION and anything else (BILLING_ISSUE, TRANSFER, TEST, ...) is intentionally a
    // no-op — nothing to write to profiles for those.

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('RevenueCat webhook handler error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};
