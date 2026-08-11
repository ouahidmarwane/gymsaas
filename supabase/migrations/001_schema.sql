-- ============================================================
-- GymFlow — Schema + RLS Policies
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── ENUM: roles ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'receptionist', 'viewer');
  END IF;
END$$;

-- ─── TABLE: profiles ─────────────────────────────────────────
-- One row per authenticated user (linked to auth.users)
create table if not exists profiles (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  email       text not null,
  role        user_role not null default 'viewer',
  branch      text check (branch in ('sbata','rachad') or branch is null),
  created_at  timestamptz not null default now(),
  constraint  profiles_user_id_key unique (user_id)
);

-- ─── TABLE: members ──────────────────────────────────────────
create table if not exists members (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  phone       text not null,
  email       text,
  join_date   date not null default current_date,
  sub_expiry  date,                       -- monthly subscription expiry
  is_insured  boolean not null default false,
  ins_expiry  date,                       -- yearly insurance expiry
  branch      text not null default 'sbata' check (branch in ('sbata','rachad')),
  notes       text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── TABLE: notifications ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notif_type') THEN
    CREATE TYPE notif_type AS ENUM (
      'sub_expiring',   -- subscription expiring in 7 days
      'sub_expired',    -- subscription already expired
      'ins_expiring',   -- insurance expiring in 30 days
      'ins_expired',    -- insurance already expired
      'ins_missing'     -- member has no insurance at all
    );
  END IF;
END$$;

create table if not exists notifications (
  id          uuid primary key default uuid_generate_v4(),
  member_id   uuid not null references members(id) on delete cascade,
  type        notif_type not null,
  message     text not null,
  is_read     boolean not null default false,
  sent_email  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ─── FUNCTION: immutable date cast ──────────────────────────
create or replace function immutable_date(timestamptz)
returns date language sql immutable as $$
  select $1::date;
$$;

-- ─── TABLE: reminder_log ─────────────────────────────────────
-- Prevents sending duplicate reminders on the same day
create table if not exists reminder_log (
  id          uuid primary key default uuid_generate_v4(),
  member_id   uuid not null references members(id) on delete cascade,
  type        notif_type not null,
  sent_at     timestamptz not null default now()
);

-- Unique index to prevent duplicate reminders on the same day
create unique index if not exists idx_reminder_log_unique
  on reminder_log (member_id, type, immutable_date(sent_at));

-- ─── FUNCTION: auto-update updated_at ────────────────────────
create or replace function handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

DROP TRIGGER IF EXISTS members_updated_at ON members;
create trigger members_updated_at
  before update on members
  for each row execute procedure handle_updated_at();

-- ─── FUNCTION: auto-create profile on signup ─────────────────
-- When admin creates a user via Supabase Auth,
-- this trigger creates the matching profile row.
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─── INDEXES ─────────────────────────────────────────────────
create index if not exists idx_members_sub_expiry  on members(sub_expiry);
create index if not exists idx_members_ins_expiry  on members(ins_expiry);
create index if not exists idx_members_is_insured  on members(is_insured);
create index if not exists idx_notifications_read  on notifications(is_read);
create index if not exists idx_notif_member        on notifications(member_id);

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════

alter table profiles      enable row level security;
alter table members       enable row level security;
alter table notifications enable row level security;
alter table reminder_log  enable row level security;

-- ─── HELPER FUNCTION: get current user role ──────────────────
create or replace function current_user_role()
returns user_role language sql stable security definer as $$
  select role from profiles where user_id = auth.uid() limit 1;
$$;

-- ─── POLICIES: profiles ──────────────────────────────────────

-- Everyone can read their own profile
DROP POLICY IF EXISTS "profiles: read own" ON profiles;
create policy "profiles: read own"
  on profiles for select
  using (user_id = auth.uid());

-- Admin can read all profiles
DROP POLICY IF EXISTS "profiles: admin read all" ON profiles;
create policy "profiles: admin read all"
  on profiles for select
  using (current_user_role() = 'admin');

-- Admin can insert new profiles (when creating staff accounts)
DROP POLICY IF EXISTS "profiles: admin insert" ON profiles;
create policy "profiles: admin insert"
  on profiles for insert
  with check (current_user_role() = 'admin');

-- Admin can update any profile (change roles)
DROP POLICY IF EXISTS "profiles: admin update" ON profiles;
create policy "profiles: admin update"
  on profiles for update
  using (current_user_role() = 'admin');

-- Admin can delete staff accounts (not their own)
DROP POLICY IF EXISTS "profiles: admin delete" ON profiles;
create policy "profiles: admin delete"
  on profiles for delete
  using (current_user_role() = 'admin' and user_id != auth.uid());

-- ─── POLICIES: members ───────────────────────────────────────

-- Admin + Receptionist can read members by branch
DROP POLICY IF EXISTS "members: authenticated read" ON members;
create policy "members: authenticated read"
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

-- Admin + Receptionist can insert members
DROP POLICY IF EXISTS "members: admin+recep insert" ON members;
create policy "members: admin+recep insert"
  on members for insert
  with check (
    current_user_role() in ('admin', 'receptionist')
    and (
      current_user_role() = 'admin'
      or exists (
        select 1 from profiles p
        where p.user_id = auth.uid()
          and (p.branch is null or p.branch = new.branch)
      )
    )
  );

-- Admin + Receptionist can update members
DROP POLICY IF EXISTS "members: admin+recep update" ON members;
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
      )
    )
  );

-- Only Admin can delete members
DROP POLICY IF EXISTS "members: admin delete" ON members;
create policy "members: admin delete"
  on members for delete
  using (current_user_role() = 'admin');

-- ─── POLICIES: notifications ─────────────────────────────────

-- Any authenticated user can read notifications for their branch
DROP POLICY IF EXISTS "notifications: authenticated read" ON notifications;
create policy "notifications: authenticated read"
  on notifications for select
  using (
    exists (
      select 1 from profiles p
      join members m on m.id = notifications.member_id
      where p.user_id = auth.uid()
        and (
          p.role = 'admin'
          or p.branch is null
          or p.branch = m.branch
        )
    )
  );

-- Admin + Receptionist can insert notifications
DROP POLICY IF EXISTS "notifications: admin+recep insert" ON notifications;
create policy "notifications: admin+recep insert"
  on notifications for insert
  with check (current_user_role() in ('admin', 'receptionist'));

-- Admin + Receptionist can mark as read
DROP POLICY IF EXISTS "notifications: admin+recep update" ON notifications;
create policy "notifications: admin+recep update"
  on notifications for update
  using (current_user_role() in ('admin', 'receptionist'));

-- ─── POLICIES: reminder_log ──────────────────────────────────

-- Read only for authenticated users (for display)
DROP POLICY IF EXISTS "reminder_log: authenticated read" ON reminder_log;
create policy "reminder_log: authenticated read"
  on reminder_log for select
  using (auth.uid() is not null);

-- Only Edge Functions (service role) insert — handled via service_role key
-- No insert policy needed here; Edge Functions bypass RLS

-- ═══════════════════════════════════════════════════════════════
-- SEED: First admin account
-- ═══════════════════════════════════════════════════════════════
-- After creating your first user in Supabase Auth Dashboard,
-- run this to grant them admin role:
--
--   update profiles set role = 'admin'
--   where email = 'admin@votresalle.ma';
--
-- ═══════════════════════════════════════════════════════════════
