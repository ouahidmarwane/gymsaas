-- ============================================================
-- GymFlow — 003b : BASELINE des tables karaté créées hors-migrations
-- (grade_sessions, championships, championship_athletes)
--
-- BUT : rendre le schéma REPRODUCTIBLE. Ces 3 tables avaient été créées à
-- la main dans Supabase et n'existaient dans aucune migration → impossible
-- de reconstruire le projet depuis le code. Ce fichier comble le trou.
--
-- ORDONNANCEMENT (reconstruction sur une base vierge) :
--   001 (profiles, members) → 002 → 003 → **003b (ce fichier)** → 004 → …
--   Il DOIT tourner après 001 (FK vers profiles/members) et AVANT 004
--   (qui ALTER ces tables). Le préfixe « 003b » assure ce tri.
--
-- SUR LA BASE ACTUELLE : 100 % inoffensif — « create table IF NOT EXISTS »
--   ne touche pas aux tables déjà présentes. À exécuter uniquement si tu
--   reconstruis un projet vierge ; sur la prod, c'est un no-op.
--
-- Schéma reconstitué fidèlement depuis information_schema (types, défauts,
-- NOT NULL, CHECK, PK/FK/UNIQUE réels). Les ON DELETE des liens
-- member_id/championship_id sont posés en CASCADE (choix standard) et ceux
-- des colonnes *_by en SET NULL (comme la migration 004).
-- ============================================================

begin;
set local search_path = public, extensions;

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ─── grade_sessions (passages de grade — karaté) ──────────────
create table if not exists grade_sessions (
  id            uuid primary key default uuid_generate_v4(),
  member_id     uuid not null references members(id) on delete cascade,
  grade_before  integer not null check (grade_before >= 0 and grade_before <= 12),
  grade_after   integer check (grade_after >= 0 and grade_after <= 12),
  scheduled_date date not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'passed', 'failed')),
  confirmed_by  uuid references profiles(id) on delete set null,
  confirmed_at  timestamptz,
  notes         text,
  created_at    timestamptz not null default now()
);

-- ─── championships (championnats — karaté) ────────────────────
create table if not exists championships (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  date                  date not null,
  location              text not null default '',
  branch                text not null default '',
  status                text not null default 'upcoming'
                          check (status in ('upcoming', 'active', 'completed', 'cancelled')),
  created_at            timestamptz not null default now(),
  discipline            text default 'kata'
                          check (discipline in ('kata', 'combat')),
  age_min               integer,
  age_max               integer,
  weight_category       text,
  checklist             jsonb default '{}'::jsonb,
  description           text,
  created_by            uuid references profiles(id) on delete set null,
  reminder_days_before  integer[] not null default '{30,14,7,3,1}'::integer[],
  weekly_report_day     integer not null default 0,
  report_deadline_hour  integer not null default 23
);

-- ─── championship_athletes (athlètes inscrits — karaté) ───────
create table if not exists championship_athletes (
  id                 uuid primary key default gen_random_uuid(),
  championship_id    uuid not null references championships(id) on delete cascade,
  member_id          uuid not null references members(id) on delete cascade,
  qualified          boolean not null default false,
  place              integer,
  created_at         timestamptz not null default now(),
  category           text,
  weight_class       text,
  result_notes       text,
  result_entered_at  timestamptz,
  result_entered_by  uuid references profiles(id) on delete set null,
  added_at           timestamptz not null default now(),
  added_by           uuid references profiles(id) on delete set null,
  unique (championship_id, member_id)
);

commit;
