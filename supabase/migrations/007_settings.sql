-- ============================================================
-- GymFlow — 007 : réglages persistants du club
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- Les tarifs de la comptabilité vivaient uniquement dans le state React :
-- toute modification était perdue au rechargement de la page.
-- ============================================================

begin;
set local search_path = public, extensions;

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

alter table app_settings enable row level security;

-- Lecture : tout utilisateur connecté (les tarifs servent à l'affichage)
drop policy if exists "settings: authenticated read" on app_settings;
create policy "settings: authenticated read"
  on app_settings for select
  using (auth.uid() is not null);

-- Écriture : administrateur uniquement
drop policy if exists "settings: admin write" on app_settings;
create policy "settings: admin write"
  on app_settings for all
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

-- Valeurs par défaut (celles utilisées jusqu'ici dans l'interface)
insert into app_settings (key, value)
values ('prices', '{"monthly": 100, "insurance": 50, "registration": 150}'::jsonb)
on conflict (key) do nothing;

commit;
