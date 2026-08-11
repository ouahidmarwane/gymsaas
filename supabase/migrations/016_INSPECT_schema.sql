-- ============================================================
-- INSPECTION (lecture seule) — schéma réel des tables karaté
-- créées hors migrations. Colle les 2 résultats à l'assistant pour
-- générer un 000_baseline.sql fidèle (reproductibilité / DR).
-- ============================================================

-- 1) Colonnes (type, nullable, défaut) dans l'ordre
select table_name, ordinal_position, column_name, data_type,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('grade_sessions', 'championships', 'championship_athletes')
order by table_name, ordinal_position;

-- 2) Clés primaires / étrangères + contraintes CHECK
select tc.table_name, tc.constraint_type, tc.constraint_name,
       kcu.column_name,
       ccu.table_name  as foreign_table,
       ccu.column_name as foreign_column,
       cc.check_clause
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name and kcu.table_schema = 'public'
left join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name and ccu.table_schema = 'public'
       and tc.constraint_type = 'FOREIGN KEY'
left join information_schema.check_constraints cc
       on cc.constraint_name = tc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name in ('grade_sessions', 'championships', 'championship_athletes')
order by tc.table_name, tc.constraint_type;
