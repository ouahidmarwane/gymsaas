-- ============================================================
-- GymFlow — 006 : lectures de notifications par utilisateur
--                 + encaissements réels (paiements)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
-- ============================================================

begin;
set local search_path = public, extensions;

-- ─── Notifications lues PAR UTILISATEUR ───────────────────────
-- Avant : une seule case is_read partagée par tout le staff.
-- Désormais chaque utilisateur a son propre état de lecture.
create table if not exists notification_reads (
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table notification_reads enable row level security;

drop policy if exists "notification_reads: own select" on notification_reads;
create policy "notification_reads: own select"
  on notification_reads for select
  using (user_id = auth.uid());

drop policy if exists "notification_reads: own insert" on notification_reads;
create policy "notification_reads: own insert"
  on notification_reads for insert
  with check (user_id = auth.uid());

-- ─── Encaissements réels ──────────────────────────────────────
-- La comptabilité passait uniquement par des estimations tarifaires.
-- Cette table enregistre les paiements réellement encaissés.
create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members(id) on delete cascade,
  amount      numeric(10,2) not null check (amount >= 0),
  type        text not null check (type in ('monthly','insurance','registration','other')),
  paid_at     date not null default current_date,
  branch      text,
  notes       text,
  recorded_by uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_payments_member  on payments(member_id);
create index if not exists idx_payments_paid_at on payments(paid_at desc);

alter table payments enable row level security;

-- Lecture : admin partout ; les autres selon leur succursale
drop policy if exists "payments: read by branch" on payments;
create policy "payments: read by branch"
  on payments for select
  using (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and (p.role = 'admin' or p.branch is null or p.branch = payments.branch)
    )
  );

-- Enregistrement : admin + réceptionniste
drop policy if exists "payments: admin+recep insert" on payments;
create policy "payments: admin+recep insert"
  on payments for insert
  with check (current_user_role() in ('admin', 'receptionist'));

-- Suppression : admin uniquement
drop policy if exists "payments: admin delete" on payments;
create policy "payments: admin delete"
  on payments for delete
  using (current_user_role() = 'admin');

commit;
