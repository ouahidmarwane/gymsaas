-- ============================================================
-- GymFlow — 022 : performance (index + purge automatique des logs)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
-- ============================================================

begin;
set local search_path = public, extensions;

-- ─── P8 : index sur colonnes filtrées fréquemment ──
create index if not exists idx_members_branch          on members (branch);
create index if not exists idx_members_discipline       on members (discipline);
create index if not exists idx_grade_sessions_member    on grade_sessions (member_id);
create index if not exists idx_security_events_type_ip   on security_events (event_type, ip);
create index if not exists idx_security_events_type_user on security_events (event_type, user_id);

-- ─── P7 : purge des tables de logs (croissance illimitée sinon) ──
create or replace function purge_old_logs()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from login_attempts  where attempted_at < now() - interval '90 days';
  delete from security_events where created_at   < now() - interval '180 days';
  delete from telegram_log    where sent_at      < now() - interval '180 days';
  -- Réponses HTTP stockées par pg_net (schéma optionnel selon la version)
  begin
    delete from net._http_response where created < now() - interval '3 days';
  exception when others then null;
  end;
  -- NB : audit_logs et notifications ne sont PAS purgés ici
  -- (historique volontairement conservé ; les notifications sont bornées
  --  par le recalcul quotidien).
end;
$$;

commit;

-- ─── Planification hebdomadaire (dimanche 03:30 UTC) ──
-- (hors transaction : cron.schedule gère sa propre écriture)
do $$
begin
  perform cron.unschedule('purge-old-logs');
exception when others then null;
end $$;

select cron.schedule('purge-old-logs', '30 3 * * 0', 'select purge_old_logs()');
