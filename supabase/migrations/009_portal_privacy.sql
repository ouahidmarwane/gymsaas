-- ============================================================
-- GymFlow / Portail des champions — 009 : confidentialité des athlètes
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- PROBLÈMES CONSTATÉS (audit du 2026-08-02)
--
-- 1) Rapports lisibles par tous les athlètes
--    La policy « reports: authenticated read » posée en migration 004
--    autorise la lecture dès que auth.uid() n'est pas null : n'importe
--    quel athlète connecté pouvait donc lire les rapports de TOUS les
--    autres — blessures, poids, sommeil, motivation.
--
-- 2) Rapport falsifiable au nom d'un autre athlète
--    submitWeeklyReport() du portail insère l'objet reçu du client sans
--    vérifier que le member_id correspond bien à l'athlète connecté.
--    La base ne l'imposait pas non plus.
--
-- CORRECTIF
--    La base devient l'arbitre : un athlète ne peut lire et écrire que
--    SES rapports, identifié par la correspondance entre son email de
--    connexion et athlete_accounts. Le personnel (profils GymFlow)
--    garde l'accès complet en lecture.
--    Ainsi, même si le code du portail oublie une vérification, la
--    falsification est bloquée au niveau base.
-- ============================================================

begin;
set local search_path = public, extensions;

-- Un athlète actif, identifié par l'email de sa session
create or replace function is_athlete_of(target_member uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from athlete_accounts aa
    join auth.users u on u.id = auth.uid()
    where aa.member_id = target_member
      and lower(aa.email) = lower(u.email)
      and aa.is_active = true
  );
$$;

-- Un membre du personnel GymFlow (a un profil)
create or replace function is_staff()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from profiles p where p.user_id = auth.uid());
$$;

-- ─── weekly_reports ───────────────────────────────────────────
drop policy if exists "reports: authenticated read" on weekly_reports;
drop policy if exists "reports: staff read all" on weekly_reports;
create policy "reports: staff read all"
  on weekly_reports for select
  using (is_staff());

drop policy if exists "reports: athlete read own" on weekly_reports;
create policy "reports: athlete read own"
  on weekly_reports for select
  using (is_athlete_of(member_id));

-- Insertion : uniquement pour soi-même (bloque la falsification)
drop policy if exists "reports: athlete insert own" on weekly_reports;
create policy "reports: athlete insert own"
  on weekly_reports for insert
  with check (is_athlete_of(member_id));

-- Le portail par jeton (emails de rappel) reste possible s'il est utilisé
drop policy if exists "reports: public insert via token" on weekly_reports;
create policy "reports: public insert via token"
  on weekly_reports for insert
  with check (
    exists (
      select 1 from portal_tokens pt
      where pt.championship_id = weekly_reports.championship_id
        and pt.member_id       = weekly_reports.member_id
        and pt.is_active       = true
        and pt.expires_at      > now()
    )
  );

-- ─── presence : insertion pour soi-même uniquement ────────────
-- La règle « presence: athlete insert own » existait sans clause
-- WITH CHECK vérifiable : on la recrée explicitement pour garantir
-- qu'un athlète ne puisse pas pointer à la place d'un autre.
drop policy if exists "presence: athlete insert own" on presence;
create policy "presence: athlete insert own"
  on presence for insert
  with check (is_athlete_of(member_id));

commit;
