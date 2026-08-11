-- ============================================================
-- GymFlow — 008 : verrouillage des inscriptions
--                 + réparation des comptes athlètes
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- ⚠️ À EXÉCUTER EN PRIORITÉ : sans cette migration, la création d'un
-- compte athlète depuis le portail des champions échoue.
--
-- DEUX PROBLÈMES CORRIGÉS ICI
--
-- 1) Comptes athlètes cassés (régression de la migration 004)
--    Le portail des champions crée ses comptes avec
--    user_metadata = { role: 'athlete', member_id: … }.
--    Le trigger restauré en 004 tentait de convertir ce rôle en type
--    user_role, qui n'accepte que admin / receptionist / viewer :
--    la conversion échouait et faisait échouer TOUTE la création de
--    compte (« Database error creating new user »).
--
-- 2) Inscription publique
--    Le trigger créait un profil pour tout nouvel utilisateur, avec
--    role='viewer' et branch=NULL. Or la policy de lecture des membres
--    accorde « toutes les succursales » quand branch is null : un
--    inconnu qui s'inscrivait pouvait lire tout le fichier membres.
--
-- SOLUTION COMMUNE
--    Un profil de personnel n'est créé QUE si les métadonnées portent
--    un rôle de personnel valide. Dans tous les autres cas — athlète du
--    portail, inscription spontanée — le compte est créé normalement
--    mais SANS profil, donc sans aucun accès aux données de gestion
--    (toutes les policies exigent un profil).
--
--    Les athlètes ne sont pas concernés : leur accès passe par la table
--    athlete_accounts, pas par profiles.
-- ============================================================

begin;
set local search_path = public, extensions;

create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  r text := new.raw_user_meta_data->>'role';
begin
  -- Rôles de personnel uniquement. Tout le reste (athlete, null,
  -- valeur inconnue) ne reçoit pas de profil — et surtout ne fait plus
  -- échouer la création du compte.
  if r is null or r not in ('admin', 'receptionist', 'viewer') then
    return new;
  end if;

  insert into profiles (user_id, name, email, role, branch)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'Utilisateur'),
    new.email,
    r::user_role,
    case
      when new.raw_user_meta_data->>'branch' in ('sbata', 'rachad') then new.raw_user_meta_data->>'branch'
      else null
    end
  );
  return new;
exception
  when others then
    -- Un profil qui échoue ne doit jamais empêcher la création du
    -- compte d'authentification (le portail des champions en dépend).
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

commit;
