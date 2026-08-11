// lib/gym.ts
import { differenceInDays, parseISO } from 'date-fns'
import type { Member, MemberEnriched } from '@/types'

export const SUB_WARN_DAYS = 7    // warn 7 days before sub expires
export const INS_WARN_DAYS = 30   // warn 30 days before insurance expires

// ─── Passages de grade ────────────────────────────────────────
// L'année du club démarre le 1er septembre ; les passages ont lieu à dates
// FIXES tous les 3 mois : 1 sept, 1 déc, 1 mars, 1 juin (août = hors saison).
// Un membre devient éligible 3 mois après son inscription, mais sa session
// est toujours planifiée sur la prochaine date fixe.
export const GRADE_PASSAGE_MONTHS = [8, 11, 2, 5] // mois JS 0-indexés

export function nextGradePassageDate(from: Date = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), 1)
  for (let i = 0; i < 13; i++) {
    d.setMonth(d.getMonth() + 1) // au moins le mois suivant
    if (GRADE_PASSAGE_MONTHS.includes(d.getMonth())) return d
  }
  return d
}

export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  return differenceInDays(parseISO(dateStr), new Date())
}

// Generic: accepts full Member rows as well as partial selects
// (dashboard / comptabilité only fetch the columns they display)
export function enrichMember<T extends Pick<Member, 'sub_expiry' | 'is_insured' | 'ins_expiry'>>(
  m: T,
): T & Pick<MemberEnriched, 'sub_status' | 'ins_status' | 'sub_days_left' | 'ins_days_left'> {
  const subDays = daysUntil(m.sub_expiry)
  const insDays = m.is_insured ? daysUntil(m.ins_expiry) : null

  const sub_status: MemberEnriched['sub_status'] =
    subDays === null   ? 'unknown'  :
    subDays < 0        ? 'expired'  :
    subDays <= SUB_WARN_DAYS ? 'expiring' : 'active'

  const ins_status: MemberEnriched['ins_status'] =
    !m.is_insured      ? 'uninsured' :
    insDays === null   ? 'uninsured' :
    insDays < 0        ? 'expired'   :
    insDays <= INS_WARN_DAYS ? 'expiring' : 'active'

  return {
    ...m,
    sub_status,
    ins_status,
    sub_days_left: subDays,
    ins_days_left: insDays,
  }
}

export const STATUS_CONFIG = {
  sub: {
    active:   { label: 'Actif',          color: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30' },
    expiring: { label: 'Expire bientôt', color: 'text-amber-300   bg-amber-500/10   ring-amber-500/30'   },
    expired:  { label: 'Expiré',         color: 'text-red-300     bg-red-500/10     ring-red-500/30'     },
    unknown:  { label: 'Inconnu',        color: 'text-slate-400   bg-white/5        ring-white/10'       },
  },
  ins: {
    active:   { label: 'Assuré',         color: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30' },
    expiring: { label: 'Expire bientôt', color: 'text-amber-300   bg-amber-500/10   ring-amber-500/30'   },
    expired:  { label: 'Expirée',        color: 'text-red-300     bg-red-500/10     ring-red-500/30'     },
    uninsured:{ label: 'Non assuré',     color: 'text-red-300     bg-red-500/10     ring-red-500/30'     },
  },
}
