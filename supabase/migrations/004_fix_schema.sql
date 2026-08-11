-- ============================================================
-- GymFlow — Migration corrective 004
-- À exécuter dans : Supabase Dashboard → SQL Editor
--
-- Aligne la base RÉELLE sur le code de l'application.
-- Constaté le 2026-08-01 via l'API REST :
--   • championships           : colonnes description / created_by /
--                               reminder_days_before / weekly_report_day /
--                               report_deadline_hour absentes
--   • championship_athletes   : colonnes category / weight_class / result_*
--                               / added_at / added_by absentes
--   • portal_tokens           : table absente
--   • championship_reminder_log : table absente
--   • notifications.member_id : NOT NULL (bloque les rappels championnat)
--   • policy "members: admin+recep insert" : référence invalide `new.branch`
-- Ce script est idempotent : il peut être exécuté plusieurs fois sans risque.
-- ============================================================

-- ⚠️ IMPORTANT : exécuter sur le BON projet.
-- L'application utilise le projet  kkzutlkiswwdabqpmgpd
-- → l'URL du dashboard doit contenir « kkzutlkiswwdabqpmgpd ».
-- (L'erreur « relation "championships" does not exist » signifie que le SQL
--  a été lancé sur un autre projet : la table existe bien sur celui-ci,
--  vérifié via l'API le 2026-08-01.)

begin;

-- Sécurise la résolution des noms (tables du schéma public,
-- fonctions uuid/crypto du schéma extensions de Supabase)
set local search_path = public, extensions;

-- ─── championships : colonnes manquantes ─────────────────────
alter table championships add column if not exists description          text;
alter table championships add column if not exists created_by           uuid references profiles(id) on delete set null;
alter table championships add column if not exists reminder_days_before integer[] not null default '{30,14,7,3,1}';
alter table championships add column if not exists weekly_report_day    integer  not null default 0;
alter table championships add column if not exists report_deadline_hour integer  not null default 23;

-- ─── championship_athletes : colonnes manquantes ─────────────
alter table championship_athletes add column if not exists category          text;
alter table championship_athletes add column if not exists weight_class      text;
alter table championship_athletes add column if not exists result_notes      text;
alter table championship_athletes add column if not exists result_entered_at timestamptz;
alter table championship_athletes add column if not exists result_entered_by uuid references profiles(id) on delete set null;
alter table championship_athletes add column if not exists added_at          timestamptz not null default now();
alter table championship_athletes add column if not exists added_by          uuid references profiles(id) on delete set null;

-- Reprendre la date d'ajout existante quand elle est connue
update championship_athletes set added_at = created_at
  where added_at is not null and created_at is not null and added_at > created_at;

-- Unicité requise par l'upsert onConflict='championship_id,member_id'
create unique index if not exists idx_champ_athletes_unique
  on championship_athletes (championship_id, member_id);

-- ─── portal_tokens (portail athlète) ─────────────────────────
create table if not exists portal_tokens (
  id              uuid primary key default uuid_generate_v4(),
  championship_id uuid not null references championships(id) on delete cascade,
  member_id       uuid not null references members(id) on delete cascade,
  token           text not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at      timestamptz not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (championship_id, member_id)
);

-- ─── championship_reminder_log ───────────────────────────────
create table if not exists championship_reminder_log (
  id              uuid primary key default uuid_generate_v4(),
  championship_id uuid not null references championships(id) on delete cascade,
  member_id       uuid references members(id) on delete cascade,
  reminder_type   text not null,
  sent_at         timestamptz not null default now(),
  sent_email      boolean default false,
  sent_whatsapp   boolean default false
);
-- Un cast ::date direct est refusé dans un index (non-IMMUTABLE à cause du
-- fuseau horaire) — on passe par la fonction immutable, comme en 001.
create or replace function immutable_date(timestamptz)
returns date language sql immutable as $$
  select $1::date;
$$;

create unique index if not exists idx_champ_reminder_unique
  on championship_reminder_log (championship_id, member_id, reminder_type, immutable_date(sent_at));

-- ─── notifications : autoriser les rappels sans membre ───────
-- (rappels championnat destinés au staff, member_id = null)
alter table notifications alter column member_id drop not null;

-- ─── RLS ─────────────────────────────────────────────────────
alter table portal_tokens             enable row level security;
alter table championship_reminder_log enable row level security;
alter table weekly_reports            enable row level security;

drop policy if exists "tokens: admin manage" on portal_tokens;
create policy "tokens: admin manage"
  on portal_tokens for all
  using (current_user_role() in ('admin', 'receptionist'));

-- Le portail public vérifie son token (accès anonyme, tokens actifs seulement)
drop policy if exists "tokens: public verify" on portal_tokens;
create policy "tokens: public verify"
  on portal_tokens for select
  using (is_active = true and expires_at > now());

drop policy if exists "champ_reminders: authenticated read" on championship_reminder_log;
create policy "champ_reminders: authenticated read"
  on championship_reminder_log for select
  using (auth.uid() is not null);

drop policy if exists "reports: authenticated read" on weekly_reports;
create policy "reports: authenticated read"
  on weekly_reports for select
  using (auth.uid() is not null);

-- Insertion publique de rapport uniquement si un token actif existe
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

-- ─── Trigger de création automatique du profil ───────────────
-- Constaté absent dans la base réelle : un utilisateur créé via l'API Auth
-- n'obtenait AUCUNE ligne dans profiles (login impossible ensuite).
-- « set search_path = public » est OBLIGATOIRE : le trigger est déclenché par
-- le rôle supabase_auth_admin dont le search_path ne contient pas public —
-- sans lui, « insert into profiles » échoue et TOUTE création d'utilisateur
-- est bloquée (« Database error creating new user »).
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into profiles (user_id, name, email, role, branch)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'Utilisateur'),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'viewer'),
    case
      when new.raw_user_meta_data->>'branch' in ('sbata', 'rachad') then new.raw_user_meta_data->>'branch'
      else null
    end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Le trigger s'exécute sous le rôle postgres (propriétaire de la fonction).
-- Si postgres n'est pas propriétaire de la table profiles, la RLS s'applique
-- à lui aussi et bloque l'insert (auth.uid() est null dans ce contexte).
-- Cette policy n'élargit RIEN pour les rôles de l'app (anon/authenticated).
drop policy if exists "profiles: system insert" on profiles;
create policy "profiles: system insert"
  on profiles for insert
  to postgres
  with check (true);

-- ─── Correction policy members (référence `new.branch` invalide) ──
-- Dans une policy, la ligne insérée se référence par ses colonnes
-- (non qualifiées ou qualifiées par le nom de la table), jamais par NEW.
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
      )
    )
  );

commit;
