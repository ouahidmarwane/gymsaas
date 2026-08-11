-- ============================================================
-- GymFlow — 024 : présence en 1 seule requête (P4)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- Le battement de présence (toutes les 30 s par client connecté) faisait
-- 4-5 requêtes séquentielles (profil, kill, présence, upsert). On regroupe
-- tout dans une fonction RPC qui utilise auth.uid() → un seul aller-retour.
-- Renvoie { revoked, login_at } (pour l'auto-déconnexion / le force-logout).
-- ============================================================

begin;
set local search_path = public, extensions;

create or replace function touch_presence()
returns table (revoked boolean, login_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  pr       record;
  ex       record;
  now_ts   timestamptz := now();
  v_login  timestamptz;
begin
  if v_uid is null then
    return query select false, null::timestamptz; return;
  end if;

  -- Force-déconnexion admin ? → on consomme le kick et on signale la révocation
  if exists (select 1 from session_kills where user_id = v_uid) then
    delete from session_kills  where user_id = v_uid;
    delete from staff_presence where user_id = v_uid;
    return query select true, null::timestamptz; return;
  end if;

  select id, name, email, role, branch, discipline into pr
  from profiles where user_id = v_uid limit 1;
  if not found then
    return query select false, null::timestamptz; return;
  end if;

  select s.login_at, s.last_seen_at into ex
  from staff_presence s where s.user_id = v_uid;

  -- Nouvelle session si aucune ligne ou dernier battement > 2 min 10 s
  if ex.last_seen_at is null or (now_ts - ex.last_seen_at) > interval '130 seconds' then
    v_login := now_ts;
  else
    v_login := ex.login_at;
  end if;

  insert into staff_presence (user_id, profile_id, name, email, role, branch, discipline, login_at, last_seen_at)
  values (v_uid, pr.id, pr.name, pr.email, pr.role, pr.branch, pr.discipline, v_login, now_ts)
  on conflict (user_id) do update
    set profile_id   = excluded.profile_id,
        name         = excluded.name,
        email        = excluded.email,
        role         = excluded.role,
        branch       = excluded.branch,
        discipline   = excluded.discipline,
        login_at     = excluded.login_at,
        last_seen_at = excluded.last_seen_at;

  return query select false, v_login;
end;
$$;

revoke all on function touch_presence() from public, anon;
grant execute on function touch_presence() to authenticated;

commit;
