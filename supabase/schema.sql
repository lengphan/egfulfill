-- ============================================================================
-- EGFULFILL — Supabase schema (paste into Supabase → SQL Editor → Run)
-- Architecture: browser → supabase-js → Postgres, permissions enforced by RLS.
-- Mirrors the EGStore localStorage keys so EGStore can be reimplemented on top.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY guards.
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";          -- gen_random_uuid()

-- ── Roles enum + helpers ────────────────────────────────────────────────────
do $$ begin
  create type eg_role as enum ('seller','operator','admin','warehouse','designer');
exception when duplicate_object then null; end $$;

-- ── Profiles (extends auth.users) ───────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        eg_role not null default 'seller',
  name        text,
  email       text,
  store_name  text,                       -- sellers
  plan        text default 'free',        -- eg_seller_plan
  settings    jsonb default '{}'::jsonb,  -- autotopup, notif prefs, etc.
  created_at  timestamptz default now()
);

-- Role lookup that BYPASSES rls (security definer) so policies don't recurse.
create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public as $$
  select role::text from public.profiles where id = auth.uid()
$$;
create or replace function public.is_factory() returns boolean
  language sql stable as $$ select public.my_role() in ('operator','admin','warehouse') $$;
create or replace function public.is_staff() returns boolean
  language sql stable as $$ select public.my_role() in ('operator','admin','warehouse','designer') $$;

-- Auto-create a profile row whenever someone signs up. Role comes from the
-- signUp options.data.role (user_metadata); defaults to seller.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, name, email, store_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::eg_role, 'seller'),
    new.raw_user_meta_data->>'name',
    new.email,
    new.raw_user_meta_data->>'store_name'
  ) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at helper
create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ── Core: orders + items ────────────────────────────────────────────────────
create table if not exists public.orders (
  id              text primary key,             -- 'FF-7015'
  seller_id       uuid references public.profiles(id) on delete set null,
  store           text,
  source          text default 'manual',
  customer        jsonb default '{}'::jsonb,     -- {name,email}
  address         jsonb default '{}'::jsonb,     -- {name,line1,city,state,zip}
  status          text default 'new',            -- seller-facing
  factory_status  text default 'new',            -- factory pipeline
  total           numeric default 0,
  profit          numeric default 0,
  delivery        text,
  carrier         text,
  service         text,
  tracking        text,
  tracking_label_url text,
  timeline        jsonb default '[]'::jsonb,
  notes           jsonb default '[]'::jsonb,
  gates           jsonb default '{}'::jsonb,
  est_delivery    date,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists orders_seller_idx on public.orders(seller_id);
create index if not exists orders_status_idx on public.orders(factory_status);
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

create table if not exists public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       text references public.orders(id) on delete cascade,
  sku            text,
  name           text,
  listing        text,
  print_type     text,                 -- dtg/emb/dtf/...
  qty            int default 1,
  color          text,
  size           text,
  variant        text,
  blank          text,
  unit_price     numeric default 0,
  design_src     text,                 -- template/design-lab/upload
  factory_status text default '',       -- ''/working/done  (eg_item_factory_status)
  threads        jsonb default '[]'::jsonb,  -- eg_thread_colors [{code,name,hex}]
  design_pos     jsonb,
  img            text,
  created_at     timestamptz default now()
);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_sku_idx on public.order_items(sku);

