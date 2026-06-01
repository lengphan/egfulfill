-- ============================================================================
-- 0002_lock_role.sql — SECURITY FIX (run after schema.sql)
--
-- The base profiles update policy lets a user edit their OWN row — which would
-- also let them change their own `role` and self-promote to admin. This trigger
-- blocks that: a non-admin's attempt to change role is silently reverted. The
-- signup trigger (handle_new_user) is an INSERT, so it's unaffected; admins can
-- still reassign roles.
-- ============================================================================
create or replace function public.prevent_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and public.my_role() <> 'admin' then
    new.role := old.role;   -- keep the existing role; ignore the attempted change
  end if;
  return new;
end $$;

drop trigger if exists profiles_lock_role on public.profiles;
create trigger profiles_lock_role before update on public.profiles
  for each row execute function public.prevent_role_change();
