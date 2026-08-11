-- ============================================================
-- GymFlow — 012 : disciplines (karaté, full contact, aérobic)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- NOUVEAU MODÈLE
-- Le club a 3 disciplines : karate, full_contact, aerobic. Chacune garde
-- le découpage Sbata / Rachad. Un membre appartient à UNE discipline.
-- Le personnel (réceptionniste / lecteur) est cloisonné par discipline
-- ET par succursale : un réceptionniste Full contact – Sbata ne voit que
-- les membres full contact de Sbata. L'admin voit tout.
--
-- Grades et championnats restent réservés au karaté (inchangés côté
-- base ; l'interface masque ces pages hors karaté).
-- ============================================================

begin;
set local search_path = public, extensions;

-- ─── Colonnes discipline ──────────────────────────────────────
-- Membres : discipline obligatoire, karaté par défaut (existants).
alter table members
  add column if not exists discipline text not null default 'karate'
    check (discipline in ('karate', 'full_contact', 'aerobic'));

-- Personnel : discipline de rattachement. NULL = toutes les disciplines
-- (réservé à l'admin ou à un poste transversal), comme branch NULL pour
-- les succursales.
alter table profiles
  add column if not exists discipline text
    check (discipline in ('karate', 'full_contact', 'aerobic') or discipline is null);

-- Paiements : on copie la discipline du membre pour la compta cloisonnée.
alter table payments
  add column if not exists discipline text
    check (discipline in ('karate', 'full_contact', 'aerobic') or discipline is null);

-- Reprise : tous les membres existants sont du karaté.
update members set discipline = 'karate' where discipline is null;
-- Reprise : paiements existants alignés sur la discipline de leur membre.
update payments p set discipline = m.discipline
  from members m where m.id = p.member_id and p.discipline is null;

-- ─── Trigger de création de profil : lire aussi la discipline ─────
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  r text := new.raw_user_meta_data->>'role';
begin
  if r is null or r not in ('admin', 'receptionist', 'viewer') then
    return new;
  end if;

  insert into profiles (user_id, name, email, role, branch, discipline)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'Utilisateur'),
    new.email,
    r::user_role,
    case
      when new.raw_user_meta_data->>'branch' in ('sbata', 'rachad') then new.raw_user_meta_data->>'branch'
      else null
    end,
    case
      when new.raw_user_meta_data->>'discipline' in ('karate', 'full_contact', 'aerobic') then new.raw_user_meta_data->>'discipline'
      else null
    end
  );
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─── RLS members : cloison succursale + discipline ────────────
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

create policy "members: scoped read"
  on members for select
  using (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and (
          p.role = 'admin'
          or (
            (p.branch is null or p.branch = members.branch)
            and (p.discipline is null or p.discipline = members.discipline)
          )
        )
    )
  );

-- Insertion : réceptionniste limité à sa succursale ET sa discipline.
drop policy if exists "members: admin+recep insert" on members;
create policy "members: admin+recep insert"
  on members for insert
  with check (
    current_user_role() in ('admin', 'receptionist')
    and (
      current_user_role() = 'admin'
      or exists (
        select 1 from profiles p
        where p.user_id = auth.uid()
          and (p.branch is null or p.branch = members.branch)
          and (p.discipline is null or p.discipline = members.discipline)
      )
    )
  );

-- Mise à jour : même cloison.
drop policy if exists "members: admin+recep update" on members;
create policy "members: admin+recep update"
  on members for update
  using (
    current_user_role() in ('admin', 'receptionist')
    and (
      current_user_role() = 'admin'
      or exists (
        select 1 from profiles p
        where p.user_id = auth.uid()
          and (p.branch is null or p.branch = members.branch)
          and (p.discipline is null or p.discipline = members.discipline)
      )
    )
  );

-- ─── RLS notifications : cloison via le membre (succursale + discipline) ──
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

create policy "notifications: scoped read"
  on notifications for select
  using (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and (
          p.role = 'admin'
          or notifications.member_id is null
          or exists (
            select 1 from members m
            where m.id = notifications.member_id
              and (p.branch is null or p.branch = m.branch)
              and (p.discipline is null or p.discipline = m.discipline)
          )
        )
    )
  );

-- ─── RLS payments : cloison succursale + discipline ───────────
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'payments' and cmd = 'SELECT'
  loop
    execute format('drop policy if exists %I on payments', pol.policyname);
  end loop;
end $$;

create policy "payments: scoped read"
  on payments for select
  using (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and (
          p.role = 'admin'
          or (
            (p.branch is null or p.branch = payments.branch)
            and (p.discipline is null or p.discipline = payments.discipline)
          )
        )
    )
  );

commit;
