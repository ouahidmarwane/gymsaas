'use server'
// lib/actions.ts
// All server actions — called from Client Components via useTransition

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile as getCurrentProfileCached } from '@/lib/get-current-profile'
import { DEFAULT_PRICES, type Prices } from '@/lib/prices'
import type { UserRole, AuditAction, ChampionshipStatus } from '@/types'

// ─── Audit log helper ─────────────────────────────────────────

async function logAudit(supabase: ReturnType<typeof import('@/lib/supabase/server').createClient>, opts: {
  action: AuditAction
  entity: string
  entity_id?: string | null
  entity_name?: string | null
  details?: Record<string, unknown> | null
  profile: { id: string; name: string; role: string; branch?: string | null } | null
  branch?: string | null
}) {
  try {
    // Écrit via le service role : le journal n'est plus insérable directement
    // par un utilisateur (empêche la forge d'entrées). Les valeurs performer_*
    // sont dérivées du profil authentifié côté serveur, jamais du client.
    const admin = createAdminClient()
    await admin.from('audit_logs').insert({
      action:         opts.action,
      entity:         opts.entity,
      entity_id:      opts.entity_id ?? null,
      entity_name:    opts.entity_name ?? null,
      details:        opts.details ?? null,
      performed_by:   opts.profile?.id ?? null,
      performer_name: opts.profile?.name ?? null,
      performer_role: opts.profile?.role ?? null,
      branch:         opts.branch ?? opts.profile?.branch ?? null,
    })
  } catch {
    // Audit failure must never block the main operation
  }
}

export async function getAuditLogs(limit = 200) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  // Historique des actions : réservé à l'administrateur
  if (!profile || profile.role !== 'admin') return []
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return data ?? []
}

// ─── Auth helpers ─────────────────────────────────────────────

// Ré-exporté comme server action ; la vraie logique est mémoïsée par requête
// (React.cache) dans lib/get-current-profile → déduplication des appels.
export async function getCurrentProfile() {
  return getCurrentProfileCached()
}

// Défense en profondeur (en plus de la RLS 013) : grades & championnats sont
// réservés au karaté. Autorisé si admin, poste transversal (discipline null)
// ou personnel karaté. Full contact / aérobic : refusés.
function isKarateProfile(profile: { role?: string; discipline?: string | null } | null): boolean {
  return !!profile && (profile.role === 'admin' || !profile.discipline || profile.discipline === 'karate')
}

// Superadmin : admin avec pouvoirs étendus (gestion des admins, tarifs,
// supervision, force-déconnexion d'un admin). Voir migration 025.
function isSuper(profile: { role?: string; is_superadmin?: boolean } | null): boolean {
  return !!profile && profile.role === 'admin' && profile.is_superadmin === true
}

// ─── Sécurité : alertes Telegram + journal des événements ─────────────
// Envoie une alerte Telegram (lit la config dans telegram_config, via service role).
async function sendTelegramAlert(text: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('telegram_config').select('bot_token, chat_id').eq('id', 1).maybeSingle()
    if (!data?.bot_token || !data?.chat_id) return
    await fetch(`https://api.telegram.org/bot${data.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: data.chat_id, text, disable_web_page_preview: true }),
    })
  } catch { /* non bloquant */ }
}

// Adresse publique du site, pour rendre les liens des alertes cliquables
// depuis Telegram (un chemin nu comme « /supervision » n'y est pas un lien).
// En production on privilégie le domaine Vercel : NEXT_PUBLIC_SITE_URL sert au
// développement et pointe sur le réseau local, inaccessible depuis un téléphone.
function siteUrl(): string {
  const isLocal = (u: string) => /localhost|127\.0\.0\.1|192\.168\.|10\.\d|172\.(1[6-9]|2\d|3[01])\./.test(u)
  const explicit = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || ''
  if (explicit && !isLocal(explicit)) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`
  return explicit.replace(/\/+$/, '') || 'http://localhost:3000'
}

function clientMeta(): { ip: string; ua: string; geo: string } {
  try {
    const h = headers()
    const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'inconnue'
    const ua = h.get('user-agent') ?? 'inconnu'
    // Vercel joint la géolocalisation de l'IP aux en-têtes — gratuit, aucun
    // appel externe. Absent en local : l'IP privée n'est pas localisable.
    const dec = (v: string | null) => { try { return v ? decodeURIComponent(v) : '' } catch { return v ?? '' } }
    const city = dec(h.get('x-vercel-ip-city'))
    const country = dec(h.get('x-vercel-ip-country'))
    const geo = [city, country].filter(Boolean).join(', ')
    return { ip, ua, geo }
  } catch {
    return { ip: 'inconnue', ua: 'inconnu', geo: '' }
  }
}

// Ligne « IP » d'une alerte : ajoute le lieu quand Vercel le fournit, et
// signale explicitement une adresse de réseau local (non routable sur Internet).
function ipLine(ip: string, geo: string): string {
  const isPrivate = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/.test(ip)
  const suffix = geo ? ` · ${geo}` : isPrivate ? ' · réseau local' : ''
  return `🌐 IP ${ip}${suffix}`
}

async function logSecurity(
  eventType: string, detail: string,
  profile: { user_id?: string; id?: string; name?: string; role?: string } | null,
  ip?: string, ua?: string,
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('security_events').insert({
      user_id: profile?.user_id ?? null, profile_id: profile?.id ?? null,
      name: profile?.name ?? null, role: profile?.role ?? null,
      event_type: eventType, detail, ip: ip ?? null, user_agent: ua ?? null,
    })
  } catch { /* non bloquant */ }
}

// Tentative d'action non autorisée par un compte connecté (escalade de privilèges).
// Anti-spam : une alerte par (utilisateur, cible) toutes les 15 min.
async function denySecurity(profile: any, target: string): Promise<void> {
  const { ip, ua, geo } = clientMeta()
  try {
    const admin = createAdminClient()
    const since = new Date(Date.now() - 15 * 60_000).toISOString()
    const { data: recent } = await admin.from('security_events')
      .select('id').eq('event_type', 'access_denied').eq('user_id', profile?.user_id ?? '')
      .eq('detail', target).gte('created_at', since).maybeSingle()
    await logSecurity('access_denied', target, profile, ip, ua)
    if (!recent) {
      await sendTelegramAlert(
        `🚫 Action non autorisée\n👤 ${profile?.name ?? '?'} (${profile?.role ?? '?'})\n🎯 ${target}\n${ipLine(ip, geo)}\n\n🔎 Supervision : ${siteUrl()}/supervision`,
      )
    }
  } catch { /* non bloquant */ }
}

