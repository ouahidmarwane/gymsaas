// types/index.ts

export type UserRole = 'admin' | 'receptionist' | 'viewer'

export type Discipline = 'karate' | 'full_contact' | 'aerobic'

// Vue admin : une discipline précise, ou toutes combinées.
export type DisciplineFilter = Discipline | 'all'

export const DISCIPLINES: Discipline[] = ['karate', 'full_contact', 'aerobic']

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  karate:       'Karaté',
  full_contact: 'Full contact',
  aerobic:      'Aérobic',
}

export type NotifType =
  | 'sub_expiring'
  | 'sub_expired'
  | 'ins_expiring'
  | 'ins_expired'
  | 'ins_missing'

export interface Profile {
  id: string
  user_id: string
  name: string
  email: string
  role: UserRole
  branch?: 'sbata' | 'rachad' | null
  discipline?: Discipline | null
  // Superadmin = admin avec pouvoirs étendus (gère les admins, tarifs,
  // supervision). Voir migration 025.
  is_superadmin?: boolean
  created_at: string
}

export interface Member {
  id: string
  name: string
  phone: string
  email: string | null
  join_date: string
  sub_expiry: string | null
  is_insured: boolean
  ins_expiry: string | null
  branch?: 'sbata' | 'rachad' | null
  discipline?: Discipline
  notes: string | null
  photo_url: string | null
  sport_passport_url: string | null
  document_url: string | null
  grade: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MemberEnriched extends Member {
  sub_status: 'active' | 'expiring' | 'expired' | 'unknown'
  ins_status: 'active' | 'expiring' | 'expired' | 'uninsured'
  sub_days_left: number | null
  ins_days_left: number | null
}

export interface Notification {
  id: string
  member_id: string | null   // null = rappel global (ex: championnat)
  type: NotifType
  message: string
  is_read: boolean
  sent_email: boolean
  created_at: string
  members?: { name: string; phone: string } | null
}

export interface GradeSession {
  id: string
  member_id: string
  grade_before: number
  grade_after: number | null
  scheduled_date: string
  status: 'pending' | 'passed' | 'failed'
  confirmed_by: string | null
  confirmed_at: string | null
  notes: string | null
  created_at: string
  members?: {
    name: string
    phone: string
    grade: number
    branch: string
  }
}

export const GRADE_LABELS: Record<number, string> = {
  0:  'Blanche',
  1:  'Blanche avec ligne',
  2:  'Jaune',
  3:  'Jaune avec ligne',
  4:  'Orange',
  5:  'Orange avec ligne',
  6:  'Verte',
  7:  'Verte avec ligne',
  8:  'Bleue',
  9:  'Bleue avec ligne',
  10: 'Marron',
  11: 'Marron avec ligne',
  12: 'Noire',
}

export type AuditAction =
  | 'member_add'
  | 'member_update'
  | 'member_delete'
  | 'subscription_renew'
  | 'insurance_renew'
  | 'grade_session_create'
  | 'grade_session_confirm'
  | 'staff_add'
  | 'staff_update_role'
  | 'staff_delete'

export interface AuditLog {
  id: string
  action: AuditAction
  entity: string
  entity_id: string | null
  entity_name: string | null
  details: Record<string, unknown> | null
  performed_by: string | null
  performer_name: string | null
  performer_role: string | null
  branch: string | null
  created_at: string
}

// ─── Championships ────────────────────────────────────────────────────────────

export type ChampionshipStatus = 'upcoming' | 'ongoing' | 'completed'

export interface Championship {
  id: string
  name: string
  date: string
  location: string | null
  branch: string | null
  status: ChampionshipStatus
  description: string | null
  created_by: string | null
  created_at: string
  discipline?: string | null
  age_min?: number | null
  age_max?: number | null
  weight_category?: string | null
}

export interface ChampionshipAthlete {
  id: string
  championship_id: string
  member_id: string
  category: string | null
  weight_class: string | null
  qualified: boolean | null
  place: 1 | 2 | 3 | null
  result_notes: string | null
  result_entered_at: string | null
  added_at: string
  members?: {
    id: string
    name: string
    phone: string
    email: string | null
    grade: number
    branch: string
  }
}

export interface ChampionshipWithAthletes extends Championship {
  athletes: ChampionshipAthlete[]
  total_athletes: number
  qualified_count: number
  medals: { gold: number; silver: number; bronze: number }
}

// ─── Grade Colors ─────────────────────────────────────────────────────────────

export const GRADE_COLORS: Record<number, { bg: string; text: string; belt: string }> = {
  0:  { bg: 'bg-gray-100',   text: 'text-gray-700',   belt: '#e5e7eb' },
  1:  { bg: 'bg-gray-100',   text: 'text-gray-700',   belt: '#e5e7eb' },
  2:  { bg: 'bg-yellow-100', text: 'text-yellow-800', belt: '#facc15' },
  3:  { bg: 'bg-yellow-100', text: 'text-yellow-800', belt: '#facc15' },
  4:  { bg: 'bg-orange-100', text: 'text-orange-800', belt: '#fb923c' },
  5:  { bg: 'bg-orange-100', text: 'text-orange-800', belt: '#fb923c' },
  6:  { bg: 'bg-green-100',  text: 'text-green-800',  belt: '#22c55e' },
  7:  { bg: 'bg-green-100',  text: 'text-green-800',  belt: '#22c55e' },
  8:  { bg: 'bg-blue-100',   text: 'text-blue-800',   belt: '#3b82f6' },
  9:  { bg: 'bg-blue-100',   text: 'text-blue-800',   belt: '#3b82f6' },
  10: { bg: 'bg-amber-100',  text: 'text-amber-900',  belt: '#92400e' },
  11: { bg: 'bg-amber-100',  text: 'text-amber-900',  belt: '#92400e' },
  12: { bg: 'bg-gray-900',   text: 'text-white',      belt: '#111111' },
}
