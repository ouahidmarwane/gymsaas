-- ============================================================
-- GymFlow — Audit Logs
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

create table if not exists audit_logs (
  id          uuid primary key default uuid_generate_v4(),
  action      text not null,           -- 'member_add', 'member_delete', 'member_update', etc.
  entity      text not null,           -- 'member', 'staff', 'grade', 'subscription', 'insurance'
  entity_id   uuid,                    -- ID of the affected record
  entity_name text,                    -- Human-readable name (member name, staff name…)
  details     jsonb,                   -- Extra context (old values, new values, etc.)
  performed_by uuid references profiles(id) on delete set null,
  performer_name text,                 -- Denormalized for display even if profile deleted
  performer_role text,
  branch      text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at   on audit_logs(created_at desc);
create index if not exists idx_audit_logs_entity        on audit_logs(entity);
create index if not exists idx_audit_logs_performed_by  on audit_logs(performed_by);

-- RLS
alter table audit_logs enable row level security;

-- Admin can read all logs
drop policy if exists "audit_logs: admin read" on audit_logs;
create policy "audit_logs: admin read"
  on audit_logs for select
  using (current_user_role() = 'admin');

-- Receptionist can read logs for their branch
drop policy if exists "audit_logs: recep read own branch" on audit_logs;
create policy "audit_logs: recep read own branch"
  on audit_logs for select
  using (
    current_user_role() = 'receptionist'
    and exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and (p.branch is null or p.branch = audit_logs.branch)
    )
  );

-- Authenticated users can insert (done via server actions)
drop policy if exists "audit_logs: authenticated insert" on audit_logs;
create policy "audit_logs: authenticated insert"
  on audit_logs for insert
  with check (auth.uid() is not null);