// Connexion réussie : détecte un nouvel appareil (appelé après login).
export async function recordLogin(deviceId: string): Promise<void> {
  const profile = await getCurrentProfile()
  if (!profile || !deviceId) return
  const { ip, ua, geo } = clientMeta()
  const admin = createAdminClient()
  const { data: known } = await admin.from('login_devices')
    .select('device_id').eq('user_id', profile.user_id).eq('device_id', deviceId).maybeSingle()
  if (!known) {
    await logSecurity('new_device_login', 'Connexion depuis un nouvel appareil', profile, ip, ua)
    await sendTelegramAlert(
      `🔐 Nouvelle connexion\n👤 ${profile.name} (${profile.role})\n${ipLine(ip, geo)}\n🖥️ ${ua}\n\n⚠️ Si ce n'est pas vous, ouvrez la supervision pour déconnecter ce compte et changer son mot de passe :\n${siteUrl()}/supervision`,
    )
  }
  await admin.from('login_devices').upsert({
    user_id: profile.user_id, device_id: deviceId,
    last_seen: new Date().toISOString(), last_ip: ip, user_agent: ua,
  }, { onConflict: 'user_id,device_id' })
}

// Échec de connexion : détecte le brute-force (appelé après un échec de login).
export async function recordFailedLogin(identifier: string): Promise<void> {
  const { ip, ua, geo } = clientMeta()
  const admin = createAdminClient()
  const idShort = (identifier ?? '').slice(0, 120)
  await admin.from('login_attempts').insert({ ip, identifier: idShort })
  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count } = await admin.from('login_attempts')
    .select('id', { count: 'exact', head: true }).eq('ip', ip).gte('attempted_at', since)
  if ((count ?? 0) >= 5) {
    const { data: recentAlert } = await admin.from('security_events')
      .select('id').eq('event_type', 'failed_login_burst').eq('ip', ip).gte('created_at', since).maybeSingle()
    if (!recentAlert) {
      await logSecurity('failed_login_burst', `${count} tentatives échouées en 15 min (dernier identifiant : ${idShort})`, null, ip, ua)
      await sendTelegramAlert(
        `🚨 Tentatives de connexion suspectes\n${ipLine(ip, geo)}\n❌ ${count} échecs en 15 min\n🔑 Dernier identifiant : ${idShort}\n\n🔎 Supervision : ${siteUrl()}/supervision`,
      )
    }
  }
}

// Liste des événements de sécurité récents (admin — page /supervision)
export async function getSecurityEvents() {
  const profile = await getCurrentProfile()
  if (!isSuper(profile)) return []   // supervision : superadmin uniquement
  const supabase = createClient()
  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const { data } = await supabase.from('security_events')
    .select('id, user_id, name, role, event_type, detail, ip, created_at, handled_at')
    .gte('created_at', since).order('created_at', { ascending: false }).limit(50)
  return data ?? []
}

// Marquer une alerte de sécurité comme traitée / ignorée (superadmin)
export async function dismissSecurityEvent(eventId: string) {
  const profile = await getCurrentProfile()
  if (!isSuper(profile)) return { error: 'Superadmin uniquement' }
  const supabase = createClient()
  const { error } = await supabase
    .from('security_events')
    .update({ handled_at: new Date().toISOString(), handled_by: profile!.user_id })
    .eq('id', eventId)
  if (error) return { error: error.message }
  revalidatePath('/supervision')
  return { success: true }
}

export async function signOut() {
  const supabase = createClient()
  // Retirer la présence avant de fermer la session (RLS user)
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await supabase.from('staff_presence').delete().eq('user_id', user.id)
  } catch { /* non bloquant */ }
  await supabase.auth.signOut()
  revalidatePath('/')
}

// ─── Connexion par nom d'utilisateur OU email ──────────────────
// Le login accepte le nom saisi à la création du compte (profiles.name)
// en plus de l'email. On résout le nom → email côté serveur (service_role,
// car profiles est protégé par RLS pour les visiteurs anonymes).
export async function resolveLoginEmail(identifier: string): Promise<{ email?: string; error?: string }> {
  const id = (identifier ?? '').trim()
  if (!id) return { error: 'Identifiant requis' }
  // Déjà un email → tel quel
  if (id.includes('@')) return { email: id }

  const admin = createAdminClient()
  // Échapper les métacaractères LIKE (% et _) pour empêcher l'énumération
  // des emails du personnel via un motif joker (ex. "a%").
  const escaped = id.replace(/([%_\\])/g, '\\$1')
  const { data, error } = await admin
    .from('profiles')
    .select('email, name')
    .ilike('name', escaped)     // insensible à la casse, correspondance exacte
  if (error) return { error: 'Erreur de connexion' }
  const matches = data ?? []
  if (matches.length === 0) return { error: 'Identifiant ou mot de passe incorrect.' }
  if (matches.length > 1) return { error: 'Plusieurs comptes portent ce nom — connectez-vous avec votre email.' }
  return { email: matches[0].email }
}

// ─── Supervision : présence des comptes connectés ──────────────
// Battement de présence en UNE seule requête (RPC touch_presence, migration
// 024). Détecte le kick admin (revoked) et (ré)initialise login_at selon
// l'inactivité, côté base. Renvoie { revoked, loginAt }.
export async function touchPresence(): Promise<{ revoked: boolean; loginAt: string | null }> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('touch_presence')
  const row = Array.isArray(data) ? data[0] : null
  if (error || !row) return { revoked: false, loginAt: null }
  return { revoked: !!row.revoked, loginAt: row.login_at ?? null }
}

// Force-déconnexion d'un compte par l'admin (révocation serveur + kick client)
export async function forceSignOutUser(userId: string) {
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin') {
    if (profile) await denySecurity(profile, 'Force-déconnexion d\'un compte (réservé admin)')
    return { error: 'Admin uniquement' }
  }
  // Déconnecter un admin / superadmin est réservé au superadmin
  if (!isSuper(profile)) {
    const admin = createAdminClient()
    const { data: target } = await admin
      .from('profiles').select('role, is_superadmin').eq('user_id', userId).maybeSingle()
    if (target && (target.role === 'admin' || target.is_superadmin)) {
      await denySecurity(profile, 'Force-déconnexion d\'un admin (réservé superadmin)')
      return { error: 'Seul un superadmin peut déconnecter un administrateur' }
    }
  }
  const supabase = createClient()
  const { error } = await supabase.rpc('force_logout_user', { uid: userId })
  if (error) return { error: error.message }
  return { success: true }
}

export async function endPresence() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) await supabase.from('staff_presence').delete().eq('user_id', user.id)
}

export async function getActiveSessions() {
  const profile = await getCurrentProfile()
  if (!isSuper(profile)) return []   // supervision : superadmin uniquement
  const supabase = createClient()
  // "En ligne" = vu il y a moins de 2 min 10 s (aligné sur l'auto-déconnexion).
  const cutoff = new Date(Date.now() - 130_000).toISOString()
  const { data } = await supabase
    .from('staff_presence')
    .select('user_id, name, email, role, branch, discipline, login_at, last_seen_at')
    .gte('last_seen_at', cutoff)
    .order('login_at', { ascending: true })
  return data ?? []
}

