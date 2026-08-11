-- ============================================================
-- GymFlow — 020 : durcissement sécurité (search_path RLS + journal d'audit)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
-- ============================================================

begin;
set local search_path = public, extensions;

-- ─── S3 : current_user_role() SECURITY DEFINER doit fixer search_path ──
-- C'est la fonction socle de presque toutes les policies RLS. Sans
-- search_path fixe, c'est un vecteur classique d'élévation de privilèges
-- (« role mutable search_path »).
create or replace function current_user_role()
returns user_role language sql stable security definer
set search_path = public as $$
  select role from profiles where user_id = auth.uid() limit 1;
$$;

-- ─── S7 : le journal d'audit ne doit PAS être insérable par tout utilisateur ──
-- L'app écrit désormais l'audit via le service role (voir logAudit). On retire
-- la policy d'insert ouverte qui permettait à n'importe quel authentifié
-- (y compris un lecteur) de forger des entrées.
drop policy if exists "audit_logs: authenticated insert" on audit_logs;

commit;
