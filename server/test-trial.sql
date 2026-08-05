create table users (id uuid primary key, email text, role text default 'seller', plan text default 'starter',
  spydeck_addon boolean default false, plan_renews_at timestamptz, plan_auto_renew boolean default true,
  plan_past_due_since timestamptz, plan_paid_plan text, plan_paid_addon boolean default false,
  plan_trial_ends_at timestamptz, plan_trial_used_at timestamptz);
create table wallet_ledger (id bigserial primary key, account text, type text, ref text, delta numeric(12,2),
  note text, partner text, created_by text, created_at timestamptz default now(), unique(account,type,ref));
create table notifications (id bigserial primary key, user_id text, type text, title text, body text, href text, created_at timestamptz default now());
create table audit_log (id bigserial primary key, actor text, action text, entity_type text, entity_id text, before jsonb, after jsonb, created_at timestamptz default now());

-- THE TRAP: trial expired yesterday, wallet holds $500. Must NOT be charged.
insert into users (id,email,role,plan,plan_renews_at,plan_auto_renew,plan_trial_ends_at)
values ('11111111-1111-1111-1111-111111111111','trial@test','seller','pro', now() - interval '1 day', false, now() - interval '1 day');
insert into wallet_ledger (account,type,ref,delta) values ('11111111-1111-1111-1111-111111111111','topup','seed',500);
-- THE CONTROL: a real subscriber, also due, also funded. Must still be charged $29.
insert into users (id,email,role,plan,plan_renews_at,plan_auto_renew)
values ('22222222-2222-2222-2222-222222222222','payer@test','seller','pro', now() - interval '1 day', true);
insert into wallet_ledger (account,type,ref,delta) values ('22222222-2222-2222-2222-222222222222','topup','seed',500);
