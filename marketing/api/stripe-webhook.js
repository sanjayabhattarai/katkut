// Stripe → Supabase bridge. This is the ONLY place that ever writes profiles.is_pro — the app
// itself never sets it directly (see supabase/migrations/001_profiles_pro_status.sql, RLS denies
// client writes). Requires these env vars set in the Vercel project (marketing):
//   STRIPE_SECRET_KEY          - Stripe secret key
//   STRIPE_WEBHOOK_SECRET      - signing secret for THIS endpoint (Stripe Dashboard > Webhooks)
//   SUPABASE_URL               - same project as the app (EXPO_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY  - service_role key (Supabase Dashboard > Settings > API) — secret,
//                                 bypasses RLS, must never be exposed to the app/client.
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Stripe's signature check needs the exact raw request bytes — must run before any JSON parsing.
module.exports.config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end('Method not allowed');
    return;
  }

  const signature = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      // Fires once, right after the user completes Stripe Checkout. client_reference_id carries
      // the Supabase user id — see marketing/upgrade, which appends it to the Payment Link.
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        if (!userId) {
          console.warn('checkout.session.completed with no client_reference_id — cannot link to a user', session.id);
          break;
        }
        const { error } = await supabase.from('profiles').upsert({
          id: userId,
          email: session.customer_details?.email ?? null,
          is_pro: true,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          stripe_subscription_status: 'active',
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        break;
      }

      // Renewals, cancellations, payment failures — anything that changes subscription.status
      // after the initial checkout. Looked up by subscription id, not user id (session isn't
      // available here).
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const isActive = subscription.status === 'active' || subscription.status === 'trialing';
        const { error } = await supabase
          .from('profiles')
          .update({
            is_pro: isActive,
            stripe_subscription_status: subscription.status,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', subscription.id);
        if (error) throw error;
        break;
      }

      default:
        break; // ignore anything we don't act on
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handler error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};