// Modifier son nom / son email est réservé à l'administrateur (et donc au
// superadmin). Un réceptionniste ou un lecteur doit passer par un admin :
// son email est son identifiant de connexion et son nom sert de nom
// d'utilisateur (resolveLoginEmail) — les laisser modifiables permettrait de
// brouiller le journal d'audit et la supervision.
export async function updateProfile(name: string, email: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Utilisateur non connecté' }

  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin') {
    if (profile) await denySecurity(profile, 'Modification de son nom / email (réservé admin)')
    return { error: 'Seul un administrateur peut modifier le nom ou l\'email d\'un compte. Contactez votre administrateur.' }
  }

  if (email) {
    const { error: authError } = await supabase.auth.updateUser({ email })
    if (authError) return { error: authError.message }
  }

  const updates: { name?: string; email?: string } = {}
  if (name) updates.name = name
  if (email) updates.email = email

  const { error: profileError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('user_id', user.id)

  if (profileError) return { error: profileError.message }
  revalidatePath('/account')
  return { success: true }
}

// ─── Robustesse des mots de passe (équivalent gratuit de la feature Pro) ──
// Vérifie la longueur minimale + la présence du mot de passe dans les fuites
// connues via l'API publique HaveIBeenPwned (k-anonymat : on n'envoie que les
// 5 premiers caractères d'un hash SHA-1, jamais le mot de passe). Aucune clé,
// aucun domaine requis. Renvoie un message d'erreur, ou null si OK.
const MIN_PASSWORD_LENGTH = 10
async function validatePasswordStrength(password: string): Promise<string | null> {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`
  }
  try {
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha1').update(password).digest('hex').toUpperCase()
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      // ne pas bloquer l'inscription si HIBP est lent/indispo
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null // fail-open : indispo ≠ blocage
    const body = await res.text()
    const compromised = body.split('\n').some(line => {
      const [suf, count] = line.split(':')
      return suf.trim() === suffix && Number(count) > 0
    })
    if (compromised) {
      return 'Ce mot de passe figure dans des fuites de données connues. Choisis-en un autre.'
    }
    return null
  } catch {
    return null // fail-open sur erreur réseau
  }
}

export async function updatePassword(currentPassword: string, password: string) {
  if (!currentPassword || !password) {
    return { error: 'Le mot de passe actuel et le nouveau mot de passe sont requis.' }
  }

  const strengthError = await validatePasswordStrength(password)
  if (strengthError) return { error: strengthError }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return { error: 'Utilisateur non connecté ou email manquant.' }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })
  if (verifyError) {
    return { error: 'Mot de passe actuel incorrect.' }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.message }
  return { success: true }
}

// ─── Members ─────────────────────────────────────────────────

export async function getMembers(branch?: 'sbata' | 'rachad', discipline?: 'karate' | 'full_contact' | 'aerobic') {
  const supabase = createClient()
  let query = supabase.from('members').select('*').order('created_at', { ascending: false })
  if (branch) query = query.eq('branch', branch)
  if (discipline) query = query.eq('discipline', discipline)
  // Note : la RLS cloisonne déjà par succursale + discipline selon le profil.
  // Ces filtres n'ajoutent que la vue choisie par l'admin.
  const { data, error } = await query
  if (error) throw error
  return data
}

// Requête légère : membres sans passeport sportif (page Alertes). Évite de
// charger toutes les colonnes (notes, urls…) juste pour cette liste.
export async function getMembersMissingPassport(
  branch?: 'sbata' | 'rachad',
  discipline?: 'karate' | 'full_contact' | 'aerobic',
) {
  const supabase = createClient()
  let query = supabase
    .from('members')
    .select('id, name, phone')
    .is('sport_passport_url', null)
    .order('name')
  if (branch) query = query.eq('branch', branch)
  if (discipline) query = query.eq('discipline', discipline)
  const { data } = await query
  return data ?? []
}

export async function addMember(formData: {
  name: string
  phone: string
  email?: string
  join_date: string
  sub_expiry?: string
  is_insured: boolean
  ins_expiry?: string
  notes?: string
  branch?: 'sbata' | 'rachad'
  discipline?: 'karate' | 'full_contact' | 'aerobic'
  photo_url?: string
  sport_passport_url?: string
  document_url?: string
  grade?: number
}) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }

  const branch = profile.branch ?? formData.branch ?? 'sbata'
  // Un réceptionniste est verrouillé sur sa discipline ; l'admin choisit.
  const discipline = profile.discipline ?? formData.discipline ?? 'karate'
  const grade = formData.grade ?? 0
  const { discipline: _d, ...rest } = formData
  const { data, error } = await supabase.from('members').insert({
    ...rest,
    created_by: profile.id,
    ins_expiry: formData.is_insured ? formData.ins_expiry : null,
    branch,
    discipline,
    grade,
    photo_url: formData.photo_url ?? null,
    sport_passport_url: formData.sport_passport_url ?? null,
    document_url: formData.document_url ?? null,
  }).select().single()

  if (error) return { error: error.message }

  await logAudit(supabase, {
    action: 'member_add',
    entity: 'member',
    entity_id: data.id,
    entity_name: formData.name,
    details: { phone: formData.phone, branch, discipline, grade },
    profile,
    branch,
  })

  // Passage de grade automatique : KARATÉ uniquement (pas de grades en
  // full contact / aérobic).
  if (discipline === 'karate') {
    try {
      const joinDate = new Date(formData.join_date)
      const eligibleFrom = addMonths(joinDate, 3)
      const firstSession = nextGradeSessionDate(eligibleFrom)
      if (isInGradeSeason(firstSession)) {
        await supabase.from('grade_sessions').insert({
          member_id: data.id,
          grade_before: grade,
          scheduled_date: firstSession.toISOString().split('T')[0],
          status: 'pending',
        })
      }
    } catch {
      // non-blocking
    }
  }

  await recomputeMemberNotifications(data.id)
  revalidatePath('/members')
  revalidatePath('/dashboard')
  revalidatePath('/alerts')
  return { success: true, id: data.id }
}

export async function updateMember(
  id: string,
  formData: Partial<{
    name: string
    phone: string
    email: string
    sub_expiry: string
    is_insured: boolean
    ins_expiry: string
    notes: string
    branch: 'sbata' | 'rachad'
    discipline: 'karate' | 'full_contact' | 'aerobic'
    photo_url: string
    sport_passport_url: string
    document_url: string
  }>,
) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }

  const payload: Record<string, unknown> = {
    ...formData,
    updated_at: new Date().toISOString(),
  }

  // Seul l'admin peut déplacer un membre entre succursales / disciplines.
  if (profile.role !== 'admin') {
    delete payload.branch
    delete payload.discipline
  }

  const { data: memberBefore } = await supabase.from('members').select('name, branch').eq('id', id).single()

  const { error } = await supabase
    .from('members')
    .update(payload)
    .eq('id', id)
  if (error) return { error: error.message }

  await logAudit(supabase, {
    action: 'member_update',
    entity: 'member',
    entity_id: id,
    entity_name: memberBefore?.name ?? null,
    details: { changes: Object.keys(formData) },
    profile,
    branch: memberBefore?.branch ?? null,
  })

  await recomputeMemberNotifications(id)
  revalidatePath('/members')
  revalidatePath('/dashboard')
  revalidatePath('/alerts')
  return { success: true }
}

export async function deleteMember(id: string) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin') {
    if (profile) await denySecurity(profile, 'Suppression d\'un membre (réservé admin)')
    return { error: 'Admin uniquement' }
  }

  const { data: memberToDelete } = await supabase.from('members').select('name, branch').eq('id', id).single()

  // Supprimer d'abord de Supabase
  const { error } = await supabase.from('members').delete().eq('id', id)
  if (error) return { error: error.message }

  await logAudit(supabase, {
    action: 'member_delete',
    entity: 'member',
    entity_id: id,
    entity_name: memberToDelete?.name ?? null,
    details: { branch: memberToDelete?.branch },
    profile,
    branch: memberToDelete?.branch ?? null,
  })

  revalidatePath('/members')
  revalidatePath('/dashboard')
  return { success: true }
}

function fmtDateFr(d: string): string {
  const dt = new Date(d)
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${dt.getFullYear()}`
}

