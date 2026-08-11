-- ============================================================
-- GymFlow — 014 : supervision des connexions (staff_presence)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- Une ligne par utilisateur connecté : heure de connexion (login_at) et
-- dernier "battement" (last_seen_at, rafraîchi ~toutes les 30 s tant que
-- l'onglet est actif). L'admin lit tout → page /supervision.
-- "En ligne" = last_seen_at récent (< ~2 min, aligné sur l'auto-déconnexion).
-- ============================================================

begin;
set local search_path = public, extensions;

create table if not exists staff_presence (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  profile_id   uuid,
  name         text,
  email        text,
  role         text,
  branch       text,
  discipline   text,
  login_at     timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table staff_presence enable row level security;

-- Chacun gère UNIQUEMENT sa propre ligne.
drop policy if exists "presence: self insert" on staff_presence;
create policy "presence: self insert" on staff_presence for insert
  with check (user_id = auth.uid());

drop policy if exists "presence: self update" on staff_presence;
create policy "presence: self update" on staff_presence for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "presence: self delete" on staff_presence;
create policy "presence: self delete" on staff_presence for delete
  using (user_id = auth.uid());

-- Lecture : sa propre ligne, ou TOUT pour l'admin (supervision).
drop policy if exists "presence: read own or admin" on staff_presence;
create policy "presence: read own or admin" on staff_presence for select
  using (user_id = auth.uid() or current_user_role() = 'admin');

commit;
