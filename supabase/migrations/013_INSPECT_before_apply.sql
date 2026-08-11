-- ============================================================
-- INSPECTION (lecture seule) — à lancer AVANT la migration 013
-- Supabase Dashboard → SQL Editor (projet kkzutlkiswwdabqpmgpd)
--
-- Objectif : voir l'état RÉEL de l'isolation des tables karaté
-- (grade_sessions, championships, championship_athletes) que le
-- dépôt ne connaît pas (créées hors migrations).
-- ============================================================

-- 1) RLS activé ou non sur chaque table sensible ?
select c.relname                as table_name,
       c.relrowsecurity         as rls_enabled,
       c.relforcerowsecurity    as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'members','payments','notifications',
    'grade_sessions','championships','championship_athletes'
  )
order by c.relname;

-- 2) Politiques existantes sur les tables karaté (doit être VIDE ou permissif
--    aujourd'hui = fuite possible). cmd = SELECT/INSERT/UPDATE/DELETE/ALL.
select tablename, policyname, cmd, roles, qual as using_expr, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('grade_sessions','championships','championship_athletes')
order by tablename, cmd, policyname;

-- 3) Politique INSERT des paiements (doit inclure branch + discipline après 013)
select policyname, cmd, with_check
from pg_policies
where schemaname = 'public' and tablename = 'payments'
order by cmd, policyname;
