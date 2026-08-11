-- ============================================================
-- GymFlow — 017 : alertes Telegram (dans generate_notifications)
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- (projet kkzutlkiswwdabqpmgpd) — idempotent.
--
-- Le cron quotidien "daily-notifications" (08:00 Maroc) appelle déjà
-- generate_notifications(). On l'enrichit pour qu'en plus des alertes du
-- site, il envoie un message Telegram à l'admin AVEC un lien WhatsApp
-- prêt à envoyer (même message bilingue que le bouton du site).
--
-- Envoi via pg_net (HTTP depuis Postgres). Anti-spam : chaque (membre,
-- type, date d'échéance) n'est notifié qu'une seule fois (table
-- telegram_log) — donc pas de répétition quotidienne pour un même impayé.
--
-- ⚠️ APRÈS cette migration : renseigner le bot + le chat (voir le bloc
--    INSERT commenté à la fin, à lancer séparément avec tes valeurs).
-- ============================================================

begin;
set local search_path = public, extensions;

create extension if not exists pg_net;

-- ─── Config Telegram (1 ligne). RLS fermée : lue seulement par le cron. ──
create table if not exists telegram_config (
  id        int primary key default 1,
  bot_token text,
  chat_id   text,
  check (id = 1)
);
alter table telegram_config enable row level security;  -- aucune policy = verrouillé (service/cron seulement)

-- ─── Journal anti-doublon : une notif Telegram par échéance ──
create table if not exists telegram_log (
  member_id uuid not null,
  type      text not null,
  ref_date  date not null,
  sent_at   timestamptz not null default now(),
  primary key (member_id, type, ref_date)
);

-- ─── Helper : encodage URL (UTF-8, gère accents + arabe) ──
create or replace function _url_encode(input text)
returns text language sql immutable as $$
  select coalesce(string_agg(
    case
      when b between 48 and 57 or b between 65 and 90 or b between 97 and 122
        or b in (45, 46, 95, 126)                 -- - . _ ~
      then chr(b)
      else '%' || upper(lpad(to_hex(b), 2, '0'))
    end, ''), '')
  from (
    select get_byte(convert_to(input, 'UTF8'), g) as b
    from generate_series(0, octet_length(convert_to(input, 'UTF8')) - 1) as g
  ) t;
$$;

-- ─── Helper : téléphone au format international marocain ──
create or replace function _ma_phone(phone text)
returns text language sql immutable as $$
  select case
    when d like '212%' then d
    when d like '0%'   then '212' || substr(d, 2)
    else '212' || d
  end
  from (select regexp_replace(coalesce(phone, ''), '\D', '', 'g') as d) x;
$$;

-- ─── Helper : message WhatsApp bilingue (identique au site) ──
create or replace function _wa_message(kind text, pname text, days int)
returns text language plpgsql immutable as $$
declare nl text := chr(10);
begin
  if kind = 'sub_expiring' then
    return 'Bonjour ' || pname || ',' || nl || nl ||
      'Votre abonnement à notre salle de sport expire dans ' || days || ' jour(s).' || nl ||
      'Merci de nous contacter pour le renouveler avant la date d''expiration.' || nl || nl ||
      '— Association Noujoum el Chaouia' || nl || nl || '---' || nl || nl ||
      'مرحبا ' || pname || '،' || nl || nl ||
      'اشتراكك في قاعتنا الرياضية سينتهي خلال ' || days || ' يوم/أيام.' || nl ||
      'نرجو منك التواصل معنا لتجديده قبل انتهاء المدة.' || nl || nl ||
      '— جمعية نجوم الشاوية';
  elsif kind = 'sub_expired' then
    return 'Bonjour ' || pname || ',' || nl || nl ||
      'Votre abonnement à notre salle de sport a expiré.' || nl ||
      'Contactez-nous pour renouveler votre abonnement.' || nl || nl ||
      '— Association Noujoum el Chaouia' || nl || nl || '---' || nl || nl ||
      'مرحبا ' || pname || '،' || nl || nl ||
      'لقد انتهى اشتراكك في قاعتنا الرياضية.' || nl ||
      'تواصل معنا لتجديد اشتراكك.' || nl || nl ||
      '— جمعية نجوم الشاوية';
  elsif kind = 'ins_expiring' then
    return 'Bonjour ' || pname || ',' || nl || nl ||
      'Votre assurance sportive expire dans ' || days || ' jour(s).' || nl ||
      'Rappel : l''assurance est obligatoire pour accéder à notre salle.' || nl || nl ||
      '— Association Noujoum el Chaouia' || nl || nl || '---' || nl || nl ||
      'مرحبا ' || pname || '،' || nl || nl ||
      'تأمينك الرياضي سينتهي خلال ' || days || ' يوم/أيام.' || nl ||
      'تذكير: التأمين إلزامي للدخول إلى قاعتنا الرياضية.' || nl || nl ||
      '— جمعية نجوم الشاوية';
  elsif kind = 'ins_expired' then
    return 'Bonjour ' || pname || ',' || nl || nl ||
      'Votre assurance sportive a expiré.' || nl ||
      'L''assurance est obligatoire pour accéder à notre salle. Merci de la renouveler.' || nl || nl ||
      '— Association Noujoum el Chaouia' || nl || nl || '---' || nl || nl ||
      'مرحبا ' || pname || '،' || nl || nl ||
      'لقد انتهى تأمينك الرياضي.' || nl ||
      'التأمين إلزامي للدخول إلى قاعتنا الرياضية. نرجو منك تجديده.' || nl || nl ||
      '— جمعية نجوم الشاوية';
  else -- ins_missing
    return 'Bonjour ' || pname || ',' || nl || nl ||
      'Nous n''avons pas encore reçu votre assurance sportive.' || nl ||
      'L''assurance est obligatoire pour accéder à notre salle.' || nl || nl ||
      '— Association Noujoum el Chaouia' || nl || nl || '---' || nl || nl ||
      'مرحبا ' || pname || '،' || nl || nl ||
      'لم نتلقَّ بعد وثيقة تأمينك الرياضي.' || nl ||
      'التأمين إلزامي للدخول إلى قاعتنا الرياضية.' || nl || nl ||
      '— جمعية نجوم الشاوية';
  end if;
