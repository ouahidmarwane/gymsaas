-- ============================================================
-- GymFlow — 018 : alertes de sécurité (connexions/actions suspectes)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- Tables pour la détection d'activité suspecte :
--   • security_events : journal (nouvel appareil, brute-force, action refusée)
--   • login_devices   : appareils connus par utilisateur (dédup "nouvel appareil")
--   • login_attempts  : tentatives de connexion échouées (anti-brute-force)
-- Les écritures se font via le service role (server actions) ; l'admin lit
-- security_events / login_devices pour la page /supervision.
-- ============================================================

begin;
set local search_path = public, extensions;

-- ─── Journal des événements de sécurité ──
create table if not exists security_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  profile_id uuid,
  name       text,
  role       text,
  event_type text not null,   -- new_device_login | failed_login_burst | access_denied
  detail     text,
  ip         text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table security_events enable row level security;
drop policy if exists "security_events: admin read" on security_events;
create policy "security_events: admin read" on security_events for select
  using (current_user_role() = 'admin');
create index if not exists idx_security_events_created on security_events (created_at desc);

-- ─── Appareils connus (dédup "nouvel appareil") ──
create table if not exists login_devices (
  user_id    uuid not null,
  device_id  text not null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  last_ip    text,
  user_agent text,
  primary key (user_id, device_id)
);
alter table login_devices enable row level security;
drop policy if exists "login_devices: admin read" on login_devices;
create policy "login_devices: admin read" on login_devices for select
  using (current_user_role() = 'admin');

-- ─── Tentatives de connexion échouées (anti-brute-force) ──
create table if not exists login_attempts (
  id           bigint generated always as identity primary key,
  ip           text,
  identifier   text,
  attempted_at timestamptz not null default now()
);
alter table login_attempts enable row level security;  -- service role uniquement (aucune policy)
create index if not exists idx_login_attempts_ip_time on login_attempts (ip, attempted_at desc);

commit;
