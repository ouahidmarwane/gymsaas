/**
 * Statut d'abonnement et d'assurance d'un membre.
 *
 * Deduit des dates a la lecture, jamais stocke : un statut fige se
 * desynchronise des que le temps passe, une date se compare. C'est la meme
 * regle que la couverture d'abonnement cote plateforme.
 */

export interface MemberRow {
  id: string
  name: string
  phone: string
  email: string | null
  join_date: string
  sub_expiry: string | null
  is_insured: number
  ins_expiry: string | null
  photo_key: string | null
  sport_passport_key: string | null
  branch_id: string | null
  branch_name: string | null
  discipline_id: string | null
  discipline_name: string | null
  has_grading: number | null
  grade_label: string | null
  grade_color: string | null
}

export type SubStatus = 'active' | 'expiring' | 'expired' | 'unknown'
export type InsStatus = 'active' | 'expiring' | 'expired' | 'uninsured'

/** Un abonnement qui se termine dans moins de 30 jours se relance. */
export const SOON_DAYS = 30

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const day = iso.slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

export function subStatus(m: MemberRow): SubStatus {
  const left = daysUntil(m.sub_expiry)
  if (left === null) return 'unknown'
  if (left < 0) return 'expired'
  return left <= SOON_DAYS ? 'expiring' : 'active'
}

export function insStatus(m: MemberRow): InsStatus {
  // Non assure et assurance perimee ne sont pas la meme chose : le premier
  // n'a jamais ete couvert, le second l'a ete. La relance differe.
  if (!m.is_insured) return 'uninsured'
  const left = daysUntil(m.ins_expiry)
  if (left === null) return 'uninsured'
  if (left < 0) return 'expired'
  return left <= SOON_DAYS ? 'expiring' : 'active'
}

/** Aucun encaissement depuis plus de trois mois ET abonnement echu. */
export function isDormant(m: MemberRow): boolean {
  const left = daysUntil(m.sub_expiry)
  return left !== null && left < -90
}

export const SUB_LABEL: Record<SubStatus, string> = {
  active: 'Actif', expiring: 'Expire bientôt', expired: 'Expiré', unknown: 'Inconnu',
}
export const INS_LABEL: Record<InsStatus, string> = {
  active: 'Assuré', expiring: 'Expire bientôt', expired: 'Expirée', uninsured: 'Non assuré',
}

/**
 * Classes de pastille reprises telles quelles de l'application d'origine.
 * Les couleurs restent litterales : ce sont des etats semantiques (vert =
 * en regle, rouge = a traiter), pas la teinte du club.
 */
export const SUB_TONE: Record<SubStatus, string> = {
  active: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30',
  expiring: 'text-amber-300 bg-amber-500/10 ring-amber-500/30',
  expired: 'text-red-300 bg-red-500/10 ring-red-500/30',
  unknown: 'text-slate-400 bg-white/5 ring-white/10',
}
export const INS_TONE: Record<InsStatus, string> = {
  active: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30',
  expiring: 'text-amber-300 bg-amber-500/10 ring-amber-500/30',
  expired: 'text-red-300 bg-red-500/10 ring-red-500/30',
  uninsured: 'text-red-300 bg-red-500/10 ring-red-500/30',
}

/**
 * Message de relance WhatsApp, adapte a ce qui manque reellement.
 *
 * Envoyer « votre abonnement expire » a quelqu'un dont c'est l'assurance qui
 * a saute fait perdre du temps aux deux.
 */
export function whatsappFor(m: MemberRow, clubName: string): { label: string; message: string } {
  const sub = subStatus(m)
  const ins = insStatus(m)
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '')

  if (sub === 'expired') {
    return {
      label: 'Relancer : abonnement expiré',
      message: `Bonjour ${m.name}, votre abonnement à ${clubName} a expiré le ${day(m.sub_expiry)}.`
        + ` Merci de passer le renouveler.`,
    }
  }
  if (sub === 'expiring') {
    return {
      label: 'Relancer : abonnement bientôt expiré',
      message: `Bonjour ${m.name}, votre abonnement à ${clubName} se termine le ${day(m.sub_expiry)}.`
        + ` Pensez à le renouveler.`,
    }
  }
  if (ins === 'uninsured' || ins === 'expired') {
    return {
      label: 'Relancer : assurance',
      message: `Bonjour ${m.name}, votre assurance à ${clubName} n'est pas à jour.`
        + ` Merci de régulariser avant la prochaine séance.`,
    }
  }
  return { label: 'Écrire sur WhatsApp', message: `Bonjour ${m.name}, ` }
}

export function waLink(phone: string, message: string): string {
  // Numero marocain local : on prefixe l'indicatif, sinon wa.me n'ouvre rien.
  const digits = phone.replace(/\D/g, '')
  const international = digits.startsWith('0') ? `212${digits.slice(1)}` : digits
  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`
}
