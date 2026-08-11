-- ============================================================
-- GymFlow — 005 : durcissement des accès
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd)
--
-- Le journal d'audit devient réservé à l'administrateur : on retire
-- la policy qui permettait aux réceptionnistes de le lire directement
-- via l'API. (L'interface le cache déjà ; ceci ferme aussi la porte API.)
-- ============================================================
drop policy if exists "audit_logs: recep read own branch" on audit_logs;
