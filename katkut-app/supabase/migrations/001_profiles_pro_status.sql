-- Pro/subscription status, set by the Stripe webhook (marketing/api/stripe-webhook.js) — never
-- written directly by the app or any authenticated client. Run this once in the Supabase SQL editor.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_pro boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_subscription_status text,
  updated_at timestamptz not null default now()
);

create index profiles_stripe_subscription_id_idx on public.profiles (stripe_subscription_id);

alter table public.profiles enable row level security;

-- Signed-in users can read their own Pro status.
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- No insert/update/delete policy for anon/authenticated roles — with RLS enabled and no matching
-- policy, those are denied by default. Only the service role (used exclusively by the webhook,
-- which bypasses RLS) can write to this table, so a client can never grant itself Pro.