// Recalcule les notifications d'UN membre selon son état courant. Appelé
// après un renouvellement / une modification → l'alerte régularisée disparaît
// IMMÉDIATEMENT au lieu d'attendre le cron quotidien. N'envoie PAS de Telegram
// (c'est le rôle du job quotidien generate_notifications). Utilise le service
// role car un réceptionniste n'a pas le droit de supprimer des notifications.
async function recomputeMemberNotifications(memberId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: m } = await admin
      .from('members')
      .select('sub_expiry, is_insured, ins_expiry')
      .eq('id', memberId)
      .maybeSingle()
    if (!m) return
    await admin.from('notifications').delete().eq('member_id', memberId)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const daysTo = (d: string) => Math.ceil((new Date(d).getTime() - today.getTime()) / 86400000)
    const rows: any[] = []
    if (m.sub_expiry) {
      const dd = daysTo(m.sub_expiry)
      if (dd >= 0 && dd <= 7) rows.push({ member_id: memberId, type: 'sub_expiring', message: `Abonnement expire le ${fmtDateFr(m.sub_expiry)}`, is_read: false, sent_email: false })
      else if (dd < 0)        rows.push({ member_id: memberId, type: 'sub_expired',  message: `Abonnement expiré depuis le ${fmtDateFr(m.sub_expiry)}`, is_read: false, sent_email: false })
    }
    if (!m.is_insured || !m.ins_expiry) {
      rows.push({ member_id: memberId, type: 'ins_missing', message: 'Aucune assurance enregistrée', is_read: false, sent_email: false })
    } else {
      const dd = daysTo(m.ins_expiry)
      if (dd >= 0 && dd <= 30) rows.push({ member_id: memberId, type: 'ins_expiring', message: `Assurance expire le ${fmtDateFr(m.ins_expiry)}`, is_read: false, sent_email: false })
      else if (dd < 0)         rows.push({ member_id: memberId, type: 'ins_expired',  message: `Assurance expirée depuis le ${fmtDateFr(m.ins_expiry)}`, is_read: false, sent_email: false })
    }
    if (rows.length) await admin.from('notifications').insert(rows)
  } catch { /* non bloquant */ }
}

export async function renewSubscription(memberId: string) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }

  // Get current member data
  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('sub_expiry')
    .eq('id', memberId)
    .single()

  if (fetchError || !member) {
    return { error: 'Membre introuvable' }
  }

  // Calculate new expiry date
  const currentDate = new Date()
  let baseDate: Date

  if (member.sub_expiry) {
    const expiryDate = new Date(member.sub_expiry)
    // If already expired, start from today, otherwise extend current expiry
    baseDate = expiryDate < currentDate ? currentDate : expiryDate
  } else {
    baseDate = currentDate
  }

  // Add exactly 1 month
  const newExpiry = new Date(baseDate)
  newExpiry.setMonth(newExpiry.getMonth() + 1)

  // Update member
  const { error: updateError } = await supabase
    .from('members')
    .update({
      sub_expiry: newExpiry.toISOString().split('T')[0], // YYYY-MM-DD format
      updated_at: new Date().toISOString()
    })
    .eq('id', memberId)

  if (updateError) {
    return { error: updateError.message }
  }

  await logAudit(supabase, {
    action: 'subscription_renew',
    entity: 'member',
    entity_id: memberId,
    entity_name: member ? null : null,
    details: { new_expiry: newExpiry.toISOString().split('T')[0] },
    profile,
  })

  // L'alerte "abonnement expiré/expire" du membre disparaît immédiatement
  await recomputeMemberNotifications(memberId)
  revalidatePath('/members')
  revalidatePath('/dashboard')
  revalidatePath('/alerts')

  return {
    success: true,
    newExpiry: newExpiry.toLocaleDateString('fr-FR')
  }
}

export async function renewInsurance(memberId: string) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }

  // Get current member data
  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('ins_expiry')
    .eq('id', memberId)
    .single()

  if (fetchError || !member) {
    return { error: 'Membre introuvable' }
  }

  // Calculate new expiry date
  const currentDate = new Date()
  let baseDate: Date

  if (member.ins_expiry) {
    const expiryDate = new Date(member.ins_expiry)
    // If already expired, start from today, otherwise extend current expiry
    baseDate = expiryDate < currentDate ? currentDate : expiryDate
  } else {
    baseDate = currentDate
  }

  // Add exactly 1 year
  const newExpiry = new Date(baseDate)
  newExpiry.setFullYear(newExpiry.getFullYear() + 1)

  // Update member
  const { error: updateError } = await supabase
    .from('members')
    .update({
      ins_expiry: newExpiry.toISOString().split('T')[0], // YYYY-MM-DD format
      is_insured: true,
      updated_at: new Date().toISOString()
    })
    .eq('id', memberId)

  if (updateError) {
    return { error: updateError.message }
  }

  await logAudit(supabase, {
    action: 'insurance_renew',
    entity: 'member',
    entity_id: memberId,
    details: { new_expiry: newExpiry.toISOString().split('T')[0] },
    profile,
  })

  // L'alerte "assurance expirée/manquante" du membre disparaît immédiatement
  await recomputeMemberNotifications(memberId)
  revalidatePath('/members')
  revalidatePath('/dashboard')
  revalidatePath('/alerts')

  return {
    success: true,
    newExpiry: newExpiry.toLocaleDateString('fr-FR')
  }
}

