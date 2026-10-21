-- ============================================================================
-- Luminate TEST STORE — database schema
-- Run this ONCE in the SQL editor of a SEPARATE, NEW Supabase project that you
-- create just for testing. Do NOT run it in your Luminate OS / production project.
-- ============================================================================

create extension if not exists pgcrypto;

-- One row per paid Checkout Session. stripe_session_id UNIQUE = idempotency layer #2.
create table if not exists test_store_orders (
  id                       uuid primary key default gen_random_uuid(),
  stripe_session_id        text not null unique,
  stripe_payment_intent_id text,
  customer_email           text,
  customer_name            text,
  shipping                 jsonb,
  currency                 text not null default 'usd',
  amount_total             integer not null check (amount_total >= 0),
  payment_status           text not null,
  fulfillment_status       text not null default 'new'
                             check (fulfillment_status in ('new','processing','shipped','delivered','cancelled')),
  -- Database-level guard: a live-mode payment can never be stored here.
  livemode                 boolean not null default false check (livemode = false),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Purchased products. (order_id, stripe_line_item_id) UNIQUE = idempotency layer #3.
create table if not exists test_store_order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references test_store_orders(id) on delete cascade,
  stripe_line_item_id text not null,
  name                text not null,
  quantity            integer not null check (quantity > 0),
  unit_amount         integer not null,
  amount_total        integer not null,
  created_at          timestamptz not null default now(),
  unique (order_id, stripe_line_item_id)
);

-- Every Stripe event id we have received. PRIMARY KEY on event_id = idempotency layer #1.
create table if not exists test_store_webhook_events (
  event_id     text primary key,
  event_type   text not null,
  status       text not null default 'processing' check (status in ('processing','processed','skipped','failed')),
  error        text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

-- One notification email per order (order_id UNIQUE), with its retry state.
create table if not exists test_store_notifications (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null unique references test_store_orders(id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending','sending','sent','failed','dead')),
  attempts         integer not null default 0,
  last_error       text,
  next_retry_at    timestamptz default now(),
  sent_at          timestamptz,
  resend_email_id  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists test_store_orders_created_idx on test_store_orders (created_at desc);
create index if not exists test_store_notifications_due_idx on test_store_notifications (status, next_retry_at);

-- ── Security ────────────────────────────────────────────────────────────────
-- Row Level Security ON with NO policies = the public anon key and logged-in users can read/write nothing.
-- Only the server (service-role key, which bypasses RLS) can touch these tables.
alter table test_store_orders          enable row level security;
alter table test_store_order_items     enable row level security;
alter table test_store_webhook_events  enable row level security;
alter table test_store_notifications   enable row level security;

revoke all on test_store_orders, test_store_order_items, test_store_webhook_events, test_store_notifications
  from anon, authenticated;