-- ── Design boards ───────────────────────────────────────────────────────────
create table if not exists public.design_cards (
  id            bigint generated by default as identity primary key,
  order_id      text references public.orders(id) on delete cascade,
  sku           text,
  design_id     text,                 -- DSN-001
  title         text,
  col           text default 'incoming', -- incoming/inprogress/review/approved/paid
  type          text,                 -- board: dtg/emb/...
  product       text,
  priority      text default 'normal',
  due           date,
  assignee      text,
  claimed_by    text,                 -- credited on admin/warehouse approval
  payment       numeric default 0,
  pay_status    text default 'pending',
  is_emb        boolean default false,
  emb_file_name text,
  thumb         text,
  thumb_ref     text,
  files         jsonb default '[]'::jsonb,
  specs         jsonb default '{}'::jsonb,
  notes         jsonb default '[]'::jsonb,
  history       jsonb default '[]'::jsonb,
  checklist     jsonb default '[]'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists design_cards_order_idx on public.design_cards(order_id, sku);
drop trigger if exists design_cards_touch on public.design_cards;
create trigger design_cards_touch before update on public.design_cards for each row execute function public.touch_updated_at();

-- DSN-### counter
create sequence if not exists public.design_id_seq;

-- ── Catalog + inventory ─────────────────────────────────────────────────────
create table if not exists public.catalog_products (
  id            text primary key,
  name          text not null,
  sku           text,                 -- base sku
  type          text,
  method        text,
  status        text default 'Active', -- Active/Draft (only Active shown to sellers)
  base_price    numeric default 0,
  price         numeric default 0,
  variant_skus  jsonb default '[]'::jsonb,  -- [{sku,color,size,stock}]
  size_prices   jsonb default '[]'::jsonb,
  color_images  jsonb default '{}'::jsonb,  -- {color: storage_path}
  side_mockups  jsonb default '{}'::jsonb,
  mockup_path   text,
  img_path      text,
  main_color    text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
drop trigger if exists catalog_touch on public.catalog_products;
create trigger catalog_touch before update on public.catalog_products for each row execute function public.touch_updated_at();

create table if not exists public.inventory (
  sku        text primary key,
  name       text,
  variant    text,
  in_stock   int default 0,
  reserved   int default 0,
  reorder_at int default 25,
  category   text,
  updated_at timestamptz default now()
);
drop trigger if exists inventory_touch on public.inventory;
create trigger inventory_touch before update on public.inventory for each row execute function public.touch_updated_at();

-- ── Purchasing / backorders ─────────────────────────────────────────────────
create table if not exists public.backorders (
  id         uuid primary key default gen_random_uuid(),
  order_id   text references public.orders(id) on delete cascade,
  items      jsonb default '[]'::jsonb,
  status     text default 'open',
  created_at timestamptz default now()
);
create table if not exists public.purchase_orders (
  num        text primary key,
  supplier   text,
  items      jsonb default '[]'::jsonb,
  status     text default 'draft',
  total      numeric default 0,
  created_at timestamptz default now()
);

-- ── Wallets + ledger (factory / designer / seller balances) ─────────────────
create table if not exists public.wallets (
  owner_id   uuid primary key references public.profiles(id) on delete cascade,
  balance    numeric default 0,
  updated_at timestamptz default now()
);
drop trigger if exists wallets_touch on public.wallets;
create trigger wallets_touch before update on public.wallets for each row execute function public.touch_updated_at();

create table if not exists public.ledger (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references public.profiles(id) on delete cascade,
  type       text,                 -- earning/payout/charge/refund
  amount     numeric not null,
  card_id    bigint,
  order_id   text,
  label      text,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists ledger_owner_idx on public.ledger(owner_id);

-- ── Chat ────────────────────────────────────────────────────────────────────
create table if not exists public.order_messages (
  id          uuid primary key default gen_random_uuid(),
  order_id    text references public.orders(id) on delete cascade,
  sender_id   uuid references public.profiles(id) on delete set null,
  sender_role text,
  body        text,
  attachment  jsonb,                -- {name, path, mime}
  created_at  timestamptz default now()
);
create index if not exists order_messages_order_idx on public.order_messages(order_id, created_at);

create table if not exists public.message_reads (
  order_id   text,
  user_id    uuid references public.profiles(id) on delete cascade,
  last_seen  timestamptz default now(),
  primary key (order_id, user_id)
);

-- ── Broadcasts / scan history ───────────────────────────────────────────────
create table if not exists public.broadcasts (
  id         uuid primary key default gen_random_uuid(),
  title      text,
  body       text,
  category   text,
  by_role    text,
  by_id      uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
create table if not exists public.scan_history (
  id         uuid primary key default gen_random_uuid(),
  sku        text,
  direction  text,                 -- in/out
  qty        int default 1,
  order_ref  text,
  by_id      uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- ── Design files (metadata; bytes live in Storage bucket 'designs') ─────────
create table if not exists public.design_files (
  order_id    text,
  sku         text,
  kind        text,                 -- emb / raw / composite
  storage_path text,
  file_name   text,
  mime        text,
  created_at  timestamptz default now(),
  primary key (order_id, sku, kind)
);
create table if not exists public.emb_paid (
  order_id   text,
  sku        text,
  seller_id  uuid references public.profiles(id) on delete set null,
  paid_at    timestamptz default now(),
  primary key (order_id, sku)
);

-- ── Global settings (fee rates, shipping defaults, plan tiers, etc.) ────────
create table if not exists public.settings (
  key        text primary key,      -- eg_designer_fee_rate, eg_default_shipping_fee, ...
  value      jsonb,
  updated_at timestamptz default now()
);
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.profiles        enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.design_cards    enable row level security;
alter table public.catalog_products enable row level security;
alter table public.inventory       enable row level security;
alter table public.backorders      enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.wallets         enable row level security;
alter table public.ledger          enable row level security;
alter table public.order_messages  enable row level security;
alter table public.message_reads   enable row level security;
alter table public.broadcasts      enable row level security;
alter table public.scan_history    enable row level security;
alter table public.design_files    enable row level security;
alter table public.emb_paid        enable row level security;
alter table public.settings        enable row level security;

-- profiles: anyone authenticated can read names; you edit only your own.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for update to authenticated using (id = auth.uid());

-- orders: seller owns theirs; staff (factory + designer) see all; staff update all.
drop policy if exists orders_seller_rw on public.orders;
create policy orders_seller_rw on public.orders for all to authenticated
  using (seller_id = auth.uid() or public.is_staff())
  with check (seller_id = auth.uid() or public.is_factory());

-- order_items: follow the parent order's visibility.
drop policy if exists order_items_rw on public.order_items;
create policy order_items_rw on public.order_items for all to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.seller_id = auth.uid() or public.is_staff())))
  with check (public.is_factory() or exists (select 1 from public.orders o where o.id = order_id and o.seller_id = auth.uid()));

-- design_cards: staff full; seller read of their order's cards.
drop policy if exists design_cards_staff on public.design_cards;
create policy design_cards_staff on public.design_cards for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists design_cards_seller_read on public.design_cards;
create policy design_cards_seller_read on public.design_cards for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.seller_id = auth.uid()));

