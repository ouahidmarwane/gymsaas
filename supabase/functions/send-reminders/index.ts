// supabase/functions/send-reminders/index.ts
// Cron Edge Function — runs daily at 08:00 (configured in supabase/config.toml)
// Checks for expiring subscriptions + insurance and sends email reminders

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL      = Deno.env.get('FROM_EMAIL') ?? 'GymFlow <noreply@votresalle.ma>'
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SUB_WARN_DAYS = 7
const INS_WARN_DAYS = 30

// ─── Email templates ──────────────────────────────────────────

function subExpiringEmail(name: string, daysLeft: number, phone: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f9fb;font-family:Inter,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#111;padding:32px 40px">
    <div style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">GymFlow</div>
    <div style="color:#9ca3af;font-size:13px;margin-top:4px">Gestion de salle de sport</div>
  </div>
  <div style="padding:32px 40px">
    <div style="font-size:32px;margin-bottom:16px">📅</div>
    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px">Renouvellement d'abonnement</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
      Bonjour <strong style="color:#111">${name}</strong>,<br><br>
      Votre abonnement à notre salle expire dans <strong style="color:#f59e0b">${daysLeft} jour${daysLeft > 1 ? 's' : ''}</strong>.
      Pour continuer à profiter de nos installations, pensez à renouveler votre abonnement.
    </p>
    <div style="background:#f9fafb;border-radius:12px;padding:16px 20px;border-left:4px solid #f59e0b;margin-bottom:24px">
      <div style="font-size:13px;color:#6b7280">Pour renouveler, contactez-nous :</div>
      <div style="font-size:15px;font-weight:700;color:#111;margin-top:4px">${phone}</div>
    </div>
    <p style="color:#9ca3af;font-size:13px;margin:0">Merci de votre fidélité — L'équipe GymFlow</p>
  </div>
</div>
</body>
</html>`
}

function subExpiredEmail(name: string, phone: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<body style="margin:0;padding:0;background:#f8f9fb;font-family:Inter,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#111;padding:32px 40px">
    <div style="color:#fff;font-size:22px;font-weight:900">GymFlow</div>
  </div>
  <div style="padding:32px 40px">
    <div style="font-size:32px;margin-bottom:16px">❌</div>
    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px">Abonnement expiré</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
      Bonjour <strong style="color:#111">${name}</strong>,<br><br>
      Votre abonnement a expiré. Nous espérons vous revoir bientôt !
      Contactez-nous pour le renouveler et reprendre l'entraînement.
    </p>
    <div style="background:#fef2f2;border-radius:12px;padding:16px 20px;border-left:4px solid #ef4444;margin-bottom:24px">
      <div style="font-size:13px;color:#6b7280">Contactez-nous :</div>
      <div style="font-size:15px;font-weight:700;color:#111;margin-top:4px">${phone}</div>
    </div>
  </div>
</div>
</body>
</html>`
}

function insExpiringEmail(name: string, daysLeft: number, phone: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<body style="margin:0;padding:0;background:#f8f9fb;font-family:Inter,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#111;padding:32px 40px">
    <div style="color:#fff;font-size:22px;font-weight:900">GymFlow</div>
  </div>
  <div style="padding:32px 40px">
    <div style="font-size:32px;margin-bottom:16px">🛡️</div>
    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px">Renouvellement d'assurance</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
      Bonjour <strong style="color:#111">${name}</strong>,<br><br>
      Votre assurance sportive expire dans <strong style="color:#f59e0b">${daysLeft} jour${daysLeft > 1 ? 's' : ''}</strong>.
      L'assurance est obligatoire pour accéder à notre salle. Pensez à la renouveler.
    </p>
    <div style="background:#f5f3ff;border-radius:12px;padding:16px 20px;border-left:4px solid #8b5cf6;margin-bottom:24px">
      <div style="font-size:13px;color:#6b7280">Contactez-nous :</div>
      <div style="font-size:15px;font-weight:700;color:#111;margin-top:4px">${phone}</div>
    </div>
  </div>
</div>
</body>
</html>`
}

function insMissingEmail(name: string, phone: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<body style="margin:0;padding:0;background:#f8f9fb;font-family:Inter,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#111;padding:32px 40px">
    <div style="color:#fff;font-size:22px;font-weight:900">GymFlow</div>
  </div>
  <div style="padding:32px 40px">
    <div style="font-size:32px;margin-bottom:16px">🚫</div>
    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px">Assurance requise</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
      Bonjour <strong style="color:#111">${name}</strong>,<br><br>
      Nous n'avons pas encore votre assurance sportive dans notre système.
      L'assurance est obligatoire pour accéder à notre salle.
      Merci de nous la communiquer dès que possible.
    </p>
    <div style="background:#fdf4ff;border-radius:12px;padding:16px 20px;border-left:4px solid #a855f7;margin-bottom:24px">
      <div style="font-size:13px;color:#6b7280">Contactez-nous :</div>
      <div style="font-size:15px;font-weight:700;color:#111;margin-top:4px">${phone}</div>
    </div>
  </div>
</div>
</body>
</html>`
}

