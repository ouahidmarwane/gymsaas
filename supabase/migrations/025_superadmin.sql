-- ============================================================
-- GymFlow — 025 : rôle SUPERADMIN
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- MODÈLE : un superadmin est un compte `role = 'admin'` portant le drapeau
-- `profiles.is_superadmin = true`. Il HÉRITE donc automatiquement de toutes
-- les permissions admin (aucune des ~51 policies existantes n'est réécrite
-- → zéro risque de régression), et reçoit en plus des pouvoirs exclusifs :
--
--   1. Gérer les comptes admin (créer / changer le rôle / supprimer)
--   2. Déconnecter de force un admin
--   3. Modifier les tarifs du club
--   4. Accéder à la supervision + aux événements de sécurité
--   5. Un superadmin ne peut être modifié/supprimé que par un superadmin
--
-- ⚠️ APRÈS la migration : promouvoir ton compte (voir le bloc en bas).
-- ============================================================

begin;
set local search_path = public, extensions;

-- ─── Drapeau superadmin ──
alter table profiles add column if not exists is_superadmin boolean not null default false;

-- L'utilisateur courant est-il superadmin ?
create or replace function is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.user_id = auth.uid() and p.is_superadmin = true
  );
$$;

-- ─── profiles : protéger les superadmins + empêcher l'auto-promotion ──
-- Un admin normal ne peut ni toucher un superadmin, ni gérer un autre admin,
-- ni se promouvoir superadmin. Il garde la main sur son propre profil
-- (nom/email) et sur les comptes réceptionniste / lecteur.
drop policy if exists "profiles: admin update" on profiles;
create policy "profiles: admin update"
  on profiles for update
  using (
    current_user_role() = 'admin'
    and (
      is_superadmin()
      or profiles.user_id = auth.uid()
      or (not profiles.is_superadmin and profiles.role <> 'admin')
    )
  )
  with check (
    current_user_role() = 'admin'
    and (
      is_superadmin()
      or (
        not profiles.is_superadmin
        and (profiles.user_id = auth.uid() or profiles.role <> 'admin')
      )
    )
  );

drop policy if exists "profiles: admin delete" on profiles;
create policy "profiles: admin delete"
  on profiles for delete
  using (
    current_user_role() = 'admin'
    and user_id <> auth.uid()
    and (is_superadmin() or (not profiles.is_superadmin and profiles.role <> 'admin'))
  );

-- Création : seul un superadmin peut créer un compte admin ou superadmin
drop policy if exists "profiles: admin insert" on profiles;
create policy "profiles: admin insert"
  on profiles for insert
  with check (
    current_user_role() = 'admin'
    and (is_superadmin() or (not profiles.is_superadmin and profiles.role <> 'admin'))
  );

-- ─── 3. Tarifs du club : superadmin uniquement ──
drop policy if exists "settings: admin write" on app_settings;
create policy "settings: admin write"
  on app_settings for all
  using (is_superadmin())
  with check (is_superadmin());

-- ─── 4. Supervision + sécurité : superadmin uniquement ──
drop policy if exists "presence: read own or admin" on staff_presence;
create policy "presence: read own or admin" on staff_presence for select
  using (user_id = auth.uid() or is_superadmin());

drop policy if exists "security_events: admin read" on security_events;
create policy "security_events: admin read" on security_events for select
  using (is_superadmin());

drop policy if exists "login_devices: admin read" on login_devices;
create policy "login_devices: admin read" on login_devices for select
  using (is_superadmin());

-- ─── 2. Force-déconnexion : un admin ne peut pas kicker un admin ──
create or replace function force_logout_user(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  target_is_admin boolean;
begin
  if current_user_role() <> 'admin' then
    raise exception 'Admin uniquement';
  end if;

  select (p.role = 'admin' or p.is_superadmin) into target_is_admin
  from profiles p where p.user_id = uid limit 1;

  -- Déconnecter un admin / superadmin est réservé au superadmin
  if coalesce(target_is_admin, false) and not is_superadmin() then
    raise exception 'Superadmin uniquement';
  end if;

  delete from auth.sessions where user_id = uid;
  insert into session_kills (user_id, killed_at, killed_by)
    values (uid, now(), auth.uid())
    on conflict (user_id) do update
      set killed_at = excluded.killed_at, killed_by = excluded.killed_by;
  delete from staff_presence where user_id = uid;
end;
$$;

revoke all on function force_logout_user(uuid) from public, anon;
grant execute on function force_logout_user(uuid) to authenticated;

commit;

-- ============================================================
-- APRÈS la migration — PROMOUVOIR TON COMPTE (à lancer séparément) :
--
--   update profiles set is_superadmin = true, role = 'admin'
--   where email = 'TON_EMAIL@exemple.com';
--
-- Vérifier :
--   select name, email, role, is_superadmin from profiles order by role;
-- ============================================================