export async function getNotifications(
  branch?: 'sbata' | 'rachad',
  discipline?: 'karate' | 'full_contact' | 'aerobic',
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Fetch a wider window then filter, so branch/discipline filters are not
  // silently truncated by the limit. Notifications without a member (rappels
  // championnat) appartiennent au karaté. On inclut sub_expiry/ins_expiry pour
  // calculer correctement le "dans X jours" du message WhatsApp.
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, message, is_read, sent_email, created_at, member_id, members(name, phone, branch, discipline, sub_expiry, ins_expiry)')
    .order('created_at', { ascending: false })
    .limit(branch || discipline ? 200 : 50)
  if (error) throw error

  const list = (data ?? []) as unknown as Array<import('@/types').Notification & { members: { name: string; phone: string; branch: string; discipline: string; sub_expiry: string | null; ins_expiry: string | null } | null }>

  // État "lu" PAR UTILISATEUR : on relit notification_reads (sinon "marquer lu"
  // ne persiste jamais car notifications.is_read reste global/false).
  if (user && list.length) {
    const ids = list.map(n => n.id)
    const { data: reads } = await supabase
      .from('notification_reads')
      .select('notification_id')
      .eq('user_id', user.id)
      .in('notification_id', ids)
    const readSet = new Set((reads ?? []).map((r: any) => r.notification_id))
    for (const n of list) n.is_read = n.is_read || readSet.has(n.id)
  }

  let filtered = list
  if (branch) filtered = filtered.filter(n => !n.members || n.members.branch === branch)
  if (discipline) {
    // Rappels sans membre (championnat) = karaté uniquement.
    filtered = filtered.filter(n => n.members ? n.members.discipline === discipline : discipline === 'karate')
  }
  return filtered.slice(0, 50)
}

export async function markAllRead(
  branch?: 'sbata' | 'rachad',
  discipline?: 'karate' | 'full_contact' | 'aerobic',
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // Marque comme lues POUR CET UTILISATEUR les notifications visibles
  // (dans le périmètre branche + discipline affiché)
  const list = await getNotifications(branch, discipline)
  const unreadIds = (list as any[]).filter(n => !n.is_read).map(n => n.id)
  if (unreadIds.length === 0) return

  const { error } = await supabase
    .from('notification_reads')
    .upsert(unreadIds.map(id => ({ notification_id: id, user_id: user.id })), {
      onConflict: 'notification_id,user_id',
      ignoreDuplicates: true,
    })

  // Fallback : table absente (migration 006 pas encore exécutée)
  if (error) {
    await supabase.from('notifications').update({ is_read: true })
      .eq('is_read', false)
      .in('id', unreadIds)
  }
}

export async function markOneRead(id: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase
    .from('notification_reads')
    .upsert([{ notification_id: id, user_id: user.id }], {
      onConflict: 'notification_id,user_id',
      ignoreDuplicates: true,
    })
  if (error) {
    // Fallback : migration 006 pas encore exécutée
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
  }
  revalidatePath('/alerts')
}

// ─── Réglages du club (tarifs) ────────────────────────────────

export async function getPrices(): Promise<Prices> {
  const supabase = createClient()
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'prices')
      .single()
    if (error || !data?.value) return DEFAULT_PRICES
    return { ...DEFAULT_PRICES, ...(data.value as Partial<Prices>) }
  } catch {
    // Table absente (migration 007 pas encore exécutée) : valeurs par défaut
    return DEFAULT_PRICES
  }
}

export async function updatePrices(prices: Prices) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!isSuper(profile)) {
    if (profile) await denySecurity(profile, 'Modification des tarifs (réservé superadmin)')
    return { error: 'Superadmin uniquement' }
  }

  for (const v of Object.values(prices)) {
    if (typeof v !== 'number' || v < 0 || !Number.isFinite(v)) {
      return { error: 'Tarif invalide' }
    }
  }

  const { error } = await supabase
    .from('app_settings')
    .upsert({
      key: 'prices',
      value: prices,
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    }, { onConflict: 'key' })

  if (error) {
    return { error: error.message.includes('app_settings')
      ? 'Table réglages absente — exécuter la migration 007 dans Supabase.'
      : error.message }
  }

  revalidatePath('/comptabilite')
  return { success: true }
}

// ─── Encaissements (paiements réels) ──────────────────────────

export async function addPayment(data: {
  member_id: string
  amount: number
  type: 'monthly' | 'insurance' | 'registration' | 'other'
  paid_at?: string
  notes?: string
}) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }
  if (!data.amount || data.amount <= 0) return { error: 'Montant invalide' }

  const { data: member } = await supabase
    .from('members')
    .select('name, branch, discipline')
    .eq('id', data.member_id)
    .single()
  if (!member) return { error: 'Membre introuvable' }

  const { error } = await supabase.from('payments').insert({
    member_id:   data.member_id,
    amount:      data.amount,
    type:        data.type,
    paid_at:     data.paid_at ?? new Date().toISOString().split('T')[0],
    notes:       data.notes ?? null,
    branch:      member.branch ?? null,
    discipline:  (member as any).discipline ?? null,
    recorded_by: profile.id,
  })
  if (error) {
    return { error: error.message.includes('payments')
      ? 'Table paiements absente — exécuter la migration 006 dans Supabase.'
      : error.message }
  }

  await logAudit(supabase, {
    action: 'member_update',
    entity: 'member',
    entity_id: data.member_id,
    entity_name: member.name,
    details: { paiement: data.amount, type: data.type },
    profile,
    branch: member.branch ?? null,
  })

  revalidatePath('/comptabilite')
  return { success: true }
}

export async function getPayments(opts?: { branch?: 'sbata' | 'rachad'; discipline?: 'karate' | 'full_contact' | 'aerobic'; year?: number }) {
  const supabase = createClient()
  let query = supabase
    .from('payments')
    .select('id, member_id, amount, type, paid_at, branch, discipline, notes, members(name)')
    .order('paid_at', { ascending: false })
    .limit(300)
  if (opts?.branch) query = query.eq('branch', opts.branch)
  if (opts?.discipline) query = query.eq('discipline', opts.discipline)
  if (opts?.year) {
    query = query.gte('paid_at', `${opts.year}-01-01`).lte('paid_at', `${opts.year}-12-31`)
  }
  const { data, error } = await query
  if (error) return []
  return data ?? []
}

export async function deletePayment(id: string) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin') return { error: 'Admin uniquement' }
  const { error } = await supabase.from('payments').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/comptabilite')
  return { success: true }
}

// ─── Staff management (admin only) ───────────────────────────

export async function getStaff() {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin') return []
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at')
  if (error) throw error
  return data
}

export async function createStaffAccount(data: {
  name: string
  email: string
  password: string
  role: UserRole
  branch?: 'sbata' | 'rachad' | 'both'
  discipline?: 'karate' | 'full_contact' | 'aerobic' | 'all'
}) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin') {
    if (profile) await denySecurity(profile, 'Création d\'un compte staff (réservé admin)')
    return { error: 'Admin uniquement' }
  }
  // Créer un compte ADMIN est réservé au superadmin
  if (data.role === 'admin' && !isSuper(profile)) {
    await denySecurity(profile, 'Création d\'un compte admin (réservé superadmin)')
    return { error: 'Seul un superadmin peut créer un compte administrateur' }
  }

  const strengthError = await validatePasswordStrength(data.password)
  if (strengthError) return { error: strengthError }

  const branchMetadata = data.branch === 'both' ? null : data.branch
  // 'all' (ou admin) = toutes les disciplines → discipline NULL en base.
  const disciplineMetadata =
    data.role === 'admin' || !data.discipline || data.discipline === 'all'
      ? null
      : data.discipline
  const adminClient = createAdminClient()
  const { error } = await adminClient.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: {
      name: data.name,
      role: data.role,
      branch: branchMetadata,
      discipline: disciplineMetadata,
    },
  })
  if (error) return { error: error.message }

  await logAudit(supabase, {
    action: 'staff_add',
    entity: 'staff',
    entity_name: data.name,
    details: { email: data.email, role: data.role, branch: data.branch, discipline: disciplineMetadata },
    profile,
  })

  revalidatePath('/staff')
  return { success: true }
}

