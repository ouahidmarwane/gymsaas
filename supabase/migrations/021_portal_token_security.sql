-- ============================================================
-- GymFlow — 021 : sécurisation des tokens du portail (faille 🔴 S1)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- PROBLÈME : la policy anon "tokens: public verify" sur portal_tokens
-- (using is_active and expires_at > now()) ne filtre PAS par le token
-- présenté → un anonyme lisait TOUS les tokens actifs (liaisons
-- athlète↔championnat). Et "reports: public insert via token" laissait
-- insérer un rapport pour n'importe quel (championnat, membre) ayant un
-- token actif, sans détenir le token.
--
-- CORRECTIF : accès anonyme UNIQUEMENT via des fonctions SECURITY DEFINER
-- qui prennent le token en argument et n'agissent que sur SA ligne.
-- On retire ensuite les policies anonymes globales.
--
-- ⚠️ APRÈS : tester /portal/<token> (lecture du nom + envoi du rapport).
--    Si l'app portail championnats (Project_salle) utilise un accès ANON
--    direct à portal_tokens/weekly_reports, la migrer vers ces fonctions.
--    (Les athlètes CONNECTÉS passent par les policies is_athlete_of,
--     non concernées.)
-- ============================================================

begin;
set local search_path = public, extensions;

-- Vérifie un token et renvoie UNIQUEMENT sa ligne (pas d'énumération)
create or replace function verify_portal_token(p_token text)
returns table (championship_id uuid, member_id uuid, championship_name text)
language sql stable security definer set search_path = public as $$
  select t.championship_id, t.member_id, c.name
  from portal_tokens t
  join championships c on c.id = t.championship_id
  where t.token = p_token and t.is_active and t.expires_at > now()
  limit 1;
$$;

-- Soumission d'un rapport hebdo via token : championship_id/member_id sont
-- DÉRIVÉS du token (impossible de les usurper depuis le client).
create or replace function submit_weekly_report(p_token text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_champ uuid;
  v_member uuid;
begin
  select championship_id, member_id into v_champ, v_member
  from portal_tokens
  where token = p_token and is_active and expires_at > now()
  limit 1;
  if v_champ is null then
    raise exception 'Lien invalide ou expiré' using errcode = 'P0001';
  end if;

  insert into weekly_reports (
    championship_id, member_id, week_number,
    has_injury, injury_description, training_feeling, sleep_time, sleep_duration,
    wants_improvement, improvement_description, nutrition_ok, nutrition_notes,
    motivation_level, weight_kg, athlete_notes
  ) values (
    v_champ, v_member,
    coalesce((p_payload->>'week_number')::int, extract(week from now())::int),
    coalesce((p_payload->>'has_injury')::boolean, false),
    p_payload->>'injury_description',
    (p_payload->>'training_feeling')::int,
    p_payload->>'sleep_time',
    (p_payload->>'sleep_duration')::int,
    coalesce((p_payload->>'wants_improvement')::boolean, false),
    p_payload->>'improvement_description',
    coalesce((p_payload->>'nutrition_ok')::boolean, true),
    p_payload->>'nutrition_notes',
    (p_payload->>'motivation_level')::int,
    nullif(p_payload->>'weight_kg', '')::numeric,
    p_payload->>'athlete_notes'
  );
end;
$$;

grant execute on function verify_portal_token(text)          to anon, authenticated;
grant execute on function submit_weekly_report(text, jsonb)  to anon, authenticated;

-- Retrait des accès anonymes globaux (remplacés par les fonctions ci-dessus)
drop policy if exists "tokens: public verify"        on portal_tokens;
drop policy if exists "reports: public insert via token" on weekly_reports;

commit;