// ─── Send email via Resend ────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!to) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Main handler ─────────────────────────────────────────────

Deno.serve(async (req) => {
  // Simple auth check — Supabase sends Authorization header for cron jobs
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${SERVICE_KEY}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const today = new Date().toISOString().split('T')[0]

  const results = { processed: 0, emails_sent: 0, notifications: 0, errors: [] as string[] }

  // Fetch all members
  const { data: members, error: membersError } = await supabase
    .from('members')
    .select('*')

  if (membersError) {
    return new Response(JSON.stringify({ error: membersError.message }), { status: 500 })
  }

  for (const member of members ?? []) {
    results.processed++

    // Helper: check if reminder was already sent today
    const alreadySent = async (type: string) => {
      const { data } = await supabase
        .from('reminder_log')
        .select('id')
        .eq('member_id', member.id)
        .eq('type', type)
        .gte('sent_at', today)
        .single()
      return !!data
    }

    const logReminder = async (type: string) => {
      await supabase.from('reminder_log').insert({ member_id: member.id, type })
    }

    const createNotif = async (type: string, message: string) => {
      await supabase.from('notifications').insert({
        member_id: member.id,
        type,
        message,
        is_read: false,
        sent_email: !!member.email,
      })
      results.notifications++
    }

    // ── Subscription checks ──────────────────────────────────

    if (member.sub_expiry) {
      const subDays = Math.ceil(
        (new Date(member.sub_expiry).getTime() - Date.now()) / 86400000
      )

      // Expiring soon (within SUB_WARN_DAYS)
      if (subDays >= 0 && subDays <= SUB_WARN_DAYS) {
        const type = 'sub_expiring'
        if (!(await alreadySent(type))) {
          const msg = `L'abonnement de ${member.name} expire dans ${subDays} jour(s) (${member.sub_expiry})`
          await createNotif(type, msg)
          await logReminder(type)
          if (member.email) {
            const ok = await sendEmail(member.email, `⏰ Votre abonnement expire dans ${subDays} jour(s)`, subExpiringEmail(member.name, subDays, member.phone))
            if (ok) results.emails_sent++
          }
        }
      }

      // Already expired
      if (subDays < 0) {
        const type = 'sub_expired'
        if (!(await alreadySent(type))) {
          const msg = `L'abonnement de ${member.name} a expiré le ${member.sub_expiry}`
          await createNotif(type, msg)
          await logReminder(type)
          if (member.email) {
            const ok = await sendEmail(member.email, '❌ Votre abonnement a expiré', subExpiredEmail(member.name, member.phone))
            if (ok) results.emails_sent++
          }
        }
      }
    }

    // ── Insurance checks ─────────────────────────────────────

    // Not insured at all
    if (!member.is_insured) {
      const type = 'ins_missing'
      if (!(await alreadySent(type))) {
        const msg = `${member.name} n'a pas d'assurance sportive`
        await createNotif(type, msg)
        await logReminder(type)
        if (member.email) {
          const ok = await sendEmail(member.email, '🚫 Assurance sportive requise', insMissingEmail(member.name, member.phone))
          if (ok) results.emails_sent++
        }
      }
      continue // Skip ins_expiry checks
    }

    if (member.ins_expiry) {
      const insDays = Math.ceil(
        (new Date(member.ins_expiry).getTime() - Date.now()) / 86400000
      )

      // Expiring soon
      if (insDays >= 0 && insDays <= INS_WARN_DAYS) {
        const type = 'ins_expiring'
        if (!(await alreadySent(type))) {
          const msg = `L'assurance de ${member.name} expire dans ${insDays} jour(s) (${member.ins_expiry})`
          await createNotif(type, msg)
          await logReminder(type)
          if (member.email) {
            const ok = await sendEmail(member.email, `🛡️ Votre assurance expire dans ${insDays} jour(s)`, insExpiringEmail(member.name, insDays, member.phone))
            if (ok) results.emails_sent++
          }
        }
      }

      // Expired
      if (insDays < 0) {
        const type = 'ins_expired'
        if (!(await alreadySent(type))) {
          const msg = `L'assurance de ${member.name} a expiré le ${member.ins_expiry}`
          await createNotif(type, msg)
          await logReminder(type)
          // Don't email member about expired insurance — notify admin via platform only
        }
      }
    }
  }

  // ── Championship checks ──────────────────────────────────────
  // 1. Admin reminders before championship date
  const { data: upcomingChamps } = await supabase
    .from('championships')
    .select('id, name, date, reminder_days_before')
    .in('status', ['upcoming', 'ongoing'])

  for (const champ of upcomingChamps ?? []) {
    const daysUntil = Math.ceil(
      (new Date(champ.date).getTime() - Date.now()) / 86400000
    )
    const reminderDays: number[] = champ.reminder_days_before ?? [30, 14, 7, 3, 1]
    if (!reminderDays.includes(daysUntil)) continue

    const reminderType = `champ_admin_${daysUntil}d`
    const { data: alreadyLogged } = await supabase
      .from('championship_reminder_log')
      .select('id')
      .eq('championship_id', champ.id)
      .is('member_id', null)
      .eq('reminder_type', reminderType)
      .gte('sent_at', today)
      .single()

    if (!alreadyLogged) {
      await supabase.from('championship_reminder_log').insert({
        championship_id: champ.id,
        member_id:       null,
        reminder_type:   reminderType,
      })
      // Admin notification
      await supabase.from('notifications').insert({
        member_id: null,
        type:      'sub_expiring', // reuse existing type slot — admins see all notifications
        message:   `🏆 Championnat "${champ.name}" dans ${daysUntil} jour(s) (${champ.date})`,
        is_read:   false,
        sent_email: false,
      })
      results.notifications++
    }
  }

  // 2. Weekly report reminders to athletes
  const todayDate  = new Date()
  const todayDow   = todayDate.getDay() // 0=Sunday

  const { data: champsForReports } = await supabase
    .from('championships')
    .select('id, name, weekly_report_day, report_deadline_hour')
    .in('status', ['upcoming', 'ongoing'])

  for (const champ of champsForReports ?? []) {
    if (champ.weekly_report_day !== todayDow) continue

    const { data: athletes } = await supabase
      .from('championship_athletes')
      .select('member_id, members(name, email)')
      .eq('championship_id', champ.id)

    for (const ath of athletes ?? []) {
      const memberId   = ath.member_id
      const memberName = (ath.members as any)?.name ?? ''
      const email      = (ath.members as any)?.email ?? ''

      // Check if report already submitted this week
      const { data: submitted } = await supabase
        .from('weekly_reports')
        .select('id')
        .eq('championship_id', champ.id)
        .eq('member_id', memberId)
        .gte('submitted_at', `${today}T00:00:00Z`)
        .single()

      if (submitted) continue

      const reminderType = `weekly_report_${today}`
      const { data: alreadyReminded } = await supabase
        .from('championship_reminder_log')
        .select('id')
        .eq('championship_id', champ.id)
        .eq('member_id', memberId)
        .eq('reminder_type', reminderType)
        .single()

      if (!alreadyReminded) {
        await supabase.from('championship_reminder_log').insert({
          championship_id: champ.id,
          member_id:       memberId,
          reminder_type:   reminderType,
        })

        if (email) {
          const { data: tokenRow } = await supabase
            .from('portal_tokens')
            .select('token')
            .eq('championship_id', champ.id)
            .eq('member_id', memberId)
            .eq('is_active', true)
            .single()

          const baseUrl    = Deno.env.get('APP_URL') ?? Deno.env.get('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000'
          const portalLink = tokenRow?.token ? `${baseUrl}/portal/${tokenRow.token}` : baseUrl

          const html = `
<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#f8f9fb;font-family:Inter,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#111;padding:32px 40px"><div style="color:#fff;font-size:22px;font-weight:900">GymFlow</div></div>
  <div style="padding:32px 40px">
    <div style="font-size:32px;margin-bottom:16px">🏆</div>
    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px">Rapport hebdomadaire</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
      Bonjour <strong style="color:#111">${memberName}</strong>,<br><br>
      Veuillez remplir votre formulaire de suivi pour le championnat <strong>"${champ.name}"</strong>.
    </p>
    <a href="${portalLink}" style="display:inline-block;background:#111;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700">Remplir le formulaire</a>
  </div>
</div>
</body></html>`

          const ok = await sendEmail(email, `📋 Rapport hebdomadaire — ${champ.name}`, html)
          if (ok) results.emails_sent++
        }
      }
    }
  }

  // 3. Follow-up for athletes who haven't submitted after 2 days
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0]
  const { data: champsOngoing } = await supabase
    .from('championships')
    .select('id, name')
    .eq('status', 'ongoing')

  for (const champ of champsOngoing ?? []) {
    const { data: athletes } = await supabase
      .from('championship_athletes')
      .select('member_id, members(name, email)')
      .eq('championship_id', champ.id)

    for (const ath of athletes ?? []) {
      const memberId = ath.member_id
      const email    = (ath.members as any)?.email ?? ''
      if (!email) continue

      const { data: recentReport } = await supabase
        .from('weekly_reports')
        .select('id')
        .eq('championship_id', champ.id)
        .eq('member_id', memberId)
        .gte('submitted_at', `${twoDaysAgo}T00:00:00Z`)
        .single()

      if (recentReport) continue

      const followupType = `followup_${twoDaysAgo}`
      const { data: alreadySentFollowup } = await supabase
        .from('championship_reminder_log')
        .select('id')
        .eq('championship_id', champ.id)
        .eq('member_id', memberId)
        .eq('reminder_type', followupType)
        .single()

      if (!alreadySentFollowup) {
        const { data: tokenRow } = await supabase
          .from('portal_tokens')
          .select('token')
          .eq('championship_id', champ.id)
          .eq('member_id', memberId)
          .eq('is_active', true)
          .single()

        const baseUrl    = Deno.env.get('APP_URL') ?? Deno.env.get('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000'
        const portalLink = tokenRow?.token ? `${baseUrl}/portal/${tokenRow.token}` : baseUrl
        const memberName = (ath.members as any)?.name ?? ''

        const html = `
<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#f8f9fb;font-family:Inter,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
  <div style="background:#111;padding:32px 40px"><div style="color:#fff;font-size:22px;font-weight:900">GymFlow</div></div>
  <div style="padding:32px 40px">
    <div style="font-size:32px;margin-bottom:16px">⚠️</div>
    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px">Rapport en attente</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
      Bonjour <strong style="color:#111">${memberName}</strong>,<br><br>
      Votre rapport de suivi pour <strong>"${champ.name}"</strong> n'a pas encore été soumis. Il est important de le remplir pour permettre au staff de suivre votre préparation.
    </p>
    <a href="${portalLink}" style="display:inline-block;background:#f59e0b;color:#111;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700">Remplir maintenant</a>
  </div>
</div>
</body></html>`

        const ok = await sendEmail(email, `⚠️ Rapport manquant — ${champ.name}`, html)
        if (ok) {
          results.emails_sent++
          await supabase.from('championship_reminder_log').insert({
            championship_id: champ.id,
            member_id:       memberId,
            reminder_type:   followupType,
          })
        }
      }
    }
  }

  console.log('[send-reminders]', results)
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  })
})