-- catalog: staff full; sellers read Active products only.
drop policy if exists catalog_staff on public.catalog_products;
create policy catalog_staff on public.catalog_products for all to authenticated
  using (public.is_factory()) with check (public.is_factory());
drop policy if exists catalog_seller_read on public.catalog_products;
create policy catalog_seller_read on public.catalog_products for select to authenticated
  using (status = 'Active');

-- inventory / purchasing / scan: factory only.
drop policy if exists inventory_factory on public.inventory;
create policy inventory_factory on public.inventory for all to authenticated
  using (public.is_factory()) with check (public.is_factory());
drop policy if exists backorders_factory on public.backorders;
create policy backorders_factory on public.backorders for all to authenticated
  using (public.is_factory()) with check (public.is_factory());
drop policy if exists po_factory on public.purchase_orders;
create policy po_factory on public.purchase_orders for all to authenticated
  using (public.is_factory()) with check (public.is_factory());
drop policy if exists scan_factory on public.scan_history;
create policy scan_factory on public.scan_history for all to authenticated
  using (public.is_factory()) with check (public.is_factory());

-- wallets/ledger: you read your own; admin reads all. Writes via service role
-- (Vercel function) — no client write policy on purpose.
drop policy if exists wallets_own on public.wallets;
create policy wallets_own on public.wallets for select to authenticated
  using (owner_id = auth.uid() or public.my_role() = 'admin');
drop policy if exists ledger_own on public.ledger;
create policy ledger_own on public.ledger for select to authenticated
  using (owner_id = auth.uid() or public.my_role() = 'admin');

-- order_messages: participants = the order's seller + any staff.
drop policy if exists msg_rw on public.order_messages;
create policy msg_rw on public.order_messages for all to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.seller_id = auth.uid() or public.is_staff())))
  with check (sender_id = auth.uid());
drop policy if exists reads_self on public.message_reads;
create policy reads_self on public.message_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- broadcasts: everyone reads; factory creates.
drop policy if exists bc_read on public.broadcasts;
create policy bc_read on public.broadcasts for select to authenticated using (true);
drop policy if exists bc_write on public.broadcasts;
create policy bc_write on public.broadcasts for insert to authenticated with check (public.is_factory());

-- design_files / emb_paid: staff full; seller reads own order's rows.
drop policy if exists df_staff on public.design_files;
create policy df_staff on public.design_files for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists df_seller_read on public.design_files;
create policy df_seller_read on public.design_files for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.seller_id = auth.uid()));
drop policy if exists emb_paid_rw on public.emb_paid;
create policy emb_paid_rw on public.emb_paid for all to authenticated
  using (public.is_staff() or seller_id = auth.uid())
  with check (public.is_factory() or seller_id = auth.uid());

-- settings: everyone reads; admin writes.
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (true);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ============================================================================
-- STORAGE buckets
-- ============================================================================
insert into storage.buckets (id, name, public) values ('product-images','product-images', true)  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('designs','designs', false)                on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('chat','chat', false)                      on conflict (id) do nothing;

-- product-images: public read, factory writes.
drop policy if exists prodimg_read on storage.objects;
create policy prodimg_read on storage.objects for select using (bucket_id = 'product-images');
drop policy if exists prodimg_write on storage.objects;
create policy prodimg_write on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_factory());

-- designs + chat: any authenticated user can read/write (tighten later by path).
drop policy if exists designs_rw on storage.objects;
create policy designs_rw on storage.objects for all to authenticated
  using (bucket_id in ('designs','chat')) with check (bucket_id in ('designs','chat'));

-- ============================================================================
-- Seed a couple of global settings (optional)
-- ============================================================================
insert into public.settings (key, value) values
  ('eg_designer_fee_rate',     '2.5'::jsonb),
  ('eg_default_shipping_fee',  '5'::jsonb),
  ('eg_default_addl_item_fee', '2'::jsonb)
on conflict (key) do nothing;

-- Done. Enable Realtime for the tables you want live cross-board sync on:
--   Dashboard → Database → Replication → add: orders, order_items, design_cards,
--   inventory, order_messages, broadcasts, scan_history.
