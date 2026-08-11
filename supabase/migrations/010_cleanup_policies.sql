-- ============================================================
-- GymFlow / Portail — 010 : nettoyage des règles redondantes
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- CONTEXTE
-- L'inventaire des policies a montré que le portail disposait DÉJÀ de
-- règles correctes sur weekly_reports :
--   • weekly_reports: admin read all      (admin / receptionist)
--   • weekly_reports: athlete read own    (cloisonné par athlete_accounts)
--   • weekly_reports: athlete insert own  (idem)
--   • weekly_reports: athlete update own  (idem)
--
-- La migration 009 avait ajouté des équivalents, ce qui fait doublon.
-- Surtout, « reports: staff read all » s'appuie sur is_staff(), vrai
-- pour TOUT profil — y compris un lecteur. Or la règle d'origine
-- réservait les rapports aux administrateurs et réceptionnistes.
-- Les policies étant permissives (elles s'additionnent), ma règle
-- élargissait donc l'accès aux données de santé des athlètes.
--
-- On retire les doublons et on conserve les règles d'origine, plus
-- strictes.
--
-- Conservée : « reports: public insert via token », qui couvre le
-- portail par lien signé (aucun jeton actif aujourd'hui, donc sans
-- effet, mais prêt si cette fonctionnalité est utilisée).
-- ============================================================

begin;
set local search_path = public, extensions;

drop policy if exists "reports: staff read all"    on weekly_reports;
drop policy if exists "reports: athlete read own"  on weekly_reports;
drop policy if exists "reports: athlete insert own" on weekly_reports;

commit;