end;
$$;

-- ─── Helper : envoie une alerte Telegram (dédupliquée) pour un membre ──
create or replace function _tg_alert(
  p_member uuid, p_name text, p_branch text, p_disc text, p_phone text,
  p_kind text, p_days int, p_ref date, p_header text, p_token text, p_chat text
) returns void language plpgsql as $$
declare
  wa_link text; tg_text text; blabel text; dlabel text;
begin
  if p_token is null or p_token = '' or p_chat is null or p_chat = '' then return; end if;
  -- Anti-doublon : déjà envoyé pour cette échéance ?
  if exists (select 1 from telegram_log where member_id = p_member and type = p_kind and ref_date = p_ref) then
    return;
  end if;
  insert into telegram_log (member_id, type, ref_date) values (p_member, p_kind, p_ref)
    on conflict do nothing;

  blabel := case p_branch when 'rachad' then 'Rachad' when 'sbata' then 'Sbata' else coalesce(p_branch, '—') end;
  dlabel := case p_disc when 'full_contact' then 'Full contact' when 'aerobic' then 'Aérobic'
                        when 'karate' then 'Karaté' else coalesce(p_disc, '—') end;

  wa_link := 'https://wa.me/' || _ma_phone(p_phone) || '?text=' || _url_encode(_wa_message(p_kind, p_name, p_days));

  tg_text := p_header || chr(10) ||
    '👤 ' || p_name || ' — ' || blabel || ' · ' || dlabel || chr(10) ||
    '📞 ' || p_phone || chr(10) ||
    '➡️ Message WhatsApp prêt à envoyer :' || chr(10) || wa_link;

  perform net.http_post(
    url  := 'https://api.telegram.org/bot' || p_token || '/sendMessage',
    body := jsonb_build_object('chat_id', p_chat, 'text', tg_text, 'disable_web_page_preview', true)
  );
end;
$$;

-- ─── generate_notifications() : alertes site + Telegram ──
create or replace function generate_notifications()
returns void language plpgsql as $$
declare
  m       record;
  today   date := current_date;
  tg_token text;
  tg_chat  text;
begin
  select bot_token, chat_id into tg_token, tg_chat from telegram_config where id = 1;

  -- Recalcul propre des notifications non lues (comportement inchangé)
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

    -- Assurance manquante
    if m.is_insured = false then
      insert into notifications (member_id, type, message, is_read, sent_email)
      values (m.id, 'ins_missing', 'Aucune assurance enregistrée', false, false);
      -- rappel hebdomadaire (pas de date d'échéance)
      perform _tg_alert(m.id, m.name, m.branch, m.discipline, m.phone,
        'ins_missing', 0, date_trunc('week', today)::date,
        '🚫 Assurance manquante', tg_token, tg_chat);

    -- Assurance : expire dans 1-30 jours
    elsif m.is_insured = true and m.ins_expiry is not null
          and m.ins_expiry >= today and m.ins_expiry <= today + interval '30 days' then
      insert into notifications (member_id, type, message, is_read, sent_email)
      values (m.id, 'ins_expiring', 'Assurance expire le ' || to_char(m.ins_expiry, 'DD/MM/YYYY'), false, false);
      perform _tg_alert(m.id, m.name, m.branch, m.discipline, m.phone,
        'ins_expiring', (m.ins_expiry - today), m.ins_expiry,
        '🛡️ Assurance expire le ' || to_char(m.ins_expiry, 'DD/MM/YYYY'), tg_token, tg_chat);

    -- Assurance : expirée
    elsif m.is_insured = true and m.ins_expiry is not null and m.ins_expiry < today then
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

-- ============================================================
-- APRÈS la migration — à lancer SÉPARÉMENT avec TES valeurs
-- (ne pas committer tes vrais secrets) :
--
-- insert into telegram_config (id, bot_token, chat_id)
-- values (1, 'TON_BOT_TOKEN', 'TON_CHAT_ID')
-- on conflict (id) do update
--   set bot_token = excluded.bot_token, chat_id = excluded.chat_id;
--
-- Test immédiat (envoie les alertes du jour) :  select generate_notifications();
-- ============================================================