// Modifier les accès d'un compte EXISTANT (nom, rôle, succursale, discipline)
// — évite d'avoir à recréer un compte juste pour ajouter une succursale ou
// changer un droit. Mêmes garde-fous que la création : gérer un admin ou
// promouvoir admin reste réservé au superadmin.
export async function updateStaffAccess(profileId: string, data: {
  name?: string
  email?: string
  role: UserRole
  branch: 'sbata' | 'rachad' | 'both'
  discipline: 'karate' | 'full_contact' | 'aerobic' | 'all'
  forceLogout?: boolean
}) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin') {
    if (profile) await denySecurity(profile, 'Modification des accès d\'un compte (réservé admin)')
    return { error: 'Admin uniquement' }
  }

  const { data: target } = await supabase
    .from('profiles')
    .select('name, email, user_id, role, branch, discipline, is_superadmin')
    .eq('id', profileId)
    .single()
  if (!target) return { error: 'Compte introuvable' }

  const isSelf = target.user_id === profile.user_id
  const targetProtected = target.role === 'admin' || target.is_superadmin === true

  // Toucher à un admin/superadmin, ou promouvoir admin : superadmin requis
  if (!isSuper(profile) && (targetProtected || data.role === 'admin')) {
    await denySecurity(profile, 'Modification des accès d\'un administrateur (réservé superadmin)')
    return { error: 'Seul un superadmin peut gérer les comptes administrateur' }
  }
  // Anti-verrouillage : on ne change pas son propre rôle
  if (isSelf && data.role !== target.role) {
    return { error: 'Impossible de modifier votre propre rôle' }
  }
  // Invariant 025 : un superadmin est toujours un admin
  if (target.is_superadmin && data.role !== 'admin') {
    return { error: 'Retirez d\'abord le statut superadmin avant de changer le rôle' }
  }

  const branch = data.branch === 'both' ? null : data.branch
  // Un admin voit toutes les disciplines (RLS 012/013) : lui en assigner une
  // n'aurait aucun effet en lecture et bloquerait son filtre global.
  const discipline = data.role === 'admin' || data.discipline === 'all' ? null : data.discipline
  const name = data.name?.trim()
  const email = data.email?.trim().toLowerCase()
  const emailChanged = !!email && email !== (target.email ?? '').toLowerCase()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Adresse email invalide' }
  }

  const adminClient = createAdminClient()

  // L'email est l'identifiant de connexion : on le change côté auth AVANT le
  // profil, pour ne pas désynchroniser les deux si l'adresse est déjà prise.
  if (emailChanged) {
    const { error: authError } = await adminClient.auth.admin.updateUserById(target.user_id, {
      email,
      email_confirm: true,
    })
    if (authError) {
      return { error: /already|exist/i.test(authError.message) ? 'Cette adresse email est déjà utilisée' : authError.message }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      role: data.role, branch, discipline,
      ...(name ? { name } : {}),
      ...(emailChanged ? { email } : {}),
    })
    .eq('id', profileId)
  if (error) return { error: error.message }

  // Garder les métadonnées auth alignées sur le profil (source du trigger
  // handle_new_user et de l'affichage supervision).
  try {
    await adminClient.auth.admin.updateUserById(target.user_id, {
      user_metadata: { name: name || target.name, role: data.role, branch, discipline },
    })
  } catch {
    // non bloquant : le profil fait foi
  }

  const scopeChanged =
    target.role !== data.role ||
    (target.branch ?? null) !== branch ||
    (target.discipline ?? null) !== discipline ||
    emailChanged   // l'identifiant de connexion a changé → reconnexion souhaitable

  // Le périmètre a changé : on déconnecte le compte pour qu'il se reconnecte
  // avec les bons droits (sinon son écran garde l'ancien contexte en cache).
  let loggedOut = false
  if (scopeChanged && data.forceLogout && !isSelf) {
    const { error: killError } = await supabase.rpc('force_logout_user', { uid: target.user_id })
    loggedOut = !killError
  }

  await logAudit(supabase, {
    action: 'staff_update_role',
    entity: 'staff',
    entity_id: profileId,
    entity_name: name || target.name,
    details: {
      old: { role: target.role, branch: target.branch ?? null, discipline: target.discipline ?? null, email: target.email },
      new: { role: data.role, branch, discipline, ...(emailChanged ? { email } : {}) },
      forced_logout: loggedOut,
    },
    profile,
  })

  revalidatePath('/staff')
  return { success: true }
}

// Accorder / retirer le statut superadmin — réservé à un superadmin.
export async function setSuperadmin(profileId: string, value: boolean) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!isSuper(profile)) {
    if (profile) await denySecurity(profile, 'Attribution du statut superadmin (réservé superadmin)')
    return { error: 'Superadmin uniquement' }
  }
  const { data: target } = await supabase
    .from('profiles').select('name, user_id').eq('id', profileId).single()
  if (!target) return { error: 'Compte introuvable' }
  // Ne pas se retirer soi-même le statut (évite de se verrouiller dehors)
  if (!value && target.user_id === profile!.user_id) {
    return { error: 'Impossible de retirer votre propre statut superadmin' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ is_superadmin: value, ...(value ? { role: 'admin' as UserRole } : {}) })
    .eq('id', profileId)
  if (error) return { error: error.message }

  await logAudit(supabase, {
    action: 'staff_update_role',
    entity: 'staff',
    entity_id: profileId,
    entity_name: target.name ?? null,
    details: { superadmin: value },
    profile,
  })
  revalidatePath('/staff')
  return { success: true }
}

export async function deleteStaffAccount(profileId: string) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin') {
    if (profile) await denySecurity(profile, 'Suppression d\'un compte staff (réservé admin)')
    return { error: 'Admin uniquement' }
  }
  // Get user_id first
  const { data: target } = await supabase
    .from('profiles')
    .select('user_id, role, is_superadmin')
    .eq('id', profileId)
    .single()
  if (!target) return { error: 'Compte introuvable' }
  if (target.user_id === profile.user_id) return { error: 'Impossible de supprimer son propre compte' }
  // Supprimer un admin / superadmin est réservé au superadmin
  if (!isSuper(profile) && (target.role === 'admin' || target.is_superadmin)) {
    await denySecurity(profile, 'Suppression d\'un compte admin (réservé superadmin)')
    return { error: 'Seul un superadmin peut supprimer un compte administrateur' }
  }

  const { data: targetFull } = await supabase.from('profiles').select('name, role, branch').eq('id', profileId).single()

  const adminClient = createAdminClient()
  const { error } = await adminClient.auth.admin.deleteUser(target.user_id)
  if (error) return { error: error.message }

  await logAudit(supabase, {
    action: 'staff_delete',
    entity: 'staff',
    entity_id: profileId,
    entity_name: targetFull?.name ?? null,
    details: { role: targetFull?.role, branch: targetFull?.branch },
    profile,
  })

  revalidatePath('/staff')
  return { success: true }
}

