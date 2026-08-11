-- ============================================================
-- GymFlow — 013 : isolation STRICTE des disciplines (suite de 012)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- CONTEXTE
-- 012 a cloisonné members / payments / notifications (SELECT) par
-- discipline + succursale. MAIS les tables propres au karaté —
-- grade_sessions, championships, championship_athletes — ont été créées
-- hors migrations et n'avaient AUCUNE RLS : n'importe quel membre du
-- personnel (full contact / aérobic / lecteur) pouvait les lire ET les
-- écrire via l'API. L'interface les masque, mais ce n'est pas une
-- sécurité réelle. 013 pose l'isolation au niveau base.
--
-- RÈGLE : grades & championnats = KARATÉ uniquement.
--   Accès autorisé si : admin, OU poste transversal (discipline NULL),
--   OU personnel karaté. Full contact / aérobic : refusés.
--   Cloison succursale conservée (via la branche du membre / du championnat).
--
-- ⚠️ AVANT D'APPLIQUER : lancer 013_INSPECT_before_apply.sql pour voir
--    l'état actuel. APRÈS : tester (a) le portail public /portal/<token>,
--    (b) une connexion full contact, (c) une connexion karaté + admin.
-- ============================================================

begin;
set local search_path = public, extensions;

-- ─── Helper : l'utilisateur courant est-il autorisé sur le KARATÉ ? ──
create or replace function is_karate_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.user_id = auth.uid()
      and (p.role = 'admin' or p.discipline is null or p.discipline = 'karate')
  );
$$;

-- ══════════════════ grade_sessions ══════════════════
alter table grade_sessions enable row level security;

do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='public' and tablename='grade_sessions'
  loop execute format('drop policy if exists %I on grade_sessions', pol.policyname); end loop;
end $$;

-- Lecture : karaté + cloison succursale (via la branche du membre)
create policy "grade_sessions: karate scoped read" on grade_sessions for select
using (
  exists (
    select 1 from profiles p
    where p.user_id = auth.uid()
      and (p.role = 'admin' or p.discipline is null or p.discipline = 'karate')
      and (
        p.role = 'admin' or p.branch is null
        or exists (select 1 from members m
                   where m.id = grade_sessions.member_id and m.branch = p.branch)
      )
  )
);

create policy "grade_sessions: karate insert" on grade_sessions for insert
with check (current_user_role() in ('admin','receptionist') and is_karate_user());

create policy "grade_sessions: karate update" on grade_sessions for update
using      (current_user_role() in ('admin','receptionist') and is_karate_user())
with check (current_user_role() in ('admin','receptionist') and is_karate_user());

create policy "grade_sessions: admin delete" on grade_sessions for delete
using (current_user_role() = 'admin' and is_karate_user());

-- ══════════════════ championships ══════════════════
alter table championships enable row level security;

do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='public' and tablename='championships'
  loop execute format('drop policy if exists %I on championships', pol.policyname); end loop;
end $$;

-- Lecture staff : karaté + cloison succursale (branch NULL = les deux)
create policy "championships: karate scoped read" on championships for select
using (
  exists (
    select 1 from profiles p
    where p.user_id = auth.uid()
      and (p.role = 'admin' or p.discipline is null or p.discipline = 'karate')
      and (p.role = 'admin' or p.branch is null
           or championships.branch is null or championships.branch = p.branch)
  )
);

-- Carve-out PORTAIL PUBLIC (anon) : le portail lit championships(name) pour
-- les championnats reliés à un token actif. Sans ça, 013 casserait le portail.
create policy "championships: portal read" on championships for select
using (
  exists (select 1 from portal_tokens t
          where t.championship_id = championships.id
            and t.is_active and t.expires_at > now())
);

create policy "championships: karate insert" on championships for insert
with check (current_user_role() in ('admin','receptionist') and is_karate_user());

create policy "championships: karate update" on championships for update
using      (current_user_role() in ('admin','receptionist') and is_karate_user())
with check (current_user_role() in ('admin','receptionist') and is_karate_user());

create policy "championships: admin delete" on championships for delete
using (current_user_role() = 'admin' and is_karate_user());

-- ══════════════════ championship_athletes ══════════════════
alter table championship_athletes enable row level security;

do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='public' and tablename='championship_athletes'
  loop execute format('drop policy if exists %I on championship_athletes', pol.policyname); end loop;
end $$;

create policy "champ_athletes: karate scoped read" on championship_athletes for select
using (
  exists (
    select 1 from profiles p
    where p.user_id = auth.uid()
      and (p.role = 'admin' or p.discipline is null or p.discipline = 'karate')
      and (
        p.role = 'admin' or p.branch is null
        or exists (select 1 from members m
                   where m.id = championship_athletes.member_id and m.branch = p.branch)
      )
  )
);

create policy "champ_athletes: karate insert" on championship_athletes for insert
with check (current_user_role() in ('admin','receptionist') and is_karate_user());

create policy "champ_athletes: karate update" on championship_athletes for update
using      (current_user_role() in ('admin','receptionist') and is_karate_user())
with check (current_user_role() in ('admin','receptionist') and is_karate_user());

create policy "champ_athletes: karate delete" on championship_athletes for delete
using (current_user_role() in ('admin','receptionist') and is_karate_user());

-- ══════════════════ notifications : rappels sans membre = karaté ══════════════════
-- Les rappels championnat (member_id NULL) ne doivent plus être visibles
-- par le personnel full contact / aérobic.
do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='public' and tablename='notifications' and cmd='SELECT'
  loop execute format('drop policy if exists %I on notifications', pol.policyname); end loop;
end $$;

create policy "notifications: scoped read" on notifications for select
using (
  exists (
    select 1 from profiles p
    where p.user_id = auth.uid()
      and (
        p.role = 'admin'
        -- rappel global (championnat) : karaté / transversal seulement
        or (notifications.member_id is null and (p.discipline is null or p.discipline = 'karate'))
        -- rappel lié à un membre : même cloison que 012
        or exists (
          select 1 from members m
          where m.id = notifications.member_id
            and (p.branch is null or p.branch = m.branch)
            and (p.discipline is null or p.discipline = m.discipline)
        )
      )
  )
);

-- ══════════════════ payments INSERT : cloison succursale + discipline ══════════════════
-- 006 autorisait tout réceptionniste à insérer un paiement de n'importe quelle
-- branche/discipline. On aligne l'écriture sur la lecture (012).
drop policy if exists "payments: admin+recep insert" on payments;
create policy "payments: admin+recep insert" on payments for insert
with check (
  current_user_role() in ('admin','receptionist')
  and (
    current_user_role() = 'admin'
    or exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and (p.branch is null or p.branch = payments.branch)
        and (p.discipline is null or p.discipline = payments.discipline)
    )
  )
);

-- ══════════════════ members UPDATE : with check explicite ══════════════════
-- Empêche (côté base) de déplacer un membre hors du périmètre de l'agent.
drop policy if exists "members: admin+recep update" on members;
create policy "members: admin+recep update" on members for update
using (
  current_user_role() in ('admin','receptionist')
  and (current_user_role() = 'admin' or exists (
        select 1 from profiles p where p.user_id = auth.uid()
          and (p.branch is null or p.branch = members.branch)
          and (p.discipline is null or p.discipline = members.discipline)))
)
with check (
  current_user_role() in ('admin','receptionist')
  and (current_user_role() = 'admin' or exists (
        select 1 from profiles p where p.user_id = auth.uid()
          and (p.branch is null or p.branch = members.branch)
          and (p.discipline is null or p.discipline = members.discipline)))
);

commit;
