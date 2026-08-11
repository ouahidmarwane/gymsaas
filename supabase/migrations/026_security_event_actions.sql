-- ============================================================
-- GymFlow — 026 : actions sur les événements de sécurité
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- Permet au superadmin d'AGIR depuis une alerte (/supervision) :
--   • Déconnecter le compte concerné (force_logout_user)
--   • Marquer l'alerte comme traitée / ignorée (handled_at)
-- ============================================================

begin;
set local search_path = public, extensions;

alter table security_events add column if not exists handled_at timestamptz;
alter table security_events add column if not exists handled_by uuid;

-- Le superadmin peut marquer un événement comme traité
drop policy if exists "security_events: admin update" on security_events;
create policy "security_events: admin update" on security_events for update
  using (is_superadmin()) with check (is_superadmin());

-- Les alertes non traitées d'abord
create index if not exists idx_security_events_handled on security_events (handled_at, created_at desc);

commit;
