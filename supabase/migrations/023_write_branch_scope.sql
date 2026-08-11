-- ============================================================
-- GymFlow — 023 : cloison succursale sur les ÉCRITURES karaté (S8)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- La lecture de grade_sessions / championship_athletes est déjà cloisonnée
-- par succursale (013). Les ÉCRITURES ne l'étaient pas : un réceptionniste
-- karaté de Sbata pouvait créer/confirmer un passage de grade ou (dé)inscrire
-- un athlète pour un membre de Rachad. On aligne les écritures sur la lecture.
--
-- Prédicat : admin (transversal) OU personnel dont la succursale est NULL
-- (transversal) OU dont la succursale = celle du membre concerné.
-- ============================================================

begin;
set local search_path = public, extensions;

-- ─── grade_sessions : insert + update cloisonnés ──
drop policy if exists "grade_sessions: karate insert" on grade_sessions;
create policy "grade_sessions: karate insert" on grade_sessions for insert
with check (
  current_user_role() in ('admin','receptionist') and is_karate_user()
  and exists (
    select 1 from profiles p where p.user_id = auth.uid()
      and (p.role = 'admin' or p.branch is null
           or exists (select 1 from members m where m.id = grade_sessions.member_id and m.branch = p.branch))
  )
);

drop policy if exists "grade_sessions: karate update" on grade_sessions;
create policy "grade_sessions: karate update" on grade_sessions for update
using (
  current_user_role() in ('admin','receptionist') and is_karate_user()
  and exists (
    select 1 from profiles p where p.user_id = auth.uid()
      and (p.role = 'admin' or p.branch is null
           or exists (select 1 from members m where m.id = grade_sessions.member_id and m.branch = p.branch))
  )
)
with check (
  current_user_role() in ('admin','receptionist') and is_karate_user()
  and exists (
    select 1 from profiles p where p.user_id = auth.uid()
      and (p.role = 'admin' or p.branch is null
           or exists (select 1 from members m where m.id = grade_sessions.member_id and m.branch = p.branch))
  )
);
-- delete reste admin-only (admin = transversal) → inchangé.

-- ─── championship_athletes : insert + update + delete cloisonnés ──
drop policy if exists "champ_athletes: karate insert" on championship_athletes;
create policy "champ_athletes: karate insert" on championship_athletes for insert
with check (
  current_user_role() in ('admin','receptionist') and is_karate_user()
  and exists (
    select 1 from profiles p where p.user_id = auth.uid()
      and (p.role = 'admin' or p.branch is null
           or exists (select 1 from members m where m.id = championship_athletes.member_id and m.branch = p.branch))
  )
);

drop policy if exists "champ_athletes: karate update" on championship_athletes;
create policy "champ_athletes: karate update" on championship_athletes for update
using (
  current_user_role() in ('admin','receptionist') and is_karate_user()
  and exists (
    select 1 from profiles p where p.user_id = auth.uid()
      and (p.role = 'admin' or p.branch is null
           or exists (select 1 from members m where m.id = championship_athletes.member_id and m.branch = p.branch))
  )
)
with check (
  current_user_role() in ('admin','receptionist') and is_karate_user()
  and exists (
    select 1 from profiles p where p.user_id = auth.uid()
      and (p.role = 'admin' or p.branch is null
           or exists (select 1 from members m where m.id = championship_athletes.member_id and m.branch = p.branch))
  )
);

drop policy if exists "champ_athletes: karate delete" on championship_athletes;
create policy "champ_athletes: karate delete" on championship_athletes for delete
using (
  current_user_role() in ('admin','receptionist') and is_karate_user()
  and exists (
    select 1 from profiles p where p.user_id = auth.uid()
      and (p.role = 'admin' or p.branch is null
           or exists (select 1 from members m where m.id = championship_athletes.member_id and m.branch = p.branch))
  )
);

commit;
