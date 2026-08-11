-- ============================================================
-- GymFlow — 011 : réparation du cloisonnement par succursale
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- FAILLE CONSTATÉE (pentest du 2026-08-02)
-- Un compte lecteur affecté à Sbata voyait AUSSI les membres de Rachad.
-- Cause : plusieurs policies SELECT coexistent sur « members ». Les
-- policies RLS étant permissives (combinées par OU), il suffit qu'UNE
-- seule soit trop large (ex. « auth.uid() is not null ») pour annuler le
-- cloisonnement porté par les autres.
--
-- CORRECTIF
-- On supprime dynamiquement TOUTES les policies SELECT existantes sur
-- « members » (quel que soit leur nom), puis on en recrée une seule,
-- stricte : admin voit tout ; un membre du personnel affecté à une
-- succursale ne voit que la sienne ; un profil « toutes succursales »
-- (branch IS NULL) voit tout, par conception.
--
-- Même logique réappliquée à « notifications » (mêmes symptômes
-- possibles) pour être cohérent.
-- ============================================================

begin;
set local search_path = public, extensions;

-- ── members : supprimer toutes les policies SELECT, quelles qu'elles soient ──
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'members' and cmd = 'SELECT'
  loop
    execute format('drop policy if exists %I on members', pol.policyname);
  end loop;
end $$;

create policy "members: branch scoped read"
  on members for select
  using (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and (
          p.role = 'admin'
          or p.branch is null
          or p.branch = members.branch
        )
    )
  );

-- ── notifications : même durcissement (cloisonné par la succursale du membre) ──
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'notifications' and cmd = 'SELECT'
  loop
    execute format('drop policy if exists %I on notifications', pol.policyname);
  end loop;
end $$;

create policy "notifications: branch scoped read"
  on notifications for select
  using (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and (
          p.role = 'admin'
          or p.branch is null
          or exists (
            select 1 from members m
            where m.id = notifications.member_id
              and m.branch = p.branch
          )
          -- notifications sans membre (rappels globaux) : visibles par le staff
          or notifications.member_id is null
        )
    )
  );

commit;