// ─── Grade sessions ───────────────────────────────────────────

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

// Season runs Sep→Jul. Aug (month index 7) is off-season.
// Grade sessions happen in Sep(8), Dec(11), Mar(2), Jun(5)
const GRADE_MONTHS = [8, 11, 2, 5] // 0-indexed JS months

function isInGradeSeason(date: Date): boolean {
  return date.getMonth() !== 7 // not August
}

// Next grade session date from a given date (next Sep/Dec/Mar/Jun, skipping Aug)
function nextGradeSessionDate(from: Date): Date {
  const d = new Date(from)
  d.setDate(1)
  // advance at least one month to avoid same month
  d.setMonth(d.getMonth() + 1)

  for (let i = 0; i < 13; i++) {
    if (GRADE_MONTHS.includes(d.getMonth()) && d.getMonth() !== 7) return d
    d.setMonth(d.getMonth() + 1)
  }
  return d
}

export async function getGradeSessions(branch?: 'sbata' | 'rachad') {
  const supabase = createClient()
  // Grades = karaté uniquement (défense en profondeur + RLS 013)
  if (!isKarateProfile(await getCurrentProfile())) return []
  // members!inner makes the branch filter apply to the parent rows
  // (a filter on a left-joined embed only nulls the embed, it doesn't filter)
  let query = supabase
    .from('grade_sessions')
    .select(branch
      ? '*, members!inner(name, phone, grade, branch, sub_expiry)'
      : '*, members(name, phone, grade, branch, sub_expiry)')
    .order('scheduled_date', { ascending: false })

  if (branch) {
    query = query.eq('members.branch', branch)
  }

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function getPendingGradeChecks(branch?: 'sbata' | 'rachad') {
  const supabase = createClient()
  // Grades = karaté uniquement
  if (!isKarateProfile(await getCurrentProfile())) return []
  let query = supabase
    .from('members')
    .select('id, name, grade, join_date, branch, sub_expiry')
    // Ne considérer que les membres karaté (les autres disciplines n'ont pas de grade)
    .eq('discipline', 'karate')

  if (branch) query = query.eq('branch', branch)

  const { data: members, error } = await query
  if (error) throw error

  // Only pending sessions (not yet confirmed)
  const { data: sessions } = await supabase
    .from('grade_sessions')
    .select('member_id, status')

  const pendingByMember: Record<string, number> = {}
  for (const s of sessions ?? []) {
    if (s.status === 'pending') {
      pendingByMember[s.member_id] = (pendingByMember[s.member_id] ?? 0) + 1
    }
  }

  const now = new Date()
  const result = []

  for (const m of members ?? []) {
    if (!m.join_date) continue

    // Must have active subscription
    if (m.sub_expiry && new Date(m.sub_expiry) < now) continue

    // Must be inscribed for more than 3 months
    const joinDate = new Date(m.join_date)
    const monthsSince = (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    if (monthsSince < 3) continue

    // Must not be at black belt already
    if ((m.grade ?? 0) >= 12) continue

    // Must not already have a pending session
    if ((pendingByMember[m.id] ?? 0) > 0) continue

    // Must be in season (not August)
    if (!isInGradeSeason(now)) continue

    result.push({ ...m, months_since: Math.floor(monthsSince), missing: 1 })
  }

  return result
}

export async function createGradeSession(memberId: string, scheduledDate: string) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }
  if (!isKarateProfile(profile)) return { error: 'Réservé au karaté' }

  const { data: member } = await supabase
    .from('members')
    .select('grade, sub_expiry, discipline')
    .eq('id', memberId)
    .single()
  if (!member) return { error: 'Membre introuvable' }
  // Sécurité : pas de passage de grade hors karaté
  if ((member as any).discipline && (member as any).discipline !== 'karate') {
    return { error: 'Les passages de grade sont réservés au karaté' }
  }

  // Check active subscription
  if (member.sub_expiry && new Date(member.sub_expiry) < new Date()) {
    return { error: 'Abonnement expiré — passage impossible' }
  }

  const { error } = await supabase.from('grade_sessions').insert({
    member_id: memberId,
    grade_before: member.grade ?? 0,
    scheduled_date: scheduledDate,
    status: 'pending',
  })

  if (error) return { error: error.message }

  const { data: memberInfo } = await supabase.from('members').select('name, branch').eq('id', memberId).single()
  await logAudit(supabase, {
    action: 'grade_session_create',
    entity: 'grade',
    entity_id: memberId,
    entity_name: memberInfo?.name ?? null,
    details: { scheduled_date: scheduledDate, grade_before: member.grade },
    profile,
    branch: memberInfo?.branch ?? null,
  })

  revalidatePath('/grades')
  return { success: true }
}

export async function confirmGradeSession(
  sessionId: string,
  result: 'passed' | 'failed',
  notes?: string,
) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }
  if (!isKarateProfile(profile)) return { error: 'Réservé au karaté' }

  const { data: session } = await supabase
    .from('grade_sessions')
    .select('*, members(grade, sub_expiry)')
    .eq('id', sessionId)
    .single()

  if (!session) return { error: 'Session introuvable' }

  const currentGrade = session.members?.grade ?? session.grade_before
  const gradeAfter = result === 'passed' ? Math.min(currentGrade + 1, 12) : currentGrade

  const { error: updateError } = await supabase
    .from('grade_sessions')
    .update({
      status: result,
      grade_after: gradeAfter,
      confirmed_by: profile.id,
      confirmed_at: new Date().toISOString(),
      notes: notes ?? null,
    })
    .eq('id', sessionId)

  if (updateError) return { error: updateError.message }

  if (result === 'passed' && currentGrade < 12) {
    await supabase.from('members').update({ grade: gradeAfter }).eq('id', session.member_id)
  }

  // Schedule next session only if: not black belt + subscription still active
  const nextGrade = result === 'passed' ? gradeAfter : currentGrade
  const subExpiry = session.members?.sub_expiry
  const subActive = !subExpiry || new Date(subExpiry) >= new Date()

  if (nextGrade < 12 && subActive) {
    const nextDate = nextGradeSessionDate(new Date(session.scheduled_date))
    // Only schedule if next date is in season
    if (isInGradeSeason(nextDate)) {
      await supabase.from('grade_sessions').insert({
        member_id: session.member_id,
        grade_before: nextGrade,
        scheduled_date: nextDate.toISOString().split('T')[0],
        status: 'pending',
      })
    }
  }

  const { data: memberInfo } = await supabase.from('members').select('name, branch').eq('id', session.member_id).single()
  await logAudit(supabase, {
    action: 'grade_session_confirm',
    entity: 'grade',
    entity_id: session.member_id,
    entity_name: memberInfo?.name ?? null,
    details: { result, grade_before: session.grade_before, grade_after: gradeAfter, notes },
    profile,
    branch: memberInfo?.branch ?? null,
  })

  revalidatePath('/grades')
  revalidatePath('/dashboard')
  revalidatePath('/members')
  return { success: true, gradeAfter }
}

