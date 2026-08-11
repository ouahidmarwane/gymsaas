-- ============================================================
-- GymFlow — 019 : cohérence du générateur d'alertes quotidien
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- Corrige un écart : un membre "assuré" (is_insured = true) MAIS sans date
-- d'assurance (ins_expiry NULL) était affiché "Non assuré" par le site
-- (enrichMember) sans jamais générer d'alerte. On aligne generate_notifications
-- sur ce cas (→ ins_missing), comme le fait déjà le recalcul immédiat côté app
-- (recomputeMemberNotifications).
--
-- Le reste de la fonction est inchangé (dépend des helpers de la migration 017 :
-- _tg_alert, _wa_message, _url_encode, _ma_phone).
-- ============================================================

begin;
set local search_path = public, extensions;

create or replace function generate_notifications()
returns void language plpgsql as $$
declare
  m       record;
  today   date := current_date;
  tg_token text;
  tg_chat  text;
begin
  select bot_token, chat_id into tg_token, tg_chat from telegram_config where id = 1;

  delete from notifications where is_read = false;

  for m in select * from members loop

    -- Abonnement : expire dans 1-7 jours
    if m.sub_expiry is not null and m.sub_expiry >= today and m.sub_expiry <= today + interval '7 days' then
      insert into notifications (member_id, type, message, is_read, sent_email)
      values (m.id, 'sub_expiring', 'Abonnement expire le ' || to_char(m.sub_expiry, 'DD/MM/YYYY'), false, false);
      perform _tg_alert(m.id, m.name, m.branch, m.discipline, m.phone,
        'sub_expiring', (m.sub_expiry - today), m.sub_expiry,
        '⏰ Abonnement expire le ' || to_char(m.sub_expiry, 'DD/MM/YYYY'), tg_token, tg_chat);

    -- Abonnement : déjà expiré
    elsif m.sub_expiry is not null and m.sub_expiry < today then
      insert into notifications (member_id, type, message, is_read, sent_email)
      values (m.id, 'sub_expired', 'Abonnement expiré depuis le ' || to_char(m.sub_expiry, 'DD/MM/YYYY'), false, false);
      perform _tg_alert(m.id, m.name, m.branch, m.discipline, m.phone,
        'sub_expired', 0, m.sub_expiry,
        '❌ Abonnement expiré depuis le ' || to_char(m.sub_expiry, 'DD/MM/YYYY'), tg_token, tg_chat);
    end if;

    -- Assurance manquante : pas assuré OU assuré sans date d'échéance (aligné site)
    if m.is_insured = false or m.ins_expiry is null then
      insert into notifications (member_id, type, message, is_read, sent_email)
      values (m.id, 'ins_missing', 'Aucune assurance enregistrée', false, false);
      perform _tg_alert(m.id, m.name, m.branch, m.discipline, m.phone,
        'ins_missing', 0, date_trunc('week', today)::date,
        '🚫 Assurance manquante', tg_token, tg_chat);

    -- Assurance : expire dans 1-30 jours
    elsif m.ins_expiry >= today and m.ins_expiry <= today + interval '30 days' then
      insert into notifications (member_id, type, message, is_read, sent_email)
      values (m.id, 'ins_expiring', 'Assurance expire le ' || to_char(m.ins_expiry, 'DD/MM/YYYY'), false, false);
      perform _tg_alert(m.id, m.name, m.branch, m.discipline, m.phone,
        'ins_expiring', (m.ins_expiry - today), m.ins_expiry,
        '🛡️ Assurance expire le ' || to_char(m.ins_expiry, 'DD/MM/YYYY'), tg_token, tg_chat);

    -- Assurance : expirée
    elsif m.ins_expiry < today then
      insert into notifications (member_id, type, message, is_read, sent_email)
      values (m.id, 'ins_expired', 'Assurance expirée depuis le ' || to_char(m.ins_expiry, 'DD/MM/YYYY'), false, false);
      perform _tg_alert(m.id, m.name, m.branch, m.discipline, m.phone,
        'ins_expired', 0, m.ins_expiry,
        '⚠️ Assurance expirée depuis le ' || to_char(m.ins_expiry, 'DD/MM/YYYY'), tg_token, tg_chat);
    end if;

  end loop;
end;
$$;

commit;
