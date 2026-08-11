-- ============================================================
-- GymFlow — 015 : force-déconnexion admin d'un compte
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- L'admin peut « kicker » un compte suspect depuis /supervision :
--   1. Révocation SERVEUR : suppression des sessions GoTrue (les refresh
--      tokens cascadent) → le compte ne peut plus rafraîchir son jeton.
--   2. Kick CLIENT : une ligne dans session_kills ; le SessionGuard de la
--      victime la détecte au prochain battement (~30 s) et déconnecte.
-- Note : ce n'est pas un bannissement — si l'attaquant a le mot de passe,
--   il peut se reconnecter (seul le MFA / changement de mot de passe l'en
--   empêche). C'est un « kick » de session.
-- ============================================================

begin;
set local search_path = public, extensions;

-- Table des kicks (consommée par le client à la déconnexion)
create table if not exists session_kills (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  killed_at timestamptz not null default now(),
  killed_by uuid
);

alter table session_kills enable row level security;

-- La victime lit / consomme sa propre ligne ; l'admin peut lire.
drop policy if exists "kills: read own or admin" on session_kills;
create policy "kills: read own or admin" on session_kills for select
  using (user_id = auth.uid() or current_user_role() = 'admin');

drop policy if exists "kills: consume own" on session_kills;
create policy "kills: consume own" on session_kills for delete
  using (user_id = auth.uid());
-- (l'insertion se fait via la fonction security definer ci-dessous)

-- Force-déconnexion d'un compte (admin uniquement).
create or replace function force_logout_user(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_user_role() <> 'admin' then
    raise exception 'Admin uniquement';
  end if;
  -- 1) Révocation serveur : supprime les sessions (refresh tokens en cascade)
  delete from auth.sessions where user_id = uid;
  -- 2) Kick client
  insert into session_kills (user_id, killed_at, killed_by)
    values (uid, now(), auth.uid())
    on conflict (user_id) do update
      set killed_at = excluded.killed_at, killed_by = excluded.killed_by;
  -- 3) Retire la présence
  delete from staff_presence where user_id = uid;
end;
$$;

revoke all on function force_logout_user(uuid) from public, anon;
grant execute on function force_logout_user(uuid) to authenticated;

commit;