// ─── Championnats ─────────────────────────────────────────────────────────────

export async function getChampionships() {
  const supabase = createClient()
  // Championnats = karaté uniquement (défense en profondeur + RLS 013)
  if (!isKarateProfile(await getCurrentProfile())) return []
  const { data, error } = await supabase
    .from('championships')
    .select('*, championship_athletes(id, qualified, place)')
    .order('date', { ascending: false })
  if (error) return []
  return (data ?? []).map(c => {
    const athletes = Array.isArray(c.championship_athletes) ? c.championship_athletes : []
    return {
      ...c,
      championship_athletes: undefined,
      athlete_count:   athletes.length,
      qualified_count: athletes.filter((a: any) => a.qualified === true).length,
      medals: {
        gold:   athletes.filter((a: any) => a.place === 1).length,
        silver: athletes.filter((a: any) => a.place === 2).length,
        bronze: athletes.filter((a: any) => a.place === 3).length,
      },
    }
  })
}

export async function getChampionshipWithAthletes(id: string) {
  const supabase = createClient()
  // Championnats = karaté uniquement
  if (!isKarateProfile(await getCurrentProfile())) return null
  const [champRes, athletesRes] = await Promise.all([
    supabase.from('championships').select('*').eq('id', id).single(),
    supabase
      .from('championship_athletes')
      .select('*, members(id, name, phone, email, grade, branch)')
      .eq('championship_id', id)
      .order('added_at'),
  ])
  if (!champRes.data) return null
  const athletes = athletesRes.data ?? []
  return {
    ...champRes.data,
    athletes,
    total_athletes:  athletes.length,
    qualified_count: athletes.filter(a => a.qualified === true).length,
    medals: {
      gold:   athletes.filter(a => a.place === 1).length,
      silver: athletes.filter(a => a.place === 2).length,
      bronze: athletes.filter(a => a.place === 3).length,
    },
  }
}

export async function createChampionship(data: {
  name: string
  date: string
  location?: string
  branch?: string
  status?: ChampionshipStatus
  description?: string
}) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }
  if (!isKarateProfile(profile)) return { error: 'Réservé au karaté' }
  const { data: champ, error } = await supabase
    .from('championships')
    .insert({
      name:        data.name,
      date:        data.date,
      location:    data.location ?? null,
      branch:      data.branch || null,
      status:      data.status ?? 'upcoming',
      description: data.description ?? null,
      created_by:  profile.id,
    })
    .select()
    .single()
  if (error) return { error: error.message }
  revalidatePath('/championships')
  revalidatePath('/dashboard')
  return { success: true, id: champ.id }
}

export async function updateChampionship(
  id: string,
  data: Partial<{
    name: string
    date: string
    location: string
    branch: string
    status: ChampionshipStatus
    description: string
  }>,
) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }
  if (!isKarateProfile(profile)) return { error: 'Réservé au karaté' }
  const { error } = await supabase
    .from('championships')
    .update(data)
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/championships')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteChampionship(id: string) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin') {
    return { error: 'Permission refusée' }
  }
  const { error } = await supabase.from('championships').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/championships')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function addAthletesToChampionship(
  championshipId: string,
  athletes: Array<{ member_id: string; category?: string; weight_class?: string }>,
) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }
  if (!isKarateProfile(profile)) return { error: 'Réservé au karaté' }
  const rows = athletes.map(a => ({
    championship_id: championshipId,
    member_id:       a.member_id,
    category:        a.category ?? null,
    weight_class:    a.weight_class ?? null,
    added_by:        profile.id,
  }))
  const { error } = await supabase
    .from('championship_athletes')
    .upsert(rows, { onConflict: 'championship_id,member_id', ignoreDuplicates: true })
  if (error) return { error: error.message }
  revalidatePath('/championships')
  return { success: true }
}

export async function removeAthleteFromChampionship(
  championshipId: string,
  memberId: string,
) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }
  if (!isKarateProfile(profile)) return { error: 'Réservé au karaté' }
  const { data: existing } = await supabase
    .from('championship_athletes')
    .select('qualified')
    .eq('championship_id', championshipId)
    .eq('member_id', memberId)
    .single()
  if (existing?.qualified !== null && existing?.qualified !== undefined) {
    return { error: 'Impossible de retirer un athlète dont le résultat est déjà saisi' }
  }
  const { error } = await supabase
    .from('championship_athletes')
    .delete()
    .eq('championship_id', championshipId)
    .eq('member_id', memberId)
  if (error) return { error: error.message }
  revalidatePath('/championships')
  return { success: true }
}

export async function enterAthleteResult(
  athleteId: string,
  result: { qualified: boolean; place?: 1 | 2 | 3 | null; result_notes?: string },
) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }
  if (!isKarateProfile(profile)) return { error: 'Réservé au karaté' }
  const { error } = await supabase
    .from('championship_athletes')
    .update({
      qualified:         result.qualified,
      place:             result.qualified ? (result.place ?? null) : null,
      result_notes:      result.result_notes ?? null,
      result_entered_at: new Date().toISOString(),
      result_entered_by: profile.id,
    })
    .eq('id', athleteId)
  if (error) return { error: error.message }
  revalidatePath('/championships')
  return { success: true }
}

export async function enterAllResults(
  championshipId: string,
  results: Array<{
    athlete_id: string
    qualified: boolean
    place?: 1 | 2 | 3 | null
    result_notes?: string
  }>,
) {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { error: 'Permission refusée' }
  }
  if (!isKarateProfile(profile)) return { error: 'Réservé au karaté' }
  const now = new Date().toISOString()
  for (const r of results) {
    await supabase
      .from('championship_athletes')
      .update({
        qualified:         r.qualified,
        place:             r.qualified ? (r.place ?? null) : null,
        result_notes:      r.result_notes ?? null,
        result_entered_at: now,
        result_entered_by: profile.id,
      })
      .eq('id', r.athlete_id)
  }
  // Auto-complete championship if all results entered
  const { data: remaining } = await supabase
    .from('championship_athletes')
    .select('id')
    .eq('championship_id', championshipId)
    .is('qualified', null)
  if (!remaining || remaining.length === 0) {
    await supabase
      .from('championships')
      .update({ status: 'completed' })
      .eq('id', championshipId)
  }
  revalidatePath('/championships')
  return { success: true }
}
