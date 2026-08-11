-- ──────────────────────────────────────────────────────────────────────────
-- Branch support migration for GymFlow
-- Adds branch columns and branch-aware RLS policies for members and notifications
-- ──────────────────────────────────────────────────────────────────────────

begin;

-- Add branch support to profiles
alter table profiles
  add column if not exists branch text check (branch in ('sbata','rachad') or branch is null);

-- Add branch support to members
alter table members
  add column if not exists branch text not null default 'sbata' check (branch in ('sbata','rachad'));

-- Ensure existing members default to Sbata when branch is missing
update members set branch = 'sbata' where branch is null;

-- Update the auth trigger so new users can inherit branch metadata
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

-- Restrict member access by branch
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

commit;
